import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ErrorCode } from "@tescord/types";

interface ImageCacheEntry {
  buffer: Buffer;
  contentType: string;
  expiresAt: number;
}

const steamImageCache = new Map<string, ImageCacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

export function registerSteamGameRoutes(
  server: FastifyInstance,
  sendApiError: (
    reply: FastifyReply,
    status: number,
    code: ErrorCode,
    fallback: string,
  ) => unknown,
) {
  server.get(
    "/api/games/steam/:appId/image",
    async (
      request: FastifyRequest<{
        Params: { appId: string };
        Querystring: { type?: "header" | "capsule" };
      }>,
      reply: FastifyReply,
    ) => {
      const { appId } = request.params;
      if (!appId || !/^\d+$/.test(appId)) {
        return sendApiError(
          reply,
          400,
          ErrorCode.INVALID_PARAMS,
          "Invalid Steam AppID",
        );
      }

      const imgType =
        request.query?.type === "capsule" ? "capsule_231x87.jpg" : "header.jpg";
      const cacheKey = `${appId}:${imgType}`;
      const now = Date.now();

      const cached = steamImageCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        reply.header("Content-Type", cached.contentType);
        reply.header("Cache-Control", "public, max-age=86400, immutable");
        return reply.send(cached.buffer);
      }

      const cdnUrls = [
        `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/${imgType}`,
        `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/${imgType}`,
      ];

      for (const url of cdnUrls) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(url, {
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });
          clearTimeout(timeout);

          if (res.ok) {
            const arrayBuffer = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const contentType = res.headers.get("content-type") || "image/jpeg";

            if (steamImageCache.size >= MAX_CACHE_ENTRIES) {
              const oldestKey = steamImageCache.keys().next().value;
              if (oldestKey) steamImageCache.delete(oldestKey);
            }

            steamImageCache.set(cacheKey, {
              buffer,
              contentType,
              expiresAt: now + CACHE_TTL_MS,
            });

            reply.header("Content-Type", contentType);
            reply.header("Cache-Control", "public, max-age=86400, immutable");
            return reply.send(buffer);
          }
        } catch {
          // 容错并尝试下一个 CDN 节点
        }
      }

      return sendApiError(
        reply,
        404,
        ErrorCode.NOT_FOUND,
        "Steam game image not found",
      );
    },
  );
}
