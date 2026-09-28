import {
  AccessToken,
  RoomServiceClient,
  WebhookReceiver,
} from "livekit-server-sdk";
import { LiveKitTokenRequest, LiveKitTokenResponse } from "@tescord/types";

function resolveLiveKitCredentials(
  apiKey?: string,
  apiSecret?: string,
): { key: string; secret: string } {
  const resolvedKey = apiKey || process.env.LIVEKIT_API_KEY || "devkey";
  const resolvedSecret =
    apiSecret || process.env.LIVEKIT_API_SECRET || "secretsecretsecret";

  if (
    process.env.NODE_ENV === "production" &&
    (resolvedKey === "devkey" || resolvedSecret === "secretsecretsecret")
  ) {
    throw new Error(
      "LiveKit API key or secret must be explicitly configured in production environment.",
    );
  }

  return { key: resolvedKey, secret: resolvedSecret };
}

export function getWebhookReceiver(
  apiKey?: string,
  apiSecret?: string,
): WebhookReceiver {
  const { key, secret } = resolveLiveKitCredentials(apiKey, apiSecret);
  return new WebhookReceiver(key, secret);
}

export function getRoomServiceClient(
  apiKey?: string,
  apiSecret?: string,
  livekitUrl: string = process.env.LIVEKIT_URL || "ws://localhost:7880",
): RoomServiceClient {
  const { key, secret } = resolveLiveKitCredentials(apiKey, apiSecret);
  const httpUrl =
    process.env.LIVEKIT_HTTP_URL ||
    livekitUrl.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://");
  return new RoomServiceClient(httpUrl, key, secret);
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
  apiKey?: string,
  apiSecret?: string,
  livekitUrl: string = process.env.LIVEKIT_URL || "ws://localhost:7880",
): Promise<LiveKitTokenResponse> {
  if (!req || !req.roomName || !req.identity) {
    throw new Error(
      "roomName and identity are required for LiveKit token generation",
    );
  }

  const { key, secret } = resolveLiveKitCredentials(apiKey, apiSecret);

  const metadata = JSON.stringify({
    bitrate: req.bitrate || 64000,
    codec: "opus",
    gatewaySessionId: req.gatewaySessionId,
  });

  const at = new AccessToken(key, secret, {
    identity: req.identity,
    name: req.name || req.identity,
    metadata,
    ttl: "2h",
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
