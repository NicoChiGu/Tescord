import {
  GatewayOpCode,
  GatewayCloseCode,
  GatewayPayload,
  GatewayEvents,
  HelloPayload,
  HeartbeatData,
  GatewayConnectionState,
  GatewayPingStats,
  ReadyPayload,
  User,
  UserStatus,
  MaintenanceUpdatePayload,
  MEDIA_ENCRYPTION_VERSION,
} from "@tescord/types";
import { GATEWAY_URL } from "../config.js";
import { useAuthStore } from "../stores/useAuthStore.js";
import { useMaintenanceStore } from "../stores/useMaintenanceStore.js";

type EventHandler = (data: any) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: any = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private token: string = "";
  private isConnecting: boolean = false;
  private reconnectAllowed = false;
  private connectionGeneration = 0;
  private expectedUserId: string | null = null;
  private authenticatedUserId: string | null = null;
  private ready = false;
  private connectionState: GatewayConnectionState = "disconnected";
  private pingStats: GatewayPingStats | null = null;
  private lastHeartbeatSentAt: number = 0;
  private sessionId: string =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2);

  constructor(private gatewayUrl: string = GATEWAY_URL) {}

  getSessionId(): string {
    return this.sessionId;
  }

  getConnectionState(): GatewayConnectionState {
    return this.connectionState;
  }

  getPingStats(): GatewayPingStats | null {
    return this.pingStats;
  }

  onConnectionStateChange(handler: (state: GatewayConnectionState) => void) {
    return this.on("GATEWAY_STATE_UPDATE", handler);
  }

  onPingChange(handler: (ping: GatewayPingStats) => void) {
    return this.on("GATEWAY_PING_UPDATE", handler);
  }

  private setConnectionState(state: GatewayConnectionState) {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.emit("GATEWAY_STATE_UPDATE", state);
    }
  }

  connect(token: string, expectedUserId?: string) {
    const authUserId = useAuthStore.getState().user?.id || null;
    const nextExpectedUserId = expectedUserId || authUserId;
    const identityChanged =
      this.expectedUserId !== null &&
      nextExpectedUserId !== null &&
      this.expectedUserId !== nextExpectedUserId;
    const credentialsChanged = this.token !== "" && this.token !== token;

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING) &&
      !identityChanged &&
      !credentialsChanged
    ) {
      return;
    }

    const oldSocket = this.ws;
    const generation = ++this.connectionGeneration;
    this.clearReconnectTimer();
    this.cleanup();
    this.ws = null;
    this.ready = false;
    this.authenticatedUserId = null;
    this.reconnectAllowed = true;
    this.token = token;
    this.expectedUserId = nextExpectedUserId;
    if (identityChanged) this.sessionId = this.createSessionId();
    if (oldSocket) {
      oldSocket.onopen = null;
      oldSocket.onmessage = null;
      oldSocket.onerror = null;
      oldSocket.onclose = null;
      oldSocket.close();
    }

    this.isConnecting = true;
    if (this.connectionState !== "reconnecting") {
      this.setConnectionState("connecting");
    }
    try {
      const socket = new WebSocket(this.gatewayUrl);
      this.ws = socket;
      this.setupSocket(socket, generation);
    } catch (err) {
      console.error("Failed to create WebSocket:", err);
      this.scheduleReconnect(generation);
    }
  }

  private setupSocket(socket: WebSocket, generation: number) {
    socket.onopen = () => {
      if (!this.isCurrentConnection(socket, generation)) return;
      this.isConnecting = false;
    };

    socket.onmessage = (event) => {
      if (!this.isCurrentConnection(socket, generation)) return;
      try {
        const payload: GatewayPayload = JSON.parse(event.data);
        this.handlePayload(payload, generation);
      } catch (e) {
        console.error("Error parsing gateway message:", e);
      }
    };

    socket.onclose = (event: CloseEvent) => {
      if (!this.isCurrentConnection(socket, generation)) return;
      this.ws = null;
      this.ready = false;
      this.authenticatedUserId = null;
      this.isConnecting = false;
      this.cleanup();
      this.setConnectionState("disconnected");

      if (!this.reconnectAllowed) return;

      // 1. 若为 TOKEN_EXPIRED (4001)，执行自愈流程：尝试用 Refresh Token 静默续期换票
      if (
        event.code === GatewayCloseCode.TOKEN_EXPIRED ||
        event.code === 4001
      ) {
        console.warn(
          `[GatewayClient] Closed with token expired (4001), initiating silent self-healing...`,
        );
        this.setConnectionState("reconnecting");
        useAuthStore
          .getState()
          .refreshAuth()
          .then((success) => {
            if (!this.isCurrentGeneration(generation)) return;
            if (success) {
              const newToken = useAuthStore.getState().accessToken;
              if (newToken) {
                console.log(
                  "[GatewayClient] Silent refresh succeeded, reconnecting with new token",
                );
                this.connect(newToken, this.expectedUserId || undefined);
                return;
              }
            }
            if (useAuthStore.getState().refreshFailure === "transient") {
              this.scheduleReconnect(generation, 30_000);
              return;
            }
            // 刷新失败，说明 Refresh Token 也过期或被吊销，阻断并提示重新登录
            this.emit(GatewayEvents.AUTH_SESSION_EXPIRED, {
              code: event.code,
              reason: event.reason,
            });
            useAuthStore
              .getState()
              .openReauthModal(
                event.reason || "连接凭据已失效，请重新验证以恢复长连接",
              );
          })
          .catch(() => {
            if (this.isCurrentGeneration(generation)) {
              this.scheduleReconnect(generation, 30_000);
            }
          });
        return;
      }

      // 2. 若为不可恢复凭证错误（账号封禁 4003、会话吊销 4004、未授权 4002），阻断重连并弹窗
      const fatalAuthCodes = [
        GatewayCloseCode.UNAUTHORIZED,
        GatewayCloseCode.ACCOUNT_BANNED,
        GatewayCloseCode.SESSION_INVALID,
        4002,
        4003,
        4004,
      ];

      if (fatalAuthCodes.includes(event.code)) {
        console.warn(
          `[GatewayClient] Closed with fatal auth code: ${event.code} (${event.reason})`,
        );
        this.emit(GatewayEvents.AUTH_SESSION_EXPIRED, {
          code: event.code,
          reason: event.reason,
        });
        useAuthStore
          .getState()
          .openReauthModal(
            event.reason || "连接凭据已失效，请重新验证以恢复长连接",
          );
        // 鉴权彻底失效时，阻止自动盲目重连
        return;
      }

      if (
        event.code === GatewayCloseCode.MAINTENANCE_MODE ||
        event.code === 4013
      ) {
        console.warn(
          `[GatewayClient] Closed due to maintenance mode: ${event.reason}`,
        );
        useMaintenanceStore.getState().setMaintenance({
          enabled: true,
          announcement: event.reason || "系统正在维护中",
        });
        // 维护模式下慢速重连探测（8秒）
        this.scheduleReconnect(generation, 8000);
        return;
      }

      this.scheduleReconnect(generation);
    };

    socket.onerror = (err) => {
      if (!this.isCurrentConnection(socket, generation)) return;
      console.error("WebSocket error:", err);
    };
  }

  private handlePayload(payload: GatewayPayload, generation: number) {
    if (!this.isCurrentGeneration(generation)) return;
    switch (payload.op) {
      case GatewayOpCode.HELLO: {
        const data = payload.d as HelloPayload;
        this.startHeartbeat(data.heartbeatInterval || 30000);

        const isDesktop =
          typeof window !== "undefined" && !!(window as any).electron;
        const os = isDesktop
          ? "Desktop"
          : typeof navigator !== "undefined" &&
              /Mac|iPhone|iPad/i.test(navigator.userAgent)
            ? "macOS"
            : "Web";
        const device = isDesktop ? "桌面客户端" : "Web 浏览器";

        // 发送 IDENTIFY
        this.send({
          op: GatewayOpCode.IDENTIFY,
          d: {
            token: this.token,
            sessionId: this.sessionId,
            properties: {
              os,
              browser:
                typeof navigator !== "undefined"
                  ? navigator.userAgent
                  : "Desktop",
              device,
            },
          },
        });
        break;
      }

      case GatewayOpCode.INVALID_SESSION: {
        console.warn(
          "[GatewayClient] Received INVALID_SESSION from server, awaiting socket close resolution",
        );
        this.cleanup();
        this.setConnectionState("disconnected");
        this.emit(GatewayEvents.AUTH_SESSION_EXPIRED, {
          reason: "INVALID_SESSION",
        });
        break;
      }

      case GatewayOpCode.HEARTBEAT_ACK: {
        const hbData = payload.d as HeartbeatData | undefined;
        const now = Date.now();
        const clientTs =
          hbData?.clientTimestamp || this.lastHeartbeatSentAt || now;
        const rtt = Math.max(1, now - clientTs);
        this.pingStats = {
          ping: rtt,
          lastAckTimestamp: now,
        };
        this.emit("GATEWAY_PING_UPDATE", this.pingStats);
        break;
      }

      case GatewayOpCode.DISPATCH: {
        if (payload.t === "READY") {
          const ready = payload.d as ReadyPayload;
          const readyUserId = ready.user?.id || null;
          if (
            !readyUserId ||
            (this.expectedUserId && readyUserId !== this.expectedUserId)
          ) {
            console.warn(
              "[GatewayClient] READY identity does not match active account",
            );
            this.disconnect();
            return;
          }
          if (ready.sessionId) this.sessionId = ready.sessionId;
          this.authenticatedUserId = readyUserId;
          this.ready = true;
          this.setConnectionState("connected");
        }
        if (payload.t === GatewayEvents.AUTH_SESSION_EXPIRED) {
          useAuthStore
            .getState()
            .openReauthModal(payload.d?.reason || "登录凭据已过期");
        }
        if (payload.t === GatewayEvents.MAINTENANCE_UPDATE && payload.d) {
          const update = payload.d as MaintenanceUpdatePayload;
          if (update.enabled) {
            useMaintenanceStore.getState().setMaintenance(update);
          } else {
            useMaintenanceStore.getState().clearMaintenance();
          }
        }
        if (payload.t) {
          this.emit(payload.t, payload.d);
        }
        break;
      }
    }
  }

  sendHeartbeat() {
    this.lastHeartbeatSentAt = Date.now();
    this.send({
      op: GatewayOpCode.HEARTBEAT,
      d: {
        clientTimestamp: this.lastHeartbeatSentAt,
      } as HeartbeatData,
    });
  }

  private startHeartbeat(interval: number) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    // 立即发起一次心跳，第一时间获取真实网关延迟
    this.sendHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, interval);
  }

  private cleanup() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(
    generation: number = this.connectionGeneration,
    delayMs = 3000,
  ) {
    if (!this.reconnectAllowed || !this.isCurrentGeneration(generation)) return;
    this.clearReconnectTimer();
    this.setConnectionState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.reconnectAllowed || !this.isCurrentGeneration(generation))
        return;
      const auth = useAuthStore.getState();
      if (
        !auth.isAuthenticated ||
        !auth.accessToken ||
        !auth.user?.id ||
        (this.expectedUserId && auth.user.id !== this.expectedUserId)
      ) {
        return;
      }
      this.connect(auth.accessToken, auth.user.id);
    }, delayMs);
  }

  private createSessionId(): string {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2);
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.connectionGeneration && this.reconnectAllowed;
  }

  private isCurrentConnection(socket: WebSocket, generation: number): boolean {
    return this.ws === socket && this.isCurrentGeneration(generation);
  }

  isReadyForUser(userId: string): boolean {
    return (
      this.ready &&
      this.connectionState === "connected" &&
      this.expectedUserId === userId &&
      this.authenticatedUserId === userId
    );
  }

  async waitUntilReady(userId: string, timeoutMs = 8000): Promise<boolean> {
    if (this.isReadyForUser(userId)) return true;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      const unsubscribe = this.on("READY", (data: ReadyPayload) => {
        if (data.user?.id === userId && this.isReadyForUser(userId))
          finish(true);
      });
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  send(payload: GatewayPayload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendRaw(payload: GatewayPayload) {
    this.send(payload);
  }

  on(event: string, handler: EventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  emit(event: string, data: any) {
    const list = this.handlers.get(event);
    if (list) {
      list.forEach((h) => h(data));
    }
  }

  updateVoiceState(
    guildId: string,
    channelId: string | null,
    extra?: {
      selfMute?: boolean;
      selfDeaf?: boolean;
      selfVideo?: boolean;
      streaming?: boolean;
      streamMode?: import("@tescord/types").StreamTransmissionMode;
    },
  ): boolean {
    const activeUserId = useAuthStore.getState().user?.id;
    if (!activeUserId || !this.isReadyForUser(activeUserId)) return false;
    this.send({
      op: GatewayOpCode.VOICE_STATE_UPDATE,
      d: {
        guildId,
        channelId,
        sessionId: this.sessionId,
        mediaEncryptionVersion: MEDIA_ENCRYPTION_VERSION,
        ...extra,
      },
    });
    return true;
  }

  async updateVoiceStateAndWait(
    guildId: string,
    channelId: string | null,
    extra?: {
      selfMute?: boolean;
      selfDeaf?: boolean;
      selfVideo?: boolean;
      streaming?: boolean;
      streamMode?: import("@tescord/types").StreamTransmissionMode;
    },
    timeoutMs = 3000,
  ): Promise<boolean> {
    const activeUserId = useAuthStore.getState().user?.id;
    if (!activeUserId || !this.isReadyForUser(activeUserId)) return false;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(false);
        }
      }, timeoutMs);

      const cleanup = this.on("VOICE_STATE_UPDATE", (vs: any) => {
        if (vs.userId === activeUserId && vs.channelId === channelId) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            cleanup();
            resolve(true);
          }
        }
      });

      const sent = this.updateVoiceState(guildId, channelId, extra);
      if (!sent) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(false);
        }
      }
    });
  }

  sendTyping(channelId: string) {
    this.send({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.TYPING_START,
      d: { channelId },
    });
  }

  updateStatus(
    status: UserStatus,
    customStatus?: string | null,
    activities?: import("@tescord/types").Activity[],
    isManual?: boolean,
  ) {
    this.send({
      op: GatewayOpCode.STATUS_UPDATE,
      d: {
        status,
        customStatus,
        activities,
        isManual,
      },
    });
  }

  disconnect() {
    const socket = this.ws;
    ++this.connectionGeneration;
    this.reconnectAllowed = false;
    this.clearReconnectTimer();
    this.cleanup();
    this.ws = null;
    this.token = "";
    this.expectedUserId = null;
    this.authenticatedUserId = null;
    this.ready = false;
    this.isConnecting = false;
    this.sessionId = this.createSessionId();
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
    this.setConnectionState("disconnected");
  }
}

export const gatewayClient = new GatewayClient();

if (typeof window !== "undefined") {
  (window as any).__gatewayClient = gatewayClient;
}
