import { test, expect } from "@playwright/test";
import { WebSocket } from "ws";
import { GatewayManager } from "../apps/server/src/gateway";

test("a delayed LiveKit webhook cannot remove a replacement voice session", () => {
  const gateway = Object.create(GatewayManager.prototype) as GatewayManager;
  const state = gateway as unknown as {
      voiceStates: Map<string, { channelId: string; sessionId: string; guildId: string; streaming: boolean }>;
      userSessions: Map<string, Map<string, { userId: string; ws: { readyState: number } }>>;
      transferTimestamps: Map<string, number>;
      voiceRevisions: Map<string, number>;
      broadcast: () => void;
    };
    state.voiceStates = new Map();
    state.userSessions = new Map();
    state.transferTimestamps = new Map();
    state.voiceRevisions = new Map();
    state.broadcast = () => {};
    state.voiceStates.set("alice", {
      channelId: "voice-room",
      sessionId: "new-session",
      guildId: "guild",
      streaming: false,
    });
    state.userSessions.set("alice", new Map([
      ["new-session", { userId: "alice", ws: { readyState: WebSocket.OPEN } }],
    ]));
    state.transferTimestamps.set("alice", Date.now());

    expect(gateway.hasIdentifiedSession("alice", "new-session")).toBe(true);
    expect(gateway.hasIdentifiedSession("alice", "old-session")).toBe(false);
    expect(gateway.handleLiveKitParticipantLeft("alice", "voice-room", "old-session")).toBe(false);
    expect(state.voiceStates.get("alice")?.sessionId).toBe("new-session");
    expect(gateway.handleLiveKitParticipantLeft("alice", "old-room", "new-session")).toBe(false);
    expect(state.voiceStates.get("alice")?.sessionId).toBe("new-session");
    expect(gateway.handleLiveKitParticipantLeft("alice", "voice-room", "new-session")).toBe(true);
    expect(state.voiceStates.has("alice")).toBe(false);
});
