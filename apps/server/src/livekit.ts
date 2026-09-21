import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { LiveKitTokenRequest, LiveKitTokenResponse } from "@tescord/types";

export function getRoomServiceClient(
  apiKey: string = process.env.LIVEKIT_API_KEY || "devkey",
  apiSecret: string = process.env.LIVEKIT_API_SECRET || "secretsecretsecret",
  livekitUrl: string = process.env.LIVEKIT_URL || "ws://localhost:7880",
): RoomServiceClient {
  const httpUrl =
    process.env.LIVEKIT_HTTP_URL ||
    livekitUrl.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://");
  return new RoomServiceClient(httpUrl, apiKey, apiSecret);
}

export async function removeParticipantFromRoom(
  roomName: string,
  identity: string,
): Promise<void> {
  try {
    const svc = getRoomServiceClient();
    await svc.removeParticipant(roomName, identity);
    console.log(
      `[LiveKit] Successfully removed participant ${identity} from room ${roomName}`,
    );
  } catch (err: any) {
    console.warn(
      `[LiveKit] Failed or skipped removing participant ${identity} from ${roomName}:`,
      err?.message || err,
    );
  }
}

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
