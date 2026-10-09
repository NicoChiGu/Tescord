import { test, expect } from "@playwright/test";
import { GatewayManager } from "../apps/server/src/gateway";
import { permissionService } from "../apps/server/src/services/permission.service";
import {
  GatewayEvents,
  GatewayOpCode,
  type GatewayPayload,
} from "@tescord/types";

test("a transfer during permission lookup invalidates old media signalling", async () => {
  const connection = {
    userId: "sender",
    sessionId: "old",
    ws: { readyState: 1 },
  };
  const receiver = {
    userId: "receiver",
    sessionId: "receiver-session",
    ws: { readyState: 1 },
  };
  const gateway = Object.create(GatewayManager.prototype) as {
    voiceStates: Map<string, { channelId: string; sessionId: string }>;
    userSessions: Map<string, Map<string, typeof connection>>;
    pendingVoiceJoins: Map<
      string,
      { channelId: string; sessionId: string; timestamp: number }
    >;
    canSignalVoice(
      conn: typeof connection,
      channelId: string,
    ): Promise<boolean>;
    broadcastChannel(
      channelId: string,
      payload: GatewayPayload,
      excludeUserId?: string,
    ): Promise<void>;
    send(): void;
  };
  gateway.voiceStates = new Map([
    ["sender", { channelId: "voice", sessionId: "old" }],
    ["receiver", { channelId: "voice", sessionId: "receiver-session" }],
  ]);
  gateway.userSessions = new Map([
    ["sender", new Map([["old", connection]])],
    ["receiver", new Map([["receiver-session", receiver]])],
  ]);
  gateway.pendingVoiceJoins = new Map();
  let release!: () => void;
  let lookedUp!: () => void;
  const ready = new Promise<void>((resolve) => {
    lookedUp = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const permission = permissionService.hasChannelPermission;
  permissionService.hasChannelPermission = async () => {
    lookedUp();
    await gate;
    return true;
  };
  let deliveries = 0;
  gateway.send = () => {
    deliveries++;
  };
  try {
    const authorized = gateway.canSignalVoice(connection, "voice");
    await ready;
    gateway.voiceStates.set("sender", { channelId: "voice", sessionId: "new" });
    release();
    expect(await authorized).toBe(false);
    await gateway.broadcastChannel(
      "voice",
      {
        op: GatewayOpCode.DISPATCH,
        t: GatewayEvents.P2P_SIGNAL,
        d: {
          type: "VOICE_LEAVE",
          channelId: "voice",
          senderId: "sender",
          senderSessionId: "old",
        },
      },
      "sender",
    );
    expect(deliveries).toBe(0);
  } finally {
    release();
    permissionService.hasChannelPermission = permission;
  }
});
