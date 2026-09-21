import { WebSocket } from "ws";
import {
  GatewayOpCode,
  GatewayPayload,
  HelloPayload,
  IdentifyPayload,
  VoiceStateUpdatePayload,
  VoiceState,
} from "@tescord/types";
import { prisma } from "./db.js";

interface ClientConnection {
  ws: WebSocket;
  userId?: string;
  isAlive: boolean;
  heartbeatIntervalTimer?: NodeJS.Timeout;
}

export class GatewayManager {
  private connections: Set<ClientConnection> = new Set();
  private userToConnection: Map<string, ClientConnection> = new Map();
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

        conn.userId = user.id;
        this.userToConnection.set(user.id, conn);

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

        // 发送 READY 事件
        this.send(conn.ws, {
          op: GatewayOpCode.DISPATCH,
          t: "READY",
          d: {
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
        if (!conn.userId) return;
        const data = payload.d as VoiceStateUpdatePayload;
        const user = await prisma.user.findUnique({
          where: { id: conn.userId },
        });

        const voiceState: VoiceState = {
          userId: conn.userId,
          guildId: data.guildId,
          channelId: data.channelId,
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

        if (data.channelId) {
          this.voiceStates.set(conn.userId, voiceState);
        } else {
          this.voiceStates.delete(conn.userId);
        }

        // 全网关广播 VOICE_STATE_UPDATE
        this.broadcast({
          op: GatewayOpCode.DISPATCH,
          t: "VOICE_STATE_UPDATE",
          d: voiceState,
        });
        break;
      }

      default:
        break;
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

  private cleanup(conn: ClientConnection) {
    if (conn.userId) {
      this.userToConnection.delete(conn.userId);
      this.voiceStates.delete(conn.userId);
      this.broadcast({
        op: GatewayOpCode.DISPATCH,
        t: "VOICE_STATE_UPDATE",
        d: {
          userId: conn.userId,
          channelId: null,
        },
      });
    }
    this.connections.delete(conn);
  }
}

export const gatewayManager = new GatewayManager();
