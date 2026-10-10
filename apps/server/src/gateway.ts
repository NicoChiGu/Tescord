import { dmCallService } from "./services/dm-call.service.js";
import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import {
  GatewayOpCode,
  GatewayCloseCode,
  GatewayPayload,
  HelloPayload,
  HeartbeatData,
  IdentifyPayload,
  VoiceStateUpdatePayload,
  VoiceState,
  VoiceServerDisconnectPayload,
  GatewayEvents,
  MEDIA_ENCRYPTION_VERSION,
  ErrorCode,
  isMediaEncryptionSyncRequest,
  MediaEncryptionSyncResult,
  P2PSignalPayload,
  P2PNodeMetrics,
  UserStatus,
  UserPresence,
  StatusUpdatePayload,
  PresenceUpdateEvent,
  MaintenanceUpdatePayload,
  PermissionFlags,
  DMCallOfferPayload,
  DMCallActionPayload,
  DMCallSession,
  DMCallEndedPayload,
} from "@tescord/types";
import { prisma } from "./db.js";
import { removeParticipantFromRoom } from "./livekit.js";
import { p2pTopologyManager } from "./p2pTopology.js";
import { cacheStore } from "./cache.js";
import { permissionService } from "./services/permission.service.js";
import { cloudflareRealtimeService } from "./services/cloudflare-realtime.service.js";

interface ClientConnection {
  ws: WebSocket;
  userId?: string;
  sessionVersion?: number;
  tokenExpiresAt?: number;
  sessionId?: string;
  authSessionId?: string;
  properties?: {
    os?: string;
    browser?: string;
    device?: string;
  };
  isAlive: boolean;
  heartbeatIntervalTimer?: NodeJS.Timeout;
  authTimer?: NodeJS.Timeout;
  sessionStatus?: "ONLINE" | "IDLE";
  mediaSyncPending?: number;
}

export class GatewayManager {
  private tokenVerifier?: (token: string) => Promise<Record<string, unknown>>;
  public setTokenVerifier(
    verifier: (token: string) => Promise<Record<string, unknown>>,
  ) {
    this.tokenVerifier = verifier;
  }
  private connections: Set<ClientConnection> = new Set();
  // 多端/多会话映射：userId -> Map<sessionId, ClientConnection>
  private userSessions: Map<string, Map<string, ClientConnection>> = new Map();

  /**
   * 重新裁决并聚合指定用户的瞬时在线状态
   * 规则：
   * 1. 若用户在数据库的偏好为显式手动设置的 "DND"、"INVISIBLE"、"IDLE" 或 "OFFLINE"，严格遵循用户的手动设置；
   * 2. 若用户偏好为 "ONLINE"（默认在线）：
   *    - 若没有任何连接，状态为 "OFFLINE"；
   *    - 只要其中任意一个在线连接处于活跃状态 (sessionStatus !== "IDLE")，用户全局状态即为 "ONLINE"；
   *    - 只有当所有已连接的会话都上报闲置 (sessionStatus === "IDLE") 时，才聚合为 "IDLE"。
   */
  public async recalculateUserPresence(userId: string): Promise<UserStatus> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, customStatus: true, showActivity: true },
    });
    if (!user) return "OFFLINE";

    const userPref = (user.status as UserStatus) || "ONLINE";
    const sessions = this.userSessions.get(userId);
    const hasAnySession = Boolean(sessions && sessions.size > 0);

    let effectiveStatus: UserStatus;
    if (!hasAnySession) {
      effectiveStatus = "OFFLINE";
    } else if (userPref === "ONLINE" || userPref === "OFFLINE") {
      const hasAnyActiveSession = Array.from(sessions!.values()).some(
        (s) => s.ws.readyState === WebSocket.OPEN && s.sessionStatus !== "IDLE",
      );
      effectiveStatus = hasAnyActiveSession ? "ONLINE" : "IDLE";
    } else {
      effectiveStatus = userPref;
    }

    const currentPresence = await cacheStore.getUserPresence(userId);
    const presence: UserPresence = {
      userId,
      status: effectiveStatus,
      customStatus: user.customStatus,
      activities: currentPresence?.activities,
      clientStatus: {
        ...(currentPresence?.clientStatus || {}),
        web: effectiveStatus,
      },
      lastActiveAt: new Date().toISOString(),
    };

    await cacheStore.setUserPresence(
      userId,
      presence,
      effectiveStatus === "OFFLINE" ? 86400 : 90,
    );
    await this.broadcastPresenceUpdate(userId, presence);
    return effectiveStatus;
  }

  public setUserSessionsStatus(userId: string, status: "ONLINE" | "IDLE") {
    const sessions = this.userSessions.get(userId);
    if (sessions) {
      for (const s of sessions.values()) {
        s.sessionStatus = status;
      }
    }
  }
  // 全网单用户仅存一个活跃语音会话：userId -> VoiceState
  private voiceStates: Map<string, VoiceState> = new Map();
  private mediaJoinTimers = new Map<string, NodeJS.Timeout>();
  public confirmMediaRegistration(
    userId: string,
    channelId: string,
    sessionId: string,
  ): void {
    const state = this.voiceStates.get(userId);
    if (state?.channelId !== channelId || state.sessionId !== sessionId) return;
    const timer = this.mediaJoinTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.mediaJoinTimers.delete(userId);
  }
  public expireMediaParticipant(
    userId: string,
    channelId: string,
    sessionId: string,
  ): void {
    const state = this.voiceStates.get(userId);
    if (state?.channelId !== channelId || state.sessionId !== sessionId) return;
    this.confirmMediaRegistration(userId, channelId, sessionId);
    this.voiceStates.delete(userId);
    p2pTopologyManager.removeViewer(channelId, userId);
    for (const [id, media] of cloudflareRealtimeService.listSessions()) {
      if (
        media.userId === userId &&
        media.channelId === channelId &&
        media.gatewaySessionId === sessionId
      )
        void cloudflareRealtimeService.revokeSession(id).catch(() => {});
    }
    if (state.streaming) p2pTopologyManager.unregisterStream(channelId, userId);
    const conn = this.userSessions.get(userId)?.get(sessionId);
    if (conn)
      this.send(conn.ws, {
        op: GatewayOpCode.DISPATCH,
        t: "VOICE_SERVER_DISCONNECT",
        d: {
          reason: "MEDIA_NEGOTIATION_TIMEOUT",
        } satisfies VoiceServerDisconnectPayload,
      });
    void this.broadcastToChannelViewers(channelId, {
      op: GatewayOpCode.DISPATCH,
      t: "VOICE_STATE_UPDATE",
      d: {
        ...state,
        channelId: null,
        previousChannelId: channelId,
        revision: this.nextVoiceRevision(userId),
        streaming: false,
      },
    });
  }
  public getMediaVoiceState(userId: string): VoiceState | null {
    const state = this.voiceStates.get(userId);
    return state?.sessionId &&
      this.hasIdentifiedSession(userId, state.sessionId)
      ? { ...state }
      : null;
  }
  public getMediaVoiceRoster(channelId: string): VoiceState[] {
    return [...this.voiceStates.keys()]
      .map((id) => this.getMediaVoiceState(id))
      .filter((state): state is VoiceState =>
        Boolean(state?.channelId === channelId),
      );
  }
  private voiceRevisions: Map<string, number> = new Map();
  private nextVoiceRevision(userId: string): number {
    const revision = (this.voiceRevisions.get(userId) ?? 0) + 1;
    this.voiceRevisions.set(userId, revision);
    return revision;
  }
  private transferTimestamps: Map<string, number> = new Map();
  // 进房过渡锁：防止进房 DB 异步鉴权期间并发到来的 WebRTC 信令被静默丢弃
  private pendingVoiceJoins: Map<
    string,
    { channelId: string; sessionId: string; timestamp: number }
  > = new Map();
  public hasIdentifiedSession(userId: string, sessionId: string): boolean {
    const conn = this.userSessions.get(userId)?.get(sessionId);
    return conn?.userId === userId && conn.ws.readyState === WebSocket.OPEN;
  }
  public hasIdentifiedLoginSession(
    userId: string,
    sessionId: string,
    loginSessionId: string,
    sessionVersion?: number,
  ): boolean {
    const conn = this.userSessions.get(userId)?.get(sessionId);
    return (
      conn?.userId === userId &&
      conn.authSessionId === loginSessionId &&
      (sessionVersion === undefined ||
        conn.sessionVersion === sessionVersion) &&
      conn.ws.readyState === WebSocket.OPEN
    );
  }
  // 离线防抖缓冲池：userId -> NodeJS.Timeout (3.5秒防抖)
  public isMaintenanceActive = false;
  public maintenancePayload: MaintenanceUpdatePayload = {
    enabled: false,
    announcement: "",
  };
  private disconnectGraceTimers: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatSweepTimer: NodeJS.Timeout;

  constructor() {
    this.initMaintenanceState();
    dmCallService.setEndSink((call) => this.publishCallEnd(call, "system"));
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
    if (this.heartbeatSweepTimer.unref) {
      this.heartbeatSweepTimer.unref();
    }
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

    // 2. 未认证连接 15 秒超时自动踢出，防范未认证僵尸长连接悬挂
    conn.authTimer = setTimeout(() => {
      if (!conn.userId) {
        console.log(
          "[Gateway] Closing unauthenticated connection due to IDENTIFY timeout",
        );
        this.send(conn.ws, { op: GatewayOpCode.INVALID_SESSION });
        conn.ws.close(
          GatewayCloseCode.UNAUTHORIZED,
          "Authentication timed out",
        );
        this.cleanup(conn);
      }
    }, 15000);
    if (conn.authTimer.unref) {
      conn.authTimer.unref();
    }

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
    if (conn.userId && payload.op !== GatewayOpCode.IDENTIFY) {
      const current = await prisma.user.findUnique({
        where: { id: conn.userId },
        select: { isBanned: true, sessionVersion: true },
      });
      if (!current || current.isBanned) {
        this.send(conn.ws, { op: GatewayOpCode.INVALID_SESSION });
        conn.ws.close(
          GatewayCloseCode.ACCOUNT_BANNED,
          "Account suspended or banned",
        );
        return;
      }
      if (current.sessionVersion !== conn.sessionVersion) {
        this.send(conn.ws, { op: GatewayOpCode.INVALID_SESSION });
        conn.ws.close(GatewayCloseCode.SESSION_INVALID, "Session revoked");
        return;
      }
      const authSession = conn.authSessionId
        ? await prisma.refreshToken.findUnique({
            where: { id: conn.authSessionId },
          })
        : null;
      if (
        !authSession ||
        authSession.userId !== conn.userId ||
        authSession.expiresAt <= new Date()
      ) {
        this.send(conn.ws, { op: GatewayOpCode.INVALID_SESSION });
        conn.ws.close(GatewayCloseCode.SESSION_INVALID, "Session revoked");
        return;
      }
    }
    if (this.isMaintenanceActive) {
      const isAllowedOp =
        payload.op === GatewayOpCode.HEARTBEAT ||
        payload.op === GatewayOpCode.IDENTIFY;
      if (!isAllowedOp && conn.userId) {
        const user = await prisma.user.findUnique({
          where: { id: conn.userId },
          select: { role: true },
        });
        if (user?.role !== "SUPER_ADMIN") {
          return;
        }
      }
    }

    switch (payload.op) {
      case GatewayOpCode.HEARTBEAT:
        conn.isAlive = true;
        if (conn.userId) {
          cacheStore.refreshUserPresence(conn.userId, 90).catch(() => {});
        }
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
        let claims: Record<string, unknown> | null = null;
        try {
          if (
            !conn.userId &&
            typeof data?.token === "string" &&
            this.tokenVerifier
          ) {
            claims = await this.tokenVerifier(data.token);
          }
        } catch {
          // An invalid JWT must never become an authenticated connection.
        }
        const user =
          typeof claims?.sub === "string"
            ? await prisma.user.findUnique({ where: { id: claims.sub } })
            : null;
        if (
          !user ||
          user.isBanned ||
          !Number.isSafeInteger(claims?.sessionVersion) ||
          claims?.sessionVersion !== user.sessionVersion
        ) {
          this.send(conn.ws, {
            op: GatewayOpCode.INVALID_SESSION,
          });
          try {
            conn.ws.close(
              GatewayCloseCode.TOKEN_EXPIRED,
              "Invalid or expired token",
            );
          } catch {
            // ignore
          }
          return;
        }
        const authSession =
          typeof claims?.sessionId === "string"
            ? await prisma.refreshToken.findUnique({
                where: { id: claims.sessionId },
              })
            : null;
        if (
          !authSession ||
          authSession.userId !== user.id ||
          authSession.expiresAt <= new Date()
        ) {
          this.send(conn.ws, { op: GatewayOpCode.INVALID_SESSION });
          conn.ws.close(GatewayCloseCode.SESSION_INVALID, "Session revoked");
          return;
        }
        conn.authSessionId = authSession.id;

        // 若存在断线缓冲定时器，立即清除（说明用户刷新页面重连成功，避免误触发离线）
        if (this.disconnectGraceTimers.has(user.id)) {
          clearTimeout(this.disconnectGraceTimers.get(user.id)!);
          this.disconnectGraceTimers.delete(user.id);
        }

        const sessionId = data?.sessionId || randomUUID();
        conn.userId = user.id;
        conn.sessionVersion = user.sessionVersion;
        conn.tokenExpiresAt =
          typeof claims?.exp === "number" ? claims.exp * 1000 : undefined;
        conn.sessionId = sessionId;
        conn.properties = data?.properties;

        if (conn.authTimer) {
          clearTimeout(conn.authTimer);
          conn.authTimer = undefined;
        }

        if (!this.userSessions.has(user.id)) {
          this.userSessions.set(user.id, new Map());
        }
        const sessions = this.userSessions.get(user.id)!;
        const replacedConnection = sessions.get(sessionId);
        conn.sessionStatus = "ONLINE";
        sessions.set(sessionId, conn);
        if (
          replacedConnection &&
          replacedConnection !== conn &&
          replacedConnection.ws.readyState === WebSocket.OPEN
        ) {
          replacedConnection.ws.close(
            GatewayCloseCode.NORMAL,
            "Session connection replaced",
          );
        }

        // 计算用户有效在线状态并更新缓存与广播（多端在线裁决）
        const effectiveStatus = await this.recalculateUserPresence(user.id);

        // 获取当前用户已加入的公会数据供客户端初始化
        const guilds = await prisma.guild.findMany({
          where: {
            members: {
              some: { userId: user.id },
            },
          },
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
                    displayName: true,
                    avatarUrl: true,
                    status: true,
                    customStatus: true,
                    bio: true,
                    bannerUrl: true,
                    bannerColor: true,
                    themeColor: true,
                    showActivity: true,
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
              const selfPresence = presences.get(user.id);
              return {
                ...m,
                user: {
                  ...m.user,
                  status: effectiveStatus,
                  customStatus: user.customStatus,
                  bannerUrl: user.bannerUrl,
                  bannerColor: user.bannerColor,
                  themeColor: user.themeColor,
                  showActivity: user.showActivity,
                  activities:
                    user.showActivity !== false
                      ? selfPresence?.activities
                      : undefined,
                },
              };
            }
            const p = presences.get(m.userId);
            const isOnline =
              p && p.status !== "OFFLINE" && p.status !== "INVISIBLE";
            const canShowMemberActivity =
              isOnline && m.user.showActivity !== false;
            return {
              ...m,
              user: {
                ...m.user,
                status: isOnline ? p.status : "OFFLINE",
                customStatus:
                  p?.customStatus !== undefined
                    ? p.customStatus
                    : m.user.customStatus,
                activities: canShowMemberActivity ? p?.activities : undefined,
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
            mediaEncryptionSync: true,
            user: {
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
              status: effectiveStatus,
              customStatus: user.customStatus,
              bio: user.bio,
              bannerUrl: user.bannerUrl,
              bannerColor: user.bannerColor,
              themeColor: user.themeColor,
              showActivity: user.showActivity,
              activities:
                user.showActivity !== false
                  ? presences.get(user.id)?.activities
                  : undefined,
            },
            guilds: hydratedGuilds,
            voiceStates: (
              await Promise.all(
                Array.from(this.voiceStates.values())
                  .filter((state) =>
                    guilds.some((guild) => guild.id === state.guildId),
                  )
                  .map(async (state) => {
                    if (!state.channelId) return null;
                    const canView =
                      await permissionService.hasChannelPermission(
                        user.id,
                        state.channelId,
                        PermissionFlags.VIEW_CHANNEL,
                      );
                    return canView ? state : null;
                  }),
              )
            ).filter((s): s is VoiceState => s !== null),
          },
        });

        if (this.isMaintenanceActive && user.role !== "SUPER_ADMIN") {
          this.send(conn.ws, {
            op: GatewayOpCode.DISPATCH,
            t: GatewayEvents.MAINTENANCE_UPDATE,
            d: this.maintenancePayload,
          });
        }
        break;
      }

      case GatewayOpCode.STATUS_UPDATE: {
        if (!conn.userId) return;
        const data = payload.d as StatusUpdatePayload;
        if (!data || !data.status) return;

        if (data.activities !== undefined) {
          const current = await cacheStore.getUserPresence(conn.userId);
          if (current) {
            current.activities = data.activities;
            await cacheStore.setUserPresence(conn.userId, current, 90);
          }
        }

        if (data.isManual) {
          // 1. 用户显式手动设置（在头像弹窗/偏好设置中显式选择状态）
          await prisma.user.update({
            where: { id: conn.userId },
            data: {
              status: data.status,
              ...(data.customStatus !== undefined
                ? { customStatus: data.customStatus }
                : {}),
            },
          });
          conn.sessionStatus = data.status === "IDLE" ? "IDLE" : "ONLINE";
        } else {
          // 2. 会话级活跃度变更 (客户端自动 10 分钟 AFK 或活动唤醒)：
          // 仅记录当前会话的 sessionStatus，绝对不污染持久化数据库的 user.status！
          conn.sessionStatus = data.status === "IDLE" ? "IDLE" : "ONLINE";
          if (data.customStatus !== undefined) {
            await prisma.user.update({
              where: { id: conn.userId },
              data: { customStatus: data.customStatus },
            });
          }
        }

        // 3. 统一多端裁决并向全网广播瞬时在线状态
        await this.recalculateUserPresence(conn.userId);
        break;
      }

      case GatewayOpCode.VOICE_STATE_UPDATE: {
        if (!conn.userId || !conn.sessionId) return;
        const data = payload.d as VoiceStateUpdatePayload;
        const user = await prisma.user.findUnique({
          where: { id: conn.userId },
        });

        const existingVoice = this.voiceStates.get(conn.userId);

        if (
          data.channelId &&
          data.mediaEncryptionVersion !== MEDIA_ENCRYPTION_VERSION
        ) {
          this.send(conn.ws, {
            op: GatewayOpCode.DISPATCH,
            t: "MEDIA_ENCRYPTION_REQUIRED",
            d: {
              channelId: data.channelId,
              code: "MEDIA_E2EE_UNSUPPORTED",
              version: MEDIA_ENCRYPTION_VERSION,
            },
          });
          return;
        }
        if (data.channelId) {
          this.pendingVoiceJoins.set(conn.userId, {
            channelId: data.channelId,
            sessionId: conn.sessionId,
            timestamp: Date.now(),
          });
          const channel = await prisma.channel.findUnique({
            where: { id: data.channelId },
            select: { id: true, guildId: true, type: true },
          });
          if (
            !channel?.guildId ||
            channel.type !== "VOICE" ||
            !(await permissionService.hasChannelPermission(
              conn.userId,
              channel.id,
              PermissionFlags.CONNECT,
            ))
          ) {
            this.pendingVoiceJoins.delete(conn.userId);
            return;
          }
          data.guildId = channel.guildId;
          // 1. 如果已有语音会话，且来自不同 sessionId，进行互斥裁决与踢出旧设备
          if (
            existingVoice &&
            existingVoice.sessionId &&
            existingVoice.sessionId !== conn.sessionId
          ) {
            const oldSessionId = existingVoice.sessionId;
            const targetPlatform =
              conn.properties?.device || conn.properties?.os || "其他设备";
            this.transferTimestamps.set(conn.userId, Date.now());

            // 向旧会话连接发送明确转移并踢出通知
            const oldConn = this.userSessions
              .get(conn.userId)
              ?.get(oldSessionId);
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

            // 无论新旧频道是否相同，均通知 LiveKit 移除旧连接
            if (existingVoice.channelId) {
              removeParticipantFromRoom(existingVoice.channelId, conn.userId);
            }
          }

          // 2. 无论是否来自同一设备，只要频道发生变动 (A 频道 -> B 频道)，必须向原频道全员广播离开信令
          if (
            existingVoice?.channelId &&
            existingVoice.channelId !== data.channelId
          ) {
            await this.broadcastToChannelViewers(
              existingVoice.channelId,
              {
                op: GatewayOpCode.DISPATCH,
                t: "VOICE_STATE_UPDATE",
                d: {
                  userId: conn.userId,
                  guildId: existingVoice.guildId,
                  channelId: null,
                  previousChannelId: existingVoice.channelId,
                  sessionId: conn.sessionId,
                  revision: this.nextVoiceRevision(conn.userId),
                  selfMute: false,
                  selfDeaf: false,
                  selfVideo: false,
                  streaming: false,
                },
              },
              conn.userId,
            );

            removeParticipantFromRoom(existingVoice.channelId, conn.userId);
            if (existingVoice.streaming) {
              p2pTopologyManager.unregisterStream(
                existingVoice.channelId,
                conn.userId,
              );
            }
          }

          const platform =
            conn.properties?.device || conn.properties?.os || "Web";
          // A camera/stream update may omit the microphone fields. Only reuse
          // state from this same voice session; a new device starts fresh.
          const sameVoiceSession =
            existingVoice?.sessionId === conn.sessionId &&
            existingVoice.channelId === data.channelId;
          const voiceState: VoiceState = {
            userId: conn.userId,
            guildId: data.guildId,
            channelId: data.channelId,
            sessionId: conn.sessionId,
            revision: this.nextVoiceRevision(conn.userId),
            platform,
            selfMute:
              data.selfMute ??
              (sameVoiceSession ? existingVoice?.selfMute : false) ??
              false,
            selfDeaf:
              data.selfDeaf ??
              (sameVoiceSession ? existingVoice?.selfDeaf : false) ??
              false,
            selfVideo:
              data.selfVideo ??
              (sameVoiceSession ? existingVoice?.selfVideo : false) ??
              false,
            streaming:
              data.streaming ??
              (sameVoiceSession ? existingVoice?.streaming : false) ??
              false,
            streamMode:
              data.streamMode ??
              (sameVoiceSession ? existingVoice?.streamMode : "sfu") ??
              "sfu",
            user: user
              ? {
                  id: user.id,
                  username: user.username,
                  avatarUrl: user.avatarUrl || undefined,
                  status: user.status as any,
                  createdAt: user.createdAt.toISOString(),
                }
              : undefined,
          };

          this.voiceStates.set(conn.userId, voiceState);
          if (!sameVoiceSession) {
            const previousTimer = this.mediaJoinTimers.get(conn.userId);
            if (previousTimer) clearTimeout(previousTimer);
            const joiningUserId = conn.userId;
            const timer = setTimeout(() => {
              this.mediaJoinTimers.delete(joiningUserId);
              this.expireMediaParticipant(
                joiningUserId,
                channel.id,
                conn.sessionId!,
              );
            }, 10_000);
            timer.unref();
            this.mediaJoinTimers.set(joiningUserId, timer);
          }
          this.pendingVoiceJoins.delete(conn.userId);
          await this.broadcastToChannelViewers(data.channelId, {
            op: GatewayOpCode.DISPATCH,
            t: "VOICE_STATE_UPDATE",
            d: voiceState,
          });

          // 如果用户开启了 P2P 模式直播，初始化拓扑并向频道内广播
          if (
            voiceState.streaming &&
            (voiceState.streamMode === "p2p_direct" ||
              voiceState.streamMode === "p2p_relay") &&
            (!existingVoice?.streaming ||
              existingVoice.channelId !== data.channelId ||
              existingVoice.streamMode !== voiceState.streamMode ||
              existingVoice.sessionId !== conn.sessionId)
          ) {
            const topology = p2pTopologyManager.registerStream(
              data.channelId,
              data.guildId,
              conn.userId,
              voiceState.streamMode,
            );
            await this.broadcastChannel(data.channelId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.P2P_TOPOLOGY_UPDATE,
              d: topology,
            });
          } else if (
            !voiceState.streaming &&
            existingVoice?.streaming &&
            existingVoice.channelId
          ) {
            p2pTopologyManager.unregisterStream(
              existingVoice.channelId,
              conn.userId,
            );
            await this.broadcastChannel(existingVoice.channelId, {
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
          if (
            existingVoice?.channelId &&
            existingVoice.sessionId === conn.sessionId
          ) {
            this.voiceStates.delete(conn.userId);
            this.pendingVoiceJoins.delete(conn.userId);
            await this.broadcastToChannelViewers(existingVoice.channelId, {
              op: GatewayOpCode.DISPATCH,
              t: "VOICE_STATE_UPDATE",
              d: {
                userId: conn.userId,
                channelId: null,
                guildId: existingVoice.guildId,
                sessionId: conn.sessionId,
                revision: this.nextVoiceRevision(conn.userId),
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
                p2pTopologyManager.unregisterStream(
                  existingVoice.channelId,
                  conn.userId,
                );
              }
            }
          }
        }
        break;
      }

      case GatewayOpCode.DISPATCH: {
        if (payload.t === GatewayEvents.MEDIA_ENCRYPTION_SYNC) {
          await this.syncMediaEncryption(conn, payload.d as unknown);
          return;
        }
        if (payload.t === GatewayEvents.CALL_OFFER) {
          if (!conn.userId || !conn.sessionId) return;
          const data = payload.d as DMCallOfferPayload | undefined;
          if (data?.mediaEncryptionVersion !== MEDIA_ENCRYPTION_VERSION) {
            this.send(conn.ws, {
              op: GatewayOpCode.DISPATCH,
              t: "MEDIA_ENCRYPTION_REQUIRED",
              d: {
                code: "MEDIA_E2EE_UNSUPPORTED",
                version: MEDIA_ENCRYPTION_VERSION,
              },
            });
            return;
          }
          if (
            typeof data?.channelId !== "string" ||
            !data.channelId ||
            data.channelId.length > 160 ||
            typeof data.hasVideo !== "boolean"
          )
            return;
          try {
            const call = await dmCallService.start(
              conn.userId,
              conn.sessionId,
              data.channelId,
              data.hasVideo,
            );
            const caller = await prisma.user.findUnique({
              where: { id: conn.userId },
              select: { id: true, username: true, avatarUrl: true },
            });
            if (!caller) return;
            this.send(conn.ws, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.CALL_STATE_UPDATE,
              d: {
                callId: call.callId,
                channelId: call.channelId,
                callerId: call.callerId,
                hasVideo: call.hasVideo,
                state: call.state,
              },
            });
            this.sendToUser(call.calleeId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.CALL_OFFER,
              d: {
                callId: call.callId,
                channelId: call.channelId,
                caller,
                hasVideo: call.hasVideo,
              },
            });
          } catch {
            this.send(conn.ws, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.CALL_END,
              d: {
                callId: "",
                channelId: data.channelId,
                endedBy: "system",
                reason: "call_unavailable",
              },
            });
          }
        } else if (payload.t === GatewayEvents.CALL_ANSWER) {
          if (!conn.userId || !conn.sessionId) return;
          const data = payload.d as DMCallActionPayload | undefined;
          if (data?.mediaEncryptionVersion !== MEDIA_ENCRYPTION_VERSION) {
            this.send(conn.ws, {
              op: GatewayOpCode.DISPATCH,
              t: "MEDIA_ENCRYPTION_REQUIRED",
              d: {
                code: "MEDIA_E2EE_UNSUPPORTED",
                version: MEDIA_ENCRYPTION_VERSION,
              },
            });
            return;
          }
          if (
            typeof data?.callId !== "string" ||
            !data.callId ||
            data.callId.length > 160
          )
            return;
          try {
            const call = dmCallService.answer(
              conn.userId,
              conn.sessionId,
              data.callId,
            );
            const event = { callId: call.callId, channelId: call.channelId };
            if (!call.callerSessionId) return;
            this.sendToSession(call.callerId, call.callerSessionId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.CALL_ANSWER,
              d: event,
            });
            this.send(conn.ws, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.CALL_ANSWER,
              d: event,
            });
            const state = {
              ...event,
              callerId: call.callerId,
              hasVideo: call.hasVideo,
              state: "active" as const,
            };
            this.sendToSession(call.callerId, call.callerSessionId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.CALL_STATE_UPDATE,
              d: state,
            });
            this.send(conn.ws, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.CALL_STATE_UPDATE,
              d: state,
            });
          } catch {
            /* Invalid call and nonparticipant attempts are silent. */
          }
        } else if (
          payload.t === GatewayEvents.CALL_REJECT ||
          payload.t === GatewayEvents.CALL_END
        ) {
          if (!conn.userId || !conn.sessionId) return;
          const data = payload.d as DMCallActionPayload | undefined;
          if (
            typeof data?.callId !== "string" ||
            !data.callId ||
            data.callId.length > 160
          )
            return;
          try {
            const call =
              payload.t === GatewayEvents.CALL_REJECT
                ? dmCallService.reject(conn.userId, data.callId)
                : dmCallService.end(
                    conn.userId,
                    data.callId,
                    typeof data.reason === "string" && data.reason.length <= 80
                      ? data.reason
                      : "ended",
                  );
            this.publishCallEnd(call, conn.userId);
          } catch {
            /* Invalid call and nonparticipant attempts are silent. */
          }
        } else if (payload.t === GatewayEvents.TYPING_START) {
          if (!conn.userId) return;
          const { channelId } = (payload.d || {}) as { channelId?: string };
          if (!channelId) return;

          const user = await prisma.user.findUnique({
            where: { id: conn.userId },
            select: { id: true, username: true, avatarUrl: true },
          });
          if (!user) return;

          await this.broadcastTypingAuthorized(channelId, user);
        } else if (payload.t === GatewayEvents.P2P_SIGNAL) {
          const signalData = payload.d as P2PSignalPayload;
          if (!signalData || !conn.userId || !conn.sessionId) return;
          if (
            signalData.negotiationId !== undefined &&
            (typeof signalData.negotiationId !== "string" ||
              !/^[a-zA-Z0-9-]{1,64}$/.test(signalData.negotiationId))
          )
            return;
          if (signalData.callId) {
            if (
              !signalData.channelId ||
              !signalData.targetId ||
              !signalData.callId ||
              signalData.channelId.length > 160 ||
              signalData.callId.length > 160 ||
              ![
                "VOICE_OFFER",
                "VOICE_ANSWER",
                "VOICE_ICE_CANDIDATE",
                "VOICE_LEAVE",
              ].includes(signalData.type)
            )
              return;
            try {
              const call = dmCallService.authorizeMedia(
                conn.userId,
                conn.sessionId,
                signalData.callId,
                signalData.channelId,
              );
              const peerId =
                call.callerId === conn.userId ? call.calleeId : call.callerId;
              if (signalData.targetId !== peerId) return;
              signalData.senderId = conn.userId;
              signalData.senderSessionId = conn.sessionId;
              signalData.streamOwnerId = conn.userId;
              signalData.guildId = "";
              const peerSessionId =
                peerId === call.callerId
                  ? call.callerSessionId
                  : call.acceptedSessionId;
              if (!peerSessionId) return;
              this.sendToSession(peerId, peerSessionId, {
                op: GatewayOpCode.DISPATCH,
                t: GatewayEvents.P2P_SIGNAL,
                d: signalData,
              });
            } catch {
              /* Reject forged or expired DM media signalling. */
            }
            return;
          }
          if (
            !signalData.channelId ||
            !(await this.canSignalVoice(conn, signalData.channelId))
          )
            return;
          if (signalData.targetId) {
            const targetVoice = this.voiceStates.get(signalData.targetId);
            const targetPending = this.pendingVoiceJoins.get(
              signalData.targetId,
            );
            const targetInChannel =
              targetVoice?.channelId === signalData.channelId ||
              (targetPending?.channelId === signalData.channelId &&
                Date.now() - targetPending.timestamp < 5000);
            if (!targetInChannel) return;
          }
          if (
            signalData.targetId &&
            !(await permissionService.hasChannelPermission(
              signalData.targetId,
              signalData.channelId,
              PermissionFlags.CONNECT,
            ))
          )
            return;
          signalData.senderId = conn.userId;
          signalData.senderSessionId = conn.sessionId;
          if (signalData.type === "STREAM_KICK") {
            // The user who owns the active stream is the only one allowed to
            // remove a viewer. Never trust streamOwnerId supplied by a client.
            if (
              !signalData.targetId ||
              signalData.targetId === conn.userId ||
              signalData.streamOwnerId !== conn.userId ||
              this.voiceStates.get(conn.userId)?.channelId !==
                signalData.channelId
            )
              return;
            const cfHost = cloudflareRealtimeService
              .getTracks(signalData.channelId)
              .some(
                (track) =>
                  track.source === "screen" && track.userId === conn.userId,
              );
            // A Cloudflare publication can be ready before the separate voice
            // state update arrives. The server-owned screen track is sufficient
            // proof of an active stream; P2P still requires streaming state.
            if (!cfHost && !this.voiceStates.get(conn.userId)?.streaming)
              return;
            if (cfHost) {
              try {
                if (
                  !(await cloudflareRealtimeService.kickStreamViewer(
                    signalData.channelId,
                    conn.userId,
                    signalData.targetId,
                  ))
                ) {
                  console.warn(
                    "[Gateway] STREAM_KICK has no active SFU viewer",
                  );
                  return;
                }
                for (const event of cloudflareRealtimeService.drainViewerEvents()) {
                  await this.broadcastChannel(event.channelId, {
                    op: GatewayOpCode.DISPATCH,
                    t: GatewayEvents.CF_STREAM_VIEWERS,
                    d: event,
                  });
                }
                this.sendToUser(conn.userId, {
                  op: GatewayOpCode.DISPATCH,
                  t: GatewayEvents.P2P_SIGNAL,
                  d: {
                    ...signalData,
                    type: "STREAM_WATCH_STOP",
                    senderId: signalData.targetId,
                    targetId: conn.userId,
                  },
                });
              } catch (error) {
                // Do not acknowledge a kick while the SFU still sends media.
                console.warn(
                  "[Gateway] STREAM_KICK SFU close failed:",
                  error instanceof Error ? error.message : "unknown",
                );
                return;
              }
            }
          }

          if (!this.hasCurrentVoiceAuthority(conn, signalData.channelId))
            return;
          if (signalData.targetId) {
            this.sendToUser(signalData.targetId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.P2P_SIGNAL,
              d: signalData,
            });
          } else if (signalData.channelId) {
            await this.broadcastChannel(
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
          if (!(await this.canSignalVoice(conn, channelId))) return;
          const result = p2pTopologyManager.addViewer(
            channelId,
            conn.userId,
            initialMetrics,
          );
          if (result) {
            await this.broadcastChannel(channelId, {
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
          if (!(await this.canSignalVoice(conn, channelId))) return;
          const updatedTopology = p2pTopologyManager.reportMetrics(
            channelId,
            conn.userId,
            metrics,
          );
          if (updatedTopology) {
            await this.broadcastChannel(channelId, {
              op: GatewayOpCode.DISPATCH,
              t: GatewayEvents.P2P_TOPOLOGY_UPDATE,
              d: updatedTopology,
            });
          }
        } else if (payload.t === GatewayEvents.P2P_FALLBACK_REQUEST) {
          const { channelId } = (payload.d || {}) as { channelId: string };
          if (!channelId || !conn.userId) return;
          if (!(await this.canSignalVoice(conn, channelId))) return;
          const updatedTopology = p2pTopologyManager.removeViewer(
            channelId,
            conn.userId,
          );
          if (updatedTopology) {
            await this.broadcastChannel(channelId, {
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

  /** Entry: identified socket; identity comes only from conn, never the packet.
   * Resource: registered device in current voice/DM call. The registry rechecks
   * login/device revocation, CONNECT/DM membership and registration generation.
   * Invalid/unidentified/cross-session requests fail closed, without snapshots.
   */
  private async syncMediaEncryption(
    conn: ClientConnection,
    value: unknown,
  ): Promise<void> {
    const raw =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    // Echo only bounded correlation fields. Malformed uncorrelatable packets are dropped.
    if (
      !["requestId", "channelId", "registrationId"].every(
        (key) =>
          typeof raw[key] === "string" &&
          raw[key].length > 0 &&
          raw[key].length <= 160,
      )
    )
      return;
    const correlation = {
      requestId: raw.requestId as string,
      channelId: raw.channelId as string,
      registrationId: raw.registrationId as string,
    };
    const reply = (result: MediaEncryptionSyncResult) =>
      this.send(conn.ws, {
        op: GatewayOpCode.DISPATCH,
        t: GatewayEvents.MEDIA_ENCRYPTION_SYNC_RESULT,
        d: result,
      });
    let counted = false;
    try {
      if (
        !conn.userId ||
        !conn.authSessionId ||
        !conn.sessionId ||
        this.userSessions.get(conn.userId)?.get(conn.sessionId) !== conn ||
        !this.hasIdentifiedLoginSession(
          conn.userId,
          conn.sessionId,
          conn.authSessionId,
          conn.sessionVersion,
        )
      )
        throw new Error(ErrorCode.UNAUTHORIZED);
      if (raw.version !== MEDIA_ENCRYPTION_VERSION)
        throw new Error(ErrorCode.MEDIA_E2EE_UNSUPPORTED);
      if (!isMediaEncryptionSyncRequest(value))
        throw new Error(ErrorCode.INVALID_PARAMS);
      if (value.gatewaySessionId !== conn.sessionId)
        throw new Error(ErrorCode.UNAUTHORIZED);
      if ((conn.mediaSyncPending ?? 0) >= 4)
        throw new Error(ErrorCode.INVALID_PARAMS);
      conn.mediaSyncPending = (conn.mediaSyncPending ?? 0) + 1;
      counted = true;
      const { mediaEncryptionRegistry } =
        await import("./services/media-encryption.service.js");
      const snapshot = await mediaEncryptionRegistry.snapshot(
        conn.userId,
        conn.authSessionId,
        value.channelId,
        value,
      );
      // Send exclusively to the requesting socket, never another device/reconnect.
      if (
        this.userSessions.get(conn.userId)?.get(conn.sessionId) !== conn ||
        !this.hasIdentifiedLoginSession(
          conn.userId,
          conn.sessionId,
          conn.authSessionId,
          conn.sessionVersion,
        )
      )
        throw new Error(ErrorCode.UNAUTHORIZED);
      reply({ ...correlation, success: true, snapshot });
    } catch (error) {
      const code =
        error instanceof Error &&
        Object.values(ErrorCode).includes(error.message as ErrorCode)
          ? (error.message as ErrorCode)
          : ErrorCode.MEDIA_KEY_UNAVAILABLE;
      reply({ ...correlation, success: false, code });
    } finally {
      if (counted) conn.mediaSyncPending = (conn.mediaSyncPending ?? 1) - 1;
    }
  }

  private async canSignalVoice(
    conn: ClientConnection,
    channelId: string,
  ): Promise<boolean> {
    if (!this.hasCurrentVoiceAuthority(conn, channelId)) return false;
    const permitted = await permissionService.hasChannelPermission(
      conn.userId!,
      channelId,
      PermissionFlags.CONNECT,
    );
    return permitted && this.hasCurrentVoiceAuthority(conn, channelId);
  }

  private hasCurrentVoiceAuthority(
    conn: ClientConnection,
    channelId: string,
  ): boolean {
    if (
      !conn.userId ||
      !conn.sessionId ||
      conn.ws.readyState !== WebSocket.OPEN ||
      this.userSessions.get(conn.userId)?.get(conn.sessionId) !== conn
    )
      return false;
    const voice = this.voiceStates.get(conn.userId);
    const hasActiveVoiceState =
      voice?.channelId === channelId && voice.sessionId === conn.sessionId;

    if (!hasActiveVoiceState) {
      const pending = this.pendingVoiceJoins.get(conn.userId);
      const isPendingJoin =
        pending &&
        pending.channelId === channelId &&
        pending.sessionId === conn.sessionId &&
        Date.now() - pending.timestamp < 5000;
      if (!isPendingJoin) return false;
    }

    return true;
  }

  async broadcastChannel(
    channelId: string,
    payload: GatewayPayload,
    excludeUserId?: string,
  ) {
    for (const [userId, voiceState] of this.voiceStates.entries()) {
      if (voiceState.channelId === channelId && userId !== excludeUserId) {
        if (
          !(await permissionService.hasChannelPermission(
            userId,
            channelId,
            PermissionFlags.CONNECT,
          ))
        )
          continue;
        if (payload.t === GatewayEvents.P2P_SIGNAL) {
          const signal = payload.d as P2PSignalPayload;
          const origin = this.voiceStates.get(signal.senderId);
          if (
            signal.type.startsWith("VOICE_") &&
            (origin?.channelId !== channelId ||
              origin.sessionId !== signal.senderSessionId)
          )
            return;
        }
        const sessions = this.userSessions.get(userId);
        if (sessions) {
          for (const conn of sessions.values()) {
            this.send(conn.ws, payload);
          }
        }
      }
    }
  }

  broadcast(payload: GatewayPayload) {
    if (payload.t === GatewayEvents.MAINTENANCE_UPDATE) {
      for (const conn of this.connections) {
        if (conn.userId) this.send(conn.ws, payload);
      }
      return;
    }
    void this.broadcastScoped(payload).catch((error) =>
      console.error("[Gateway] Scoped broadcast failed:", error),
    );
  }

  private async broadcastScoped(payload: GatewayPayload): Promise<void> {
    const data = payload.d as Record<string, unknown> | undefined;
    if (!data) return;
    if (
      payload.t === GatewayEvents.VOICE_STATE_UPDATE &&
      (typeof data.channelId === "string" ||
        typeof data.previousChannelId === "string")
    ) {
      await this.broadcastToChannelViewers(
        String(data.channelId || data.previousChannelId),
        payload,
      );
      return;
    }
    if (
      payload.t === GatewayEvents.USER_UPDATE &&
      typeof data.id === "string"
    ) {
      const safeUser = {
        id: data.id,
        username: data.username,
        avatarUrl: data.avatarUrl,
        status: data.status,
        customStatus: data.customStatus,
        bio: data.bio,
        bannerUrl: data.bannerUrl,
        bannerColor: data.bannerColor,
        themeColor: data.themeColor,
        showActivity: data.showActivity,
        createdAt: data.createdAt,
      };
      const safePayload: GatewayPayload = { ...payload, d: safeUser };
      const memberships = await prisma.guildMember.findMany({
        where: { userId: data.id },
        select: { guildId: true },
      });
      const recipients = await prisma.guildMember.findMany({
        where: { guildId: { in: memberships.map((item) => item.guildId) } },
        select: { userId: true },
      });
      for (const userId of new Set([
        data.id,
        ...recipients.map((item) => item.userId),
      ])) {
        this.sendToUser(userId, safePayload);
      }
      return;
    }
    if (typeof data.channelId === "string") {
      const channel = await prisma.channel.findUnique({
        where: { id: data.channelId },
        select: {
          id: true,
          guildId: true,
          recipients: { select: { userId: true } },
        },
      });
      if (channel?.guildId) {
        const members = await prisma.guildMember.findMany({
          where: { guildId: channel.guildId },
          select: { userId: true },
        });
        for (const member of members) {
          if (
            await permissionService.hasChannelPermission(
              member.userId,
              channel.id,
              PermissionFlags.VIEW_CHANNEL,
            )
          ) {
            this.sendToUser(member.userId, payload);
          }
        }
      } else {
        for (const recipient of channel?.recipients || [])
          this.sendToUser(recipient.userId, payload);
      }
      return;
    }
    let guildId = typeof data.guildId === "string" ? data.guildId : undefined;
    if (
      !guildId &&
      payload.t === GatewayEvents.GUILD_UPDATE &&
      typeof data.id === "string"
    ) {
      guildId = data.id;
    }
    if (guildId) {
      await this.broadcastToGuild(guildId, payload);
      if (
        (payload.t === GatewayEvents.GUILD_MEMBER_REMOVE ||
          payload.t === GatewayEvents.GUILD_BAN_ADD) &&
        typeof data.userId === "string"
      ) {
        this.sendToUser(data.userId, payload);
      }
      return;
    }
    console.warn("[Gateway] Dropped unscoped event:", payload.t);
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

  public sendToSession(
    userId: string,
    sessionId: string,
    payload: GatewayPayload,
  ): boolean {
    const conn = this.userSessions.get(userId)?.get(sessionId);
    if (conn && conn.ws.readyState === WebSocket.OPEN) {
      this.send(conn.ws, payload);
      return true;
    }
    return false;
  }

  private publishCallEnd(call: DMCallSession, endedBy: string) {
    if (process.env.VOICE_ENGINE !== "cloudflare_realtime") {
      void this.terminateCallMedia(call.channelId, call.callId, [
        call.callerId,
        call.calleeId,
      ]).catch((error) =>
        console.warn("[Gateway] DM LiveKit cleanup pending", error),
      );
    }
    void cloudflareRealtimeService
      .revokeCallSessions(call.callId)
      .then(() => {
        const payload = {
          op: GatewayOpCode.DISPATCH,
          t: GatewayEvents.CF_MEDIA_TRACKS,
          d: {
            channelId: call.channelId,
            tracks: cloudflareRealtimeService.getTracks(call.channelId),
          },
        };
        for (const userId of [call.callerId, call.calleeId])
          this.sendToUser(userId, payload);
      })
      .catch((error) =>
        console.warn("[Gateway] DM media cleanup pending", error),
      );
    const event: DMCallEndedPayload = {
      callId: call.callId,
      channelId: call.channelId,
      endedBy,
      reason: call.endedReason || "ended",
    };
    for (const userId of [call.callerId, call.calleeId]) {
      this.sendToUser(userId, {
        op: GatewayOpCode.DISPATCH,
        t: GatewayEvents.CALL_END,
        d: event,
      });
    }
  }

  async broadcastToGuild(
    guildId: string,
    payload: GatewayPayload,
    excludeUserId?: string,
  ) {
    try {
      const members = await prisma.guildMember.findMany({
        where: { guildId },
        select: { userId: true },
      });
      for (const m of members) {
        if (excludeUserId && m.userId === excludeUserId) continue;
        this.sendToUser(m.userId, payload);
      }
    } catch (err) {
      console.error("[Gateway] broadcastToGuild error:", err);
    }
  }

  private async broadcastToChannelViewers(
    channelId: string,
    payload: GatewayPayload,
    excludeUserId?: string,
  ): Promise<void> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { guildId: true },
    });
    if (!channel?.guildId) return;
    const members = await prisma.guildMember.findMany({
      where: { guildId: channel.guildId },
      select: { userId: true },
    });
    for (const member of members) {
      if (excludeUserId && member.userId === excludeUserId) continue;
      if (
        await permissionService.hasChannelPermission(
          member.userId,
          channelId,
          PermissionFlags.VIEW_CHANNEL,
        )
      ) {
        this.sendToUser(member.userId, payload);
      }
    }
  }

  private cleanup(conn: ClientConnection) {
    if (conn.authTimer) {
      clearTimeout(conn.authTimer);
      conn.authTimer = undefined;
    }
    if (conn.userId) {
      this.pendingVoiceJoins.delete(conn.userId);
    }
    if (conn.userId && conn.sessionId) {
      const sessions = this.userSessions.get(conn.userId);
      const isCurrentSessionConnection = sessions?.get(conn.sessionId) === conn;
      if (sessions && isCurrentSessionConnection) {
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
        } else {
          // 还有其他 Session 连接：重新计算多端聚合在线状态并广播
          void this.recalculateUserPresence(conn.userId);
        }
      }

      const endedCall = isCurrentSessionConnection
        ? dmCallService.onDisconnect(conn.userId, conn.sessionId)
        : null;
      if (endedCall) {
        this.publishCallEnd(endedCall, conn.userId);
      }

      // 仅当断开的连接其 sessionId 恰好是当前活跃语音的持有者时，才清理语音状态并全网广播
      const currentVoice = this.voiceStates.get(conn.userId);
      if (
        isCurrentSessionConnection &&
        currentVoice &&
        currentVoice.sessionId === conn.sessionId
      ) {
        this.voiceStates.delete(conn.userId);
        this.broadcast({
          op: GatewayOpCode.DISPATCH,
          t: "VOICE_STATE_UPDATE",
          d: {
            userId: conn.userId,
            channelId: null,
            previousChannelId: currentVoice.channelId,
            guildId: currentVoice.guildId,
            sessionId: conn.sessionId,
            revision: this.nextVoiceRevision(conn.userId),
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
      // 0. 获取当前用户的是否展示活动设置
      const userRecord = await prisma.user.findUnique({
        where: { id: userId },
        select: { showActivity: true },
      });
      const showActivity = userRecord?.showActivity ?? true;

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

      // 2.5 获取与该用户有私信往来的所有联系人 ID (即使两人没有共同公会)
      const userDmChannels = await prisma.channelRecipient.findMany({
        where: {
          userId,
          channel: { type: "DM" },
        },
        select: { channelId: true },
      });
      if (userDmChannels.length > 0) {
        const dmChannelIds = userDmChannels.map((c) => c.channelId);
        const dmPeers = await prisma.channelRecipient.findMany({
          where: {
            channelId: { in: dmChannelIds },
            userId: { not: userId },
          },
          select: { userId: true },
        });
        for (const peer of dmPeers) {
          targetUserIds.add(peer.userId);
        }
      }

      // 3. 向所有相关在线设备推送
      for (const targetId of targetUserIds) {
        const sessions = this.userSessions.get(targetId);
        if (!sessions || sessions.size === 0) continue;

        const isSelf = targetId === userId;
        // 若当前用户处于 INVISIBLE 隐身状态，他人视角统一显示为 OFFLINE
        const visibleStatus =
          !isSelf && presence.status === "INVISIBLE"
            ? "OFFLINE"
            : presence.status;

        // 若处于隐身状态或关闭了“显示游戏状态”，他人视角下不发送 activities
        const visibleActivities =
          !isSelf && (presence.status === "INVISIBLE" || !showActivity)
            ? undefined
            : presence.activities;

        const eventPayload: GatewayPayload<PresenceUpdateEvent> = {
          op: GatewayOpCode.DISPATCH,
          t: GatewayEvents.PRESENCE_UPDATE,
          d: {
            userId,
            status: visibleStatus,
            customStatus: presence.customStatus,
            activities: visibleActivities,
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
  public handleLiveKitParticipantLeft(
    userId: string,
    roomName?: string,
    gatewaySessionId?: string,
  ): boolean {
    const currentVoice = this.voiceStates.get(userId);
    if (!currentVoice) {
      return false;
    }

    // 若提供了 roomName，校验是否是当前频道的离开事件（避免旧房间事件误杀新房间状态）
    if (roomName && currentVoice.channelId !== roomName) {
      console.log(
        `[Gateway] Ignored LiveKit participant_left for ${userId} in ${roomName} (current channel: ${currentVoice.channelId})`,
      );
      return false;
    }

    // LiveKit identity is the user ID, so a late webhook from a replaced
    // participant must be matched to the Gateway session embedded in its token.
    if (gatewaySessionId && currentVoice.sessionId !== gatewaySessionId) {
      console.log(
        `[Gateway] Ignored stale LiveKit participant_left for ${userId} (event session: ${gatewaySessionId}, active: ${currentVoice.sessionId})`,
      );
      return false;
    }

    // 若该用户刚刚发生过多端接管 (6秒内)，且新设备的会话连接仍保持活跃，忽略旧会话的踢出 Webhook
    const lastTransfer = this.transferTimestamps.get(userId);
    if (
      !gatewaySessionId &&
      lastTransfer &&
      Date.now() - lastTransfer < 6000 &&
      currentVoice.sessionId
    ) {
      const activeConn = this.userSessions
        .get(userId)
        ?.get(currentVoice.sessionId);
      if (activeConn && activeConn.ws.readyState === WebSocket.OPEN) {
        console.log(
          `[Gateway] Ignored LiveKit participant_left for ${userId} in ${roomName} due to recent device transfer (active session: ${currentVoice.sessionId})`,
        );
        return false;
      }
    }

    console.log(
      `[Gateway] LiveKit webhook reconciled: removing user ${userId} from voice channel ${currentVoice.channelId}`,
    );

    this.voiceStates.delete(userId);
    this.transferTimestamps.delete(userId);
    this.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: "VOICE_STATE_UPDATE",
      d: {
        userId,
        channelId: null,
        previousChannelId: currentVoice.channelId,
        guildId: currentVoice.guildId,
        sessionId: currentVoice.sessionId,
        revision: this.nextVoiceRevision(userId),
        selfMute: false,
        selfDeaf: false,
        selfVideo: false,
        streaming: false,
      },
    });

    if (currentVoice.channelId) {
      p2pTopologyManager.removeViewer(currentVoice.channelId, userId);
      if (currentVoice.streaming) {
        p2pTopologyManager.unregisterStream(currentVoice.channelId, userId);
      }
    }

    return true;
  }

  public getVoiceState(userId: string): VoiceState | undefined {
    return this.voiceStates.get(userId);
  }

  /**
   * 将指定成员从其当前语音频道中断开（被动移出，非封禁，成员可随时重新进入）
   */
  public async disconnectVoiceUser(
    guildId: string,
    targetUserId: string,
    reason: VoiceServerDisconnectPayload["reason"] = "KICKED",
  ): Promise<boolean> {
    const state = this.voiceStates.get(targetUserId);
    if (!state || !state.channelId || state.guildId !== guildId) {
      return false;
    }

    const channelId = state.channelId;
    const sessionId = state.sessionId;

    // Revoke the captured incarnation before any asynchronous cleanup. A
    // rejoin during remote teardown must never be deleted by this operation.
    this.voiceStates.delete(targetUserId);
    this.pendingVoiceJoins.delete(targetUserId);
    const timer = this.mediaJoinTimers.get(targetUserId);
    if (timer) clearTimeout(timer);
    this.mediaJoinTimers.delete(targetUserId);
    const revision = this.nextVoiceRevision(targetUserId);
    p2pTopologyManager.removeViewer(channelId, targetUserId);
    if (state.streaming)
      p2pTopologyManager.unregisterStream(channelId, targetUserId);
    for (const [id, media] of cloudflareRealtimeService.listSessions()) {
      if (
        media.userId === targetUserId &&
        media.channelId === channelId &&
        media.gatewaySessionId === sessionId
      ) {
        void cloudflareRealtimeService
          .revokeSession(id)
          .catch((error) =>
            console.warn("[Gateway] Voice media teardown failed", error),
          );
      }
    }

    // 1. 向目标用户所有的活跃会话发送被动断开信令 VOICE_SERVER_DISCONNECT
    const sessions = this.userSessions.get(targetUserId);
    if (sessions) {
      for (const conn of sessions.values()) {
        if (conn.ws.readyState === WebSocket.OPEN) {
          this.send(conn.ws, {
            op: GatewayOpCode.DISPATCH,
            t: GatewayEvents.VOICE_SERVER_DISCONNECT,
            d: {
              reason,
            } satisfies VoiceServerDisconnectPayload,
          });
        }
      }
    }

    // 4. 向原频道所有观察者广播离开事件
    await this.broadcastToChannelViewers(channelId, {
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.VOICE_STATE_UPDATE,
      d: {
        userId: targetUserId,
        channelId: null,
        previousChannelId: channelId,
        guildId,
        sessionId,
        revision,
        selfMute: false,
        selfDeaf: false,
        selfVideo: false,
        streaming: false,
      },
    });

    if (
      process.env.VOICE_ENGINE !== "cloudflare_realtime" &&
      !this.voiceStates.has(targetUserId)
    )
      await removeParticipantFromRoom(channelId, targetUserId);

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
          this.send(conn.ws, {
            op: GatewayOpCode.DISPATCH,
            t: GatewayEvents.AUTH_SESSION_EXPIRED,
            d: { userId, reason: "Account terminated or banned" },
          });
          conn.ws.close(
            GatewayCloseCode.ACCOUNT_BANNED,
            "Account terminated or banned",
          );
        } catch {
          // ignore
        }
      }
    }
  }

  terminateActiveCall(userId: string, reason: string) {
    return dmCallService.terminateForUser(userId, reason);
  }

  private async terminateCallMedia(
    channelId: string,
    callId: string,
    userIds: string[],
  ) {
    const roomName = `dm_${channelId}_${callId}`;
    await Promise.allSettled(
      userIds.map((userId) => removeParticipantFromRoom(roomName, userId)),
    );
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
    const recipients =
      channel.type === "DM" || channel.type === "GROUP_DM"
        ? channel.recipients.map((item) => item.userId)
        : channel.guild?.members.map((item) => item.userId) || [];
    if (!recipients.includes(user.id)) return;
    if (
      channel.guildId &&
      !(
        (await permissionService.hasChannelPermission(
          user.id,
          channelId,
          PermissionFlags.VIEW_CHANNEL,
        )) &&
        (await permissionService.hasChannelPermission(
          user.id,
          channelId,
          PermissionFlags.SEND_MESSAGES,
        ))
      )
    )
      return;
    for (const userId of recipients) {
      if (userId === user.id) continue;
      if (
        channel.guildId &&
        !(await permissionService.hasChannelPermission(
          userId,
          channelId,
          PermissionFlags.VIEW_CHANNEL,
        ))
      )
        continue;
      this.sendToUser(userId, {
        op: GatewayOpCode.DISPATCH,
        t: GatewayEvents.TYPING_START,
        d: { channelId, userId: user.id, user, timestamp: Date.now() },
      });
    }
  }

  async initMaintenanceState() {
    try {
      const mode = await prisma.systemSetting.findUnique({
        where: { key: "maintenance_mode" },
      });
      const announcement = await prisma.systemSetting.findUnique({
        where: { key: "system_announcement" },
      });
      this.isMaintenanceActive = mode?.value === "true";
      this.maintenancePayload = {
        enabled: this.isMaintenanceActive,
        announcement: announcement?.value || "",
      };
    } catch (err) {
      console.error("[Gateway] Failed to init maintenance state:", err);
    }
  }

  async setMaintenanceMode(enabled: boolean, announcement: string = "") {
    this.isMaintenanceActive = enabled;
    this.maintenancePayload = {
      enabled,
      announcement,
      triggeredAt: new Date().toISOString(),
    };

    // 1. 全网长连接广播 MAINTENANCE_UPDATE 事件
    this.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.MAINTENANCE_UPDATE,
      d: this.maintenancePayload,
    });

    if (enabled) {
      // 2. 开启维护模式：清理非超级管理员的语音房间与私信呼叫，释放声卡和 WebRTC 资源
      const userIds = Array.from(this.userSessions.keys());
      const admins = await prisma.user.findMany({
        where: { id: { in: userIds }, role: "SUPER_ADMIN", isBanned: false },
        select: { id: true },
      });
      const adminSet = new Set(admins.map((user) => user.id));

      for (const userId of userIds) {
        if (adminSet.has(userId)) continue;

        // 挂断 1v1 私信呼叫
        try {
          dmCallService.terminateForUser(userId, "maintenance_mode");
        } catch {}

        // 清理公会语音房间与拓扑
        const voiceState = this.voiceStates.get(userId);
        if (voiceState && voiceState.channelId) {
          try {
            await removeParticipantFromRoom(voiceState.channelId, userId);
            p2pTopologyManager.unregisterStream(voiceState.channelId, userId);
            p2pTopologyManager.removeViewer(voiceState.channelId, userId);
          } catch {}
          this.voiceStates.delete(userId);
          this.broadcast({
            op: GatewayOpCode.DISPATCH,
            t: "VOICE_STATE_UPDATE",
            d: {
              userId,
              channelId: null,
              previousChannelId: voiceState.channelId,
              guildId: voiceState.guildId,
              sessionId: voiceState.sessionId,
              revision: this.nextVoiceRevision(userId),
            },
          });
        }
      }
      // 注意：不断开普通用户的 WebSocket 连接，保持受限长连接广播通道
    }
  }

  async disconnectNonSuperAdmins(reason = "Maintenance mode") {
    await this.setMaintenanceMode(true, reason);
  }
}

export const gatewayManager = new GatewayManager();
