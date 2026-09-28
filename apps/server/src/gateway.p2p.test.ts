import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayManager } from "./gateway.js";
import { permissionService } from "./services/permission.service.js";

test("P2P Voice Transition Guard: canSignalVoice and pendingVoiceJoins", async () => {
  const gateway = new GatewayManager();

  // Mock permissionService to allow CONNECT
  const originalHasPermission = permissionService.hasChannelPermission;
  permissionService.hasChannelPermission = async () => true;

  const connA: any = {
    userId: "user-alice",
    sessionId: "session-alice",
    ws: { readyState: 1 },
    isAlive: true,
  };

  const connB: any = {
    userId: "user-bob",
    sessionId: "session-bob",
    ws: { readyState: 1 },
    isAlive: true,
  };

  const channelId = "voice-channel-1";

  // Mock permissionService
  const originalCheck = (gateway as any).canSignalVoice;

  // 1. Initial state: Alice is not in voiceStates or pendingVoiceJoins -> canSignalVoice is false
  const canSignalBefore = await (gateway as any).canSignalVoice(
    connA,
    channelId,
  );
  assert.equal(
    canSignalBefore,
    false,
    "Should reject signal before user has joined",
  );

  // 2. Alice starts joining channel (pendingVoiceJoins set)
  (gateway as any).pendingVoiceJoins.set(connA.userId, {
    channelId,
    sessionId: connA.sessionId,
    timestamp: Date.now(),
  });

  // Verify transition guard allows signaling while joining
  const canSignalDuringJoin = await (gateway as any).canSignalVoice(
    connA,
    channelId,
  );
  assert.equal(
    canSignalDuringJoin,
    true,
    "Should allow signal during in-flight voice state transition",
  );

  // 3. Target verification during transition
  const targetPending = (gateway as any).pendingVoiceJoins.get(connA.userId);
  assert.ok(targetPending, "Pending join entry should exist");
  assert.equal(targetPending.channelId, channelId);

  // 4. Stale transition (> 5000ms) should be rejected
  (gateway as any).pendingVoiceJoins.set(connA.userId, {
    channelId,
    sessionId: connA.sessionId,
    timestamp: Date.now() - 6000,
  });
  const canSignalExpired = await (gateway as any).canSignalVoice(
    connA,
    channelId,
  );
  assert.equal(
    canSignalExpired,
    false,
    "Should reject expired pending join transition",
  );

  // 5. Once voiceStates is set, pendingVoiceJoins is cleaned up and signaling continues to work
  (gateway as any).pendingVoiceJoins.delete(connA.userId);
  (gateway as any).voiceStates.set(connA.userId, {
    channelId,
    sessionId: connA.sessionId,
    userId: connA.userId,
    guildId: "guild-1",
    selfMute: false,
    selfDeaf: false,
    selfVideo: false,
    streaming: false,
  });

  const canSignalAfterConfirmed = await (gateway as any).canSignalVoice(
    connA,
    channelId,
  );
  assert.equal(
    canSignalAfterConfirmed,
    true,
    "Should allow signal when confirmed in voiceStates",
  );

  // 6. Cleanup removes user state
  (gateway as any).cleanup(connA);
  assert.equal(
    (gateway as any).pendingVoiceJoins.has(connA.userId),
    false,
    "Cleanup should clear pendingVoiceJoins",
  );

  permissionService.hasChannelPermission = originalHasPermission;
});
