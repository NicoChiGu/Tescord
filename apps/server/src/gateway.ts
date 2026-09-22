import { dmCallService } from "./services/dm-call.service.js";
import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import {
  GatewayOpCode,
  GatewayPayload,
  HelloPayload,
  HeartbeatData,
  IdentifyPayload,
  VoiceStateUpdatePayload,
  VoiceState,
  VoiceServerDisconnectPayload,
  GatewayEvents,
  TypingIndicatorPayload,
  P2PSignalPayload,
  P2PNodeMetrics,
  UserStatus,
  UserPresence,
  StatusUpdatePayload,
  PresenceUpdateEvent,
} from "@tescord/types";
import { prisma } from "./db.js";
import { removeParticipantFromRoom } from "./livekit.js";
import { p2pTopologyManager } from "./p2pTopology.js";
import { cacheStore } from "./cache.js";

interface ClientConnection {
  ws: WebSocket;
  userId?: string;
  sessionId?: string;
  properties?: {
    os?: string;
    browser?: string;
    device?: string;
  };
  isAlive: boolean;
  heartbeatIntervalTimer?: NodeJS.Timeout;
}

export class GatewayManager {
  private tokenVerifier?: (token: string) => Promise<Record<string, unknown>>;
  public setTokenVerifier(verifier: (token: string) => Promise<Record<string, unknown>>) {
    this.tokenVerifier = verifier;
  }
  private connections: Set<ClientConnection> = new Set();
  // 多端/多会话映射：userId -> Map<sessionId, ClientConnection>
  private userSessions: Map<string, Map<string, ClientConnection>> = new Map();
  // 全网单用户仅存一个活跃语音会话：userId -> VoiceState
  private voiceStates: Map<string, VoiceState> = new Map();
  // 离线防抖缓冲池：userId -> NodeJS.Timeout (3.5秒防抖)
  private disconnectGraceTimers: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatSweepTimer: NodeJS.Timeout;

  constructor() {
    // 启动周期性心跳巡检（每 30 秒），及时识别并清理 TCP 僵尸假死连接
    this.heartbeatSweepTimer = setInterval(() => {
      for (const conn of this.connections) {
        if (!conn.isAlive) {
          console.log(
            `[Gateway] Terminating dead connection for user ${conn.userId || "anonymous"}`,
          );
          conn.ws.terminate();
        } else {
          conn.isAlive = false;
        }
      }
    }, 30000);
  }

  handleConnection(ws: WebSocket) {
    const conn: ClientConnection = {
      ws,
      isAlive: true,
    };
    this.connections.add(conn);

    // 1. 发送 HELLO 包，通知客户端心跳周期 (30 秒)
    const HEARTBEAT_INTERVAL = 30000;
    this.send(ws, {
      op: GatewayOpCode.HELLO,
      d: {
        heartbeatInterval: HEARTBEAT_INTERVAL,
      } as HelloPayload,
    });

    ws.on("message", async (raw: string) => {
      try {
        const payload: GatewayPayload = JSON.parse(raw.toString());
        await this.handlePayload(conn, payload);
      } catch (err) {
        console.error("Failed to parse gateway payload:", err);
      }
    });

    ws.on("close", () => {
      this.cleanup(conn);
    });

    ws.on("error", (err) => {
      console.error("WebSocket connection error:", err);
      this.cleanup(conn);
    });
  }

  private async handlePayload(conn: ClientConnection, payload: GatewayPayload) {
    switch (payload.op) {
      case GatewayOpCode.HEARTBEAT:
        conn.isAlive = true;
        const hbData = payload.d as HeartbeatData | undefined;
        this.send(conn.ws, {
          op: GatewayOpCode.HEARTBEAT_ACK,
          d: {
            clientTimestamp: hbData?.clientTimestamp || Date.now(),
            serverTimestamp: Date.now(),
          } as HeartbeatData,
        });
        break;

      case GatewayOpCode.IDENTIFY: {
        const data = payload.d as IdentifyPayload;
        let userId = data?.token;

        // 若为 JWT Token，解析其载荷中的 sub
        if (userId && userId.includes(".")) {
          try {
            const parts = userId.split(".");
            if (parts.length === 3) {
              const payloadJson = Buffer.from(parts[1], "base64").toString(
                "utf8",
              );
              const decoded = JSON.parse(payloadJson);
              if (decoded?.sub) {
                userId = decoded.sub;
              }
            }
          } catch {
            // 解析失败按原值处理
          }
        }

        let user = userId
          ? await prisma.user.findUnique({ where: { id: userId } })
          : null;
        if (!user) {
          // 尝试查找默认用户作为回退兜底
          user = await prisma.user.findFirst();
        }

        if (!user) {
          this.send(conn.ws, {
            op: GatewayOpCode.INVALID_SESSION,
          });
          return;
        }

        // 若存在断线缓冲定时器，立即清除（说明用户刷新页面重连成功，避免误触发离线）
        if (this.disconnectGraceTimers.has(user.id)) {
          clearTimeout(this.disconnectGraceTimers.get(user.id)!);
          this.disconnectGraceTimers.delete(user.id);
        }

        const sessionId = data?.sessionId || randomUUID();
        conn.userId = user.id;
        conn.sessionId = sessionId;
        conn.properties = data?.properties;

        if (!this.userSessions.has(user.id)) {
          this.userSessions.set(user.id, new Map());
        }
        this.userSessions.get(user.id)!.set(sessionId, conn);

        // 确定用户有效在线状态（若偏好是 OFFLINE 则默认唤醒为 ONLINE，若为 INVISIBLE/DND/IDLE 则保留偏好）
        const userStatusPref = (user.status as UserStatus) || "ONLINE";
        const effectiveStatus: UserStatus =
          userStatusPref === "OFFLINE" ? "ONLINE" : userStatusPref;

        const presence: UserPresence = {
          userId: user.id,
          status: effectiveStatus,
          customStatus: user.customStatus,
          clientStatus: {
            web: effectiveStatus,
          },
          lastActiveAt: new Date().toISOString(),
        };
        await cacheStore.setUserPresence(user.id, presence);

        // 获取公会数据供客户端初始化
        const guilds = await prisma.guild.findMany({
          include: {
            categories: {
              orderBy: { position: "asc" },
            },
            channels: {
              orderBy: { position: "asc" },
            },
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    email: true,
                    avatarUrl: true,
                    status: true,
                    customStatus: true,
                    bio: true,
                    createdAt: true,
                  },
                },
              },
            },
            roles: {
              orderBy: { position: "asc" },
            },
          },
        });

        // 动态水合所有公会成员的真实瞬时在线状态
        const allMemberIds = Array.from(
          new Set(guilds.flatMap((g) => g.members.map((m) => m.userId))),
        );
        const presences = await cacheStore.batchGetPresences(allMemberIds);

        const hydratedGuilds = guilds.map((g) => ({
          ...g,
          members: g.members.map((m) => {
            if (!m.user) return m;
            if (m.userId === user.id) {
              return {
                ...m,
                user: {
                  ...m.user,
                  status: effectiveStatus,
                  customStatus: user.customStatus,
                },
              };
            }
            const p = presences.get(m.userId);
            const isOnline =
              p && p.status !== "OFFLINE" && p.status !== "INVISIBLE";
            return {
              ...m,
              user: {
                ...m.user,
                status: isOnline ? p.status : "OFFLINE",
                customStatus:
                  p?.customStatus !== undefined
                    ? p.customStatus
                    : m.user.customStatus,
              },
            };
          }),
        }));

        // 发送 READY 事件，携带分配的 sessionId
        this.send(conn.ws, {
          op: GatewayOpCode.DISPATCH,
          t: "READY",
          d: {
            sessionId,
            user: {
              id: user.id,
              username: user.username,
              avatarUrl: user.avatarUrl,
              status: effectiveStatus,
              customStatus: user.customStatus,
              bio: user.bio,
            },
            guilds: hydratedGuilds,
            voiceStates: Array.from(this.voiceStates.values()),
          },
        });

        // 向共同公会成员广播在线状态更新 (PRESENCE_UPDATE)
        await this.broadcastPresenceUpdate(user.id, presence);
        break;
      }

      case GatewayOpCode.STATUS_UPDATE: {
        if (!conn.userId) return;
        const data = payload.d as StatusUpdatePayload;
        if (!data || !data.status) return;

        // 1. 更新数据库持久化偏好
        await prisma.user.update({
          where: { id: conn.userId },
          data: {
            status: data.status,
            ...(data.customStatus !== undefined
              ? { customStatus: data.customStatus }
              : {}),
          },
        });

        // 2. 更新瞬时缓存
        const presence: UserPresence = {
          userId: conn.userId,
          status: data.status,
          customStatus: data.customStatus,
          clientStatus: {
            web: data.status,
          },
          lastActiveAt: new Date().toISOString(),
        };
        await cacheStore.setUserPresence(conn.userId, presence);

        // 3. 向共同公会广播 PRESENCE_UPDATE
        await this.broadcastPresenceUpdate(conn.userId, presence);
        break;
      }

      case GatewayOpCode.VOICE_STATE_UPDATE: {
        if (!conn.userId || !conn.sessionId) return;
        const data = payload.d as VoiceStateUpdatePayload;
        const user = await prisma.user.findUnique({
          where: { id: conn.userId },
        });

        const existingVoice = this.voiceStates.get(conn.userId);

        if (data.channelId) {
          // 1. 如果已有语音会话，且来自不同 sessionId，进行互斥裁决与踢出旧设备
          if (
            existingVoice &&
            existingVoice.sessionId &&
            existingVoice.sessionId !== conn.sessionId
          ) {
            const oldSessionId = existingVoice.sessionId;
            const oldConn = this.userSessions
              .get(conn.userId)
              ?.get(oldSessionId);
            const targetPlatform =
              conn.properties?.device || conn.properties?.os || "其他设备";

            if (oldConn && oldConn.ws.readyState === WebSocket.OPEN) {
              this.send(oldConn.ws, {
                op: GatewayOpCode.DISPATCH,
                t: "VOICE_SERVER_DISCONNECT",
                d: {
                  reason: "VOICE_TRANSFER",
                  newChannelId: data.channelId,
                  targetPlatform,
                } as VoiceServerDisconnectPayload,
              });
            }

            // 若旧会话所在频道与新频道不同，兜底从旧 LiveKit 房间移除该参与者
            if (
              existingVoice.channelId &&
              existingVoice.channelId !== data.channelId
            ) {
              removeParticipantFromRoom(existingVoice.channelId, conn.userId);
            }
          }

          const platform =
            conn.properties?.device || conn.properties?.os || "Web";
          const voiceState: VoiceState = {
            userId: conn.userId,
            guildId: data.guildId,
            channelId: data.channelId,
            sessionId: conn.sessionId,
            platform,
            selfMute: !!data.selfMute,
            selfDeaf: !!data.selfDeaf,
            selfVideo: !!data.selfVideo,
            streaming: !!data.streaming,
            streamMode: data.streamMode || "sfu",
            user: user
              ? {
                  id: user.id,
                  username: user.username,
                  avatarUrl: user.avatarUrl || undefined,
                  status: user.status as any,
                  email: user.email,
                  createdAt: user.createdAt.toISOString(),
                }
              : undefined,
          };

          this.voiceStates.set(conn.userId, voiceState);
          this.broadcast({
            op: GatewayOpCode.DISPATCH,
            t: "VOICE_STATE_UPDATE",
            d: voiceState,
          });

          // 如果用户开启了 P2P 模式直播，初始化拓扑并向频道内广播
          if (
            data.streaming &&
            (data.streamMode === "p2p_direct" ||
              data.streamMode === "p2p_relay")
          ) {
            const topology = p2pTopologyManager.registerStream(
              data.channelId,
              data.guildId,
              conn.userId,
              data.streamMode,
            );
            this.broadcastChannel(data.channelId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.P2P_TOPOLOGY_UPDATE,
              d: topology,
            });
          } else if (
            !data.streaming &&
            existingVoice?.streaming &&
            existingVoice.channelId
          ) {
            p2pTopologyManager.unregisterStream(existingVoice.channelId);
            this.broadcastChannel(existingVoice.channelId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.P2P_TOPOLOGY_UPDATE,
              d: {
                streamOwnerId: conn.userId,
                channelId: existingVoice.channelId,
                transmissionMode: "sfu",
                nodes: {},
              },
            });
          }
        } else {
          // 退出语音：仅当当前持有语音的 sessionId 发起时才处理，避免无关标签页关闭误退
          if (!existingVoice || existingVoice.sessionId === conn.sessionId) {
            this.voiceStates.delete(conn.userId);
            this.broadcast({
              op: GatewayOpCode.DISPATCH,
              t: "VOICE_STATE_UPDATE",
              d: {
                userId: conn.userId,
                channelId: null,
                guildId: data.guildId,
                sessionId: conn.sessionId,
                selfMute: false,
                selfDeaf: false,
                selfVideo: false,
                streaming: false,
              },
            });

            if (existingVoice?.channelId) {
              p2pTopologyManager.removeViewer(
                existingVoice.channelId,
                conn.userId,
              );
              if (existingVoice.streaming) {
                p2pTopologyManager.unregisterStream(existingVoice.channelId);
              }
            }
          }
        }
        break;
      }

      case GatewayOpCode.DISPATCH: {
        if (payload.t === GatewayEvents.TYPING_START) {
          if (!conn.userId) return;
          const { channelId } = (payload.d || {}) as { channelId?: string };
          if (!channelId) return;

          const user = await prisma.user.findUnique({
            where: { id: conn.userId },
            select: { id: true, username: true, avatarUrl: true },
          });
          if (!user) return;

          this.broadcastTyping(channelId, user);
        } else if (payload.t === GatewayEvents.P2P_SIGNAL) {
          const signalData = payload.d as P2PSignalPayload;
          if (!signalData || !conn.userId) return;
          signalData.senderId = conn.userId;

          if (signalData.targetId) {
            this.sendToUser(signalData.targetId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.P2P_SIGNAL,
              d: signalData,
            });
          } else if (signalData.channelId) {
            this.broadcastChannel(
              signalData.channelId,
              {
                op: GatewayOpCode.DISPATCH,
                t: GatewayEvents.P2P_SIGNAL,
                d: signalData,
              },
              conn.userId,
            );
          }
        } else if (payload.t === GatewayEvents.P2P_TOPOLOGY_UPDATE) {
          const { channelId, initialMetrics } = (payload.d || {}) as {
            channelId: string;
            initialMetrics?: P2PNodeMetrics;
          };
          if (!channelId || !conn.userId) return;
          const result = p2pTopologyManager.addViewer(
            channelId,
            conn.userId,
            initialMetrics,
          );
          if (result) {
            this.broadcastChannel(channelId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.P2P_TOPOLOGY_UPDATE,
              d: result.payload,
            });
          }
        } else if (payload.t === GatewayEvents.P2P_QUALITY_REPORT) {
          const { channelId, metrics } = (payload.d || {}) as {
            channelId: string;
            metrics: P2PNodeMetrics;
          };
          if (!channelId || !conn.userId || !metrics) return;
          const updatedTopology = p2pTopologyManager.reportMetrics(
            channelId,
            conn.userId,
            metrics,
          );
          if (updatedTopology) {
            this.broadcastChannel(channelId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.P2P_TOPOLOGY_UPDATE,
              d: updatedTopology,
            });
          }
        } else if (payload.t === GatewayEvents.P2P_FALLBACK_REQUEST) {
          const { channelId } = (payload.d || {}) as { channelId: string };
          if (!channelId || !conn.userId) return;
          const updatedTopology = p2pTopologyManager.removeViewer(
            channelId,
            conn.userId,
          );
          if (updatedTopology) {
            this.broadcastChannel(channelId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.P2P_TOPOLOGY_UPDATE,
              d: updatedTopology,
            });
          }
        }
        break;
      }

      default:
        break;
    }
  }

  broadcastTyping(
    channelId: string,
    user: { id: string; username: string; avatarUrl?: string | null },
  ) {
    const payload: GatewayPayload<TypingIndicatorPayload> = {
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.TYPING_START,
      d: {
        channelId,
        userId: user.id,
        user: {
          id: user.id,
          username: user.username,
          avatarUrl: user.avatarUrl,
        },
        timestamp: Date.now(),
      },
    };
    const data = JSON.stringify(payload);
    for (const conn of this.connections) {
      if (conn.userId !== user.id && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(data);
      }
    }
  }

  broadcastChannel(
    channelId: string,
    payload: GatewayPayload,
    excludeUserId?: string,
  ) {
    const data = JSON.stringify(payload);
    for (const [userId, voiceState] of this.voiceStates.entries()) {
      if (voiceState.channelId === channelId && userId !== excludeUserId) {
        const sessions = this.userSessions.get(userId);
        if (sessions) {
          for (const conn of sessions.values()) {
            if (conn.ws.readyState === WebSocket.OPEN) {
              conn.ws.send(data);
            }
          }
        }
      }
    }
  }

  broadcast(payload: GatewayPayload) {
    const data = JSON.stringify(payload);
    for (const conn of this.connections) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(data);
      }
    }
  }

  send(ws: WebSocket, payload: GatewayPayload) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  sendToUser(userId: string, payload: GatewayPayload) {
    const sessions = this.userSessions.get(userId);
    if (sessions) {
      for (const conn of sessions.values()) {
        this.send(conn.ws, payload);
      }
    }
  }

  private cleanup(conn: ClientConnection) {
    if (conn.userId && conn.sessionId) {
      const sessions = this.userSessions.get(conn.userId);
      if (sessions) {
        sessions.delete(conn.sessionId);
        if (sessions.size === 0) {
          this.userSessions.delete(conn.userId);

          // 最后一个 Session 断开，启动 3.5 秒断线防抖缓冲
          const userId = conn.userId;
          if (this.disconnectGraceTimers.has(userId)) {
            clearTimeout(this.disconnectGraceTimers.get(userId)!);
          }
          const timer = setTimeout(async () => {
            this.disconnectGraceTimers.delete(userId);
            const currentSessions = this.userSessions.get(userId);
            if (!currentSessions || currentSessions.size === 0) {
              await this.setUserOffline(userId);
            }
          }, 3500);
          this.disconnectGraceTimers.set(userId, timer);
        }
      }

      const endedCall = dmCallService.onDisconnect(conn.userId, conn.sessionId);
      if (endedCall) {
        const event = {
          callId: endedCall.callId,
          channelId: endedCall.channelId,
          endedBy: conn.userId,
          reason: endedCall.endedReason,
        };
        this.sendToUser(endedCall.callerId, {
          op: GatewayOpCode.DISPATCH,
          t: GatewayEvents.CALL_END,
          d: event,
        });
        this.sendToUser(endedCall.calleeId, {
          op: GatewayOpCode.DISPATCH,
          t: GatewayEvents.CALL_END,
          d: event,
        });
      }

      // 仅当断开的连接其 sessionId 恰好是当前活跃语音的持有者时，才清理语音状态并全网广播
      const currentVoice = this.voiceStates.get(conn.userId);
      if (currentVoice && currentVoice.sessionId === conn.sessionId) {
        this.voiceStates.delete(conn.userId);
        this.broadcast({
          op: GatewayOpCode.DISPATCH,
          t: "VOICE_STATE_UPDATE",
          d: {
            userId: conn.userId,
            channelId: null,
            guildId: currentVoice.guildId,
            sessionId: conn.sessionId,
            selfMute: false,
            selfDeaf: false,
            selfVideo: false,
            streaming: false,
          },
        });
      }
    }
    this.connections.delete(conn);
  }

  async setUserOffline(userId: string) {
    const offlinePresence: UserPresence = {
      userId,
      status: "OFFLINE",
      lastActiveAt: new Date().toISOString(),
    };
    await cacheStore.setUserPresence(userId, offlinePresence);
    await this.broadcastPresenceUpdate(userId, offlinePresence);
  }

  async broadcastPresenceUpdate(userId: string, presence: UserPresence) {
    try {
      // 1. 获取该用户加入的所有公会
      const userMemberships = await prisma.guildMember.findMany({
        where: { userId },
        select: { guildId: true },
      });
      const guildIds = userMemberships.map((m) => m.guildId);

      // 2. 获取这些公会中的所有成员 ID
      const mutualMembers = await prisma.guildMember.findMany({
        where: { guildId: { in: guildIds } },
        select: { userId: true },
      });
      const targetUserIds = new Set(mutualMembers.map((m) => m.userId));
      targetUserIds.add(userId);

      // 3. 向所有相关在线设备推送
      for (const targetId of targetUserIds) {
        const sessions = this.userSessions.get(targetId);
        if (!sessions || sessions.size === 0) continue;

        // 若当前用户处于 INVISIBLE 隐身状态，他人视角统一显示为 OFFLINE
        const visibleStatus =
          targetId !== userId && presence.status === "INVISIBLE"
            ? "OFFLINE"
            : presence.status;

        const eventPayload: GatewayPayload<PresenceUpdateEvent> = {
          op: GatewayOpCode.DISPATCH,
          t: GatewayEvents.PRESENCE_UPDATE,
          d: {
            userId,
            status: visibleStatus,
            customStatus: presence.customStatus,
            clientStatus: presence.clientStatus,
            lastActiveAt: presence.lastActiveAt,
          },
        };

        for (const sConn of sessions.values()) {
          this.send(sConn.ws, eventPayload);
        }
      }
    } catch (err) {
      console.error("[Gateway] broadcastPresenceUpdate error:", err);
    }
  }

  /**
   * 处理来自 LiveKit Webhook 的参与者离开事件（权威兜底清理）
   * 当客户端崩溃、掉线、网络异常中断或被 LiveKit SFU 超时移除时，由 LiveKit 服务端主动通知网关收敛状态
   */
  public handleLiveKitParticipantLeft(userId: string, roomName?: string): boolean {
    const currentVoice = this.voiceStates.get(userId);
    if (!currentVoice) {
      return false;
    }

    // 若提供了 roomName，校验是否是当前频道的离开事件（避免旧房间事件误杀新房间状态）
    if (roomName && currentVoice.channelId !== roomName) {
      console.log(
        `[Gateway] Ignored LiveKit participant_left for ${userId} in ${roomName} (current channel: ${currentVoice.channelId})`
      );
      return false;
    }

    console.log(
      `[Gateway] LiveKit webhook reconciled: removing user ${userId} from voice channel ${currentVoice.channelId}`
    );

    this.voiceStates.delete(userId);
    this.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: "VOICE_STATE_UPDATE",
      d: {
        userId,
        channelId: null,
        guildId: currentVoice.guildId,
        sessionId: currentVoice.sessionId,
        selfMute: false,
        selfDeaf: false,
        selfVideo: false,
        streaming: false,
      },
    });

    if (currentVoice.channelId) {
      p2pTopologyManager.removeViewer(currentVoice.channelId, userId);
      if (currentVoice.streaming) {
        p2pTopologyManager.unregisterStream(currentVoice.channelId);
      }
    }

    return true;
  }

  getOnlineUserCount(): number {
    return this.userSessions.size;
  }

  disconnectUser(userId: string) {
    dmCallService.terminateForUser(userId, "account_session_revoked");
    const sessions = this.userSessions.get(userId);
    if (sessions) {
      for (const conn of sessions.values()) {
        try {
          conn.ws.close(4003, "Account terminated or banned");
        } catch {
          // ignore
        }
      }
    }
  }

  terminateActiveCall(userId: string, reason: string) {
    return dmCallService.terminateForUser(userId, reason);
  }

  private async terminateCallMedia(channelId: string, callId: string, userIds: string[]) {
    const roomName = `dm_${channelId}_${callId}`;
    await Promise.allSettled(userIds.map((userId) => removeParticipantFromRoom(roomName, userId)));
  }

  async broadcastTypingAuthorized(
    channelId: string,
    user: { id: string; username: string; avatarUrl?: string | null },
  ) {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        recipients: { select: { userId: true } },
        guild: { include: { members: { select: { userId: true } } } },
      },
    });
    if (!channel) return;
    const recipients = channel.type === "DM" || channel.type === "GROUP_DM"
      ? channel.recipients.map((item) => item.userId)
      : channel.guild?.members.map((item) => item.userId) || [];
    if (!recipients.includes(user.id)) return;
    for (const userId of recipients) {
      if (userId === user.id) continue;
      this.sendToUser(userId, {
        op: GatewayOpCode.DISPATCH,
        t: GatewayEvents.TYPING_START,
        d: { channelId, userId: user.id, user, timestamp: Date.now() },
      });
    }
  }

  async disconnectNonSuperAdmins(reason = "Maintenance mode") {
    const userIds = Array.from(this.userSessions.keys());
    const admins = await prisma.user.findMany({
      where: { id: { in: userIds }, role: "SUPER_ADMIN", isBanned: false },
      select: { id: true },
    });
    const allowed = new Set(admins.map((user) => user.id));
    for (const userId of userIds) {
      if (allowed.has(userId)) continue;
      dmCallService.terminateForUser(userId, "maintenance_mode");
      const sessions = this.userSessions.get(userId);
      for (const conn of sessions?.values() || []) {
        try {
          this.send(conn.ws, {
            op: GatewayOpCode.DISPATCH,
            t: GatewayEvents.MAINTENANCE_UPDATE,
            d: { enabled: true, reason },
          });
          conn.ws.close(4013, reason);
        } catch {}
      }
    }
  }
}

export const gatewayManager = new GatewayManager();
