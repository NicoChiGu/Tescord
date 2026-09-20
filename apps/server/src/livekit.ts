import { AccessToken } from "livekit-server-sdk";
import { LiveKitTokenRequest, LiveKitTokenResponse } from "@tescord/types";

export async function generateLiveKitToken(
  req: LiveKitTokenRequest,
  apiKey: string = process.env.LIVEKIT_API_KEY || "devkey",
  apiSecret: string = process.env.LIVEKIT_API_SECRET || "secretsecretsecret",
  livekitUrl: string = process.env.LIVEKIT_URL || "ws://localhost:7880",
): Promise<LiveKitTokenResponse> {
  if (!req || !req.roomName || !req.identity) {
    throw new Error(
      "roomName and identity are required for LiveKit token generation",
    );
  }

  const metadata = JSON.stringify({
    bitrate: req.bitrate || 64000,
    codec: "opus",
  });

  const at = new AccessToken(apiKey, apiSecret, {
    identity: req.identity,
    name: req.name || req.identity,
    metadata,
    ttl: "24h",
  });

  at.addGrant({
    roomJoin: true,
    room: req.roomName,
    canPublish: req.isPublisher !== false, // 默认允许推流
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();

  return {
    token,
    url: livekitUrl,
  };
}
