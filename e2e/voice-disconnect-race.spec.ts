import { test, expect } from "@playwright/test";
import { GatewayManager } from "../apps/server/src/gateway";
import { cloudflareRealtimeService } from "../apps/server/src/services/cloudflare-realtime.service";
import type { GatewayPayload, VoiceState } from "@tescord/types";

test("voice disconnect revokes only the old incarnation before awaiting observers", async () => {
  const gateway = Object.create(GatewayManager.prototype) as GatewayManager;
  const state = gateway as unknown as {
    voiceStates: Map<string, VoiceState>;
    pendingVoiceJoins: Map<string, unknown>;
    mediaJoinTimers: Map<string, NodeJS.Timeout>;
    voiceRevisions: Map<string, number>;
    userSessions: Map<string, Map<string, unknown>>;
    broadcastToChannelViewers(
      channelId: string,
      payload: GatewayPayload,
    ): Promise<void>;
  };
  const old = {
    userId: "target",
    guildId: "guild",
    channelId: "voice",
    sessionId: "old-gateway",
    streaming: false,
  } as VoiceState;
  state.voiceStates = new Map([["target", old]]);
  state.pendingVoiceJoins = new Map([["target", {}]]);
  state.mediaJoinTimers = new Map();
  state.voiceRevisions = new Map();
  state.userSessions = new Map();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.broadcastToChannelViewers = async () => {
    await gate;
  };
  const list = cloudflareRealtimeService.listSessions;
  const revoke = cloudflareRealtimeService.revokeSession;
  const engine = process.env.VOICE_ENGINE;
  const revoked: string[] = [];
  cloudflareRealtimeService.listSessions = () =>
    [
      [
        "old-media",
        {
          userId: "target",
          channelId: "voice",
          gatewaySessionId: "old-gateway",
        },
      ],
      [
        "other-device",
        {
          userId: "target",
          channelId: "voice",
          gatewaySessionId: "other-gateway",
        },
      ],
    ] as ReturnType<typeof cloudflareRealtimeService.listSessions>;
  cloudflareRealtimeService.revokeSession = async (id) => {
    revoked.push(id);
  };
  process.env.VOICE_ENGINE = "cloudflare_realtime";
  try {
    const disconnected = gateway.disconnectVoiceUser("guild", "target");
    expect(state.voiceStates.has("target")).toBe(false);
    expect(state.pendingVoiceJoins.has("target")).toBe(false);
    expect(revoked).toEqual(["old-media"]);
    const replacement = { ...old, sessionId: "new-gateway" };
    state.voiceStates.set("target", replacement);
    release();
    expect(await disconnected).toBe(true);
    expect(state.voiceStates.get("target")).toBe(replacement);
    expect(await gateway.disconnectVoiceUser("other-guild", "target")).toBe(
      false,
    );
    expect(state.voiceStates.get("target")).toBe(replacement);
  } finally {
    release();
    cloudflareRealtimeService.listSessions = list;
    cloudflareRealtimeService.revokeSession = revoke;
    if (engine === undefined) delete process.env.VOICE_ENGINE;
    else process.env.VOICE_ENGINE = engine;
  }
});
