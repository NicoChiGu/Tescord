import { gatewayManager } from "./gateway.js";
import { getWebhookReceiver } from "./livekit.js";
import { AccessToken } from "livekit-server-sdk";
import { createHash } from "crypto";

async function runVerification() {
  console.log("=== [Test 1] 验证 GatewayManager.handleLiveKitParticipantLeft 权威清理逻辑 ===");

  const testUserId = "test-user-disconnect-123";
  const testChannelId = "test-channel-456";
  const testGuildId = "test-guild-789";
  const testSessionId = "session-abc";

  // 1. 手动注入模拟语音状态
  (gatewayManager as any).voiceStates.set(testUserId, {
    userId: testUserId,
    channelId: testChannelId,
    guildId: testGuildId,
    sessionId: testSessionId,
    selfMute: false,
    selfDeaf: false,
    selfVideo: false,
    streaming: false,
  });

  console.log("初始模拟 VoiceState:", (gatewayManager as any).voiceStates.get(testUserId));
  if (!(gatewayManager as any).voiceStates.has(testUserId)) {
    throw new Error("Failed to inject test VoiceState");
  }

  // 2. 测试 roomName 不匹配时的防误杀保护
  const ignoredResult = gatewayManager.handleLiveKitParticipantLeft(testUserId, "other-channel-999");
  console.log("不匹配 roomName 结果 (应为 false):", ignoredResult);
  if (ignoredResult !== false || !(gatewayManager as any).voiceStates.has(testUserId)) {
    throw new Error("Mismatched roomName was not properly ignored!");
  }

  // 3. 测试匹配 roomName 时的权威清理
  const cleanResult = gatewayManager.handleLiveKitParticipantLeft(testUserId, testChannelId);
  console.log("匹配 roomName 结果 (应为 true):", cleanResult);
  if (cleanResult !== true || (gatewayManager as any).voiceStates.has(testUserId)) {
    throw new Error("Matched roomName failed to clear VoiceState!");
  }
  console.log("✓ [Test 1 PASS] GatewayManager.handleLiveKitParticipantLeft 权威收敛与防误杀机制验证通过！");

  console.log("\n=== [Test 2] 验证 LiveKit WebhookReceiver 签名校验与事件解析 ===");
  const apiKey = process.env.LIVEKIT_API_KEY || "devkey";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "secretsecretsecret";
  const receiver = getWebhookReceiver(apiKey, apiSecret);

  const eventPayload = {
    event: "participant_left",
    room: { name: testChannelId },
    participant: { identity: testUserId, name: "Tester" },
    id: "webhook-event-1",
    createdAt: Math.floor(Date.now() / 1000),
  };
  const rawBody = JSON.stringify(eventPayload);

  // 构造合法的 LiveKit Webhook JWT 签名 (LiveKit 使用 base64 编码的 sha256)
  const token = new AccessToken(apiKey, apiSecret);
  const sha256 = createHash("sha256").update(rawBody).digest("base64");
  token.sha256 = sha256;
  const authHeader = await token.toJwt();

  const parsedEvent = await receiver.receive(rawBody, authHeader);
  console.log("Parsed webhook event:", parsedEvent.event, "participant:", parsedEvent.participant?.identity);

  if (parsedEvent.event !== "participant_left" || parsedEvent.participant?.identity !== testUserId) {
    throw new Error("Webhook verification or parsing failed!");
  }
  console.log("✓ [Test 2 PASS] LiveKit WebhookReceiver 签名验证与 payload 解码验证通过！");

  console.log("\n==========================================");
  console.log("🎉 所有 LiveKit 断线与 Webhook 权威收敛测试用例均 100% 通过！");
  console.log("==========================================");
}

runVerification().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
