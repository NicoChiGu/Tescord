import {
  GatewayOpCode,
  GatewayPayload,
  GatewayEvents,
  HelloPayload,
  HeartbeatData,
  GatewayConnectionState,
  GatewayPingStats,
  User,
  UserStatus,
} from "@tescord/types";
import { GATEWAY_URL } from "../config.js";

type EventHandler = (data: any) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: any = null;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private token: string = "";
  private isConnecting: boolean = false;
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

  connect(token: string) {
    this.token = token;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.isConnecting = true;
    if (this.connectionState !== "reconnecting") {
      this.setConnectionState("connecting");
    }
    try {
      this.ws = new WebSocket(this.gatewayUrl);
      this.setupSocket();
    } catch (err) {
      console.error("Failed to create WebSocket:", err);
      this.scheduleReconnect();
    }
  }

  private setupSocket() {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.isConnecting = false;
      this.setConnectionState("connected");
    };

    this.ws.onmessage = (event) => {
      try {
        const payload: GatewayPayload = JSON.parse(event.data);
        this.handlePayload(payload);
      } catch (e) {
        console.error("Error parsing gateway message:", e);
      }
    };

    this.ws.onclose = () => {
      this.cleanup();
      this.setConnectionState("disconnected");
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  }

  private handlePayload(payload: GatewayPayload) {
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
        if (payload.t === "READY" && payload.d?.sessionId) {
          this.sessionId = payload.d.sessionId;
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

  private scheduleReconnect() {
    this.setConnectionState("reconnecting");
    setTimeout(() => {
      if (this.token) {
        this.connect(this.token);
      }
    }, 3000);
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
  ) {
    this.send({
      op: GatewayOpCode.VOICE_STATE_UPDATE,
      d: {
        guildId,
        channelId,
        sessionId: this.sessionId,
        ...extra,
      },
    });
  }

  sendTyping(channelId: string) {
    this.send({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.TYPING_START,
      d: { channelId },
    });
  }

  updateStatus(status: UserStatus, customStatus?: string | null) {
    this.send({
      op: GatewayOpCode.STATUS_UPDATE,
      d: {
        status,
        customStatus,
      },
    });
  }

  disconnect() {
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const gatewayClient = new GatewayClient();

if (typeof window !== "undefined") {
  (window as any).__gatewayClient = gatewayClient;
}
