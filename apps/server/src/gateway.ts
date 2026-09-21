import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import {
  GatewayOpCode,
  GatewayPayload,
  HelloPayload,
  IdentifyPayload,
  VoiceStateUpdatePayload,
  VoiceState,
  VoiceServerDisconnectPayload,
  GatewayEvents,
  TypingIndicatorPayload,
} from "@tescord/types";
import { prisma } from "./db.js";
import { removeParticipantFromRoom } from "./livekit.js";

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
  private connections: Set<ClientConnection> = new Set();
  // 多端/多会话映射：userId -> Map<sessionId, ClientConnection>
  private userSessions: Map<string, Map<string, ClientConnection>> = new Map();
  // 全网单用户仅存一个活跃语音会话：userId -> VoiceState
  private voiceStates: Map<string, VoiceState> = new Map();

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
        this.send(conn.ws, {
          op: GatewayOpCode.HEARTBEAT_ACK,
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

        const sessionId = data?.sessionId || randomUUID();
        conn.userId = user.id;
        conn.sessionId = sessionId;
        conn.properties = data?.properties;

        if (!this.userSessions.has(user.id)) {
          this.userSessions.set(user.id, new Map());
        }
        this.userSessions.get(user.id)!.set(sessionId, conn);

        // 获取公会数据供客户端初始化
        const guilds = await prisma.guild.findMany({
          include: {
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
              status: user.status,
              customStatus: user.customStatus,
              bio: user.bio,
            },
            guilds,
            voiceStates: Array.from(this.voiceStates.values()),
          },
        });
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
        }
        break;
      }

      default:
        break;
    }
  }

  broadcastTyping(
    channelId: string,
    user: { id: string; username: string; avatarUrl?: string | null }
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
        }
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
}

export const gatewayManager = new GatewayManager();
