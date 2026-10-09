import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ErrorCode, MEDIA_ENCRYPTION_VERSION } from "@tescord/types";
import type {
  MediaEncryptionJoinRequest,
  MediaStreamKeyPublishRequest,
  MediaStreamKeyAcknowledgeRequest,
} from "@tescord/types";
import { mediaEncryptionRegistry } from "./media-encryption.service.js";

type ErrorSender = (
  reply: FastifyReply,
  status: number,
  code: ErrorCode | string,
  message: string,
) => unknown;
export function registerMediaEncryptionRoutes(
  server: FastifyInstance,
  getUserId: (request: FastifyRequest) => Promise<string | null>,
  sendApiError: ErrorSender,
): void {
  const operations = [
    "join",
    "sync",
    "publish",
    "acknowledge",
    "leave",
  ] as const;
  for (const operation of operations)
    server.post(
      `/api/channels/:channelId/media-encryption/${operation}`,
      {
        preHandler: async (request, reply) => {
          reply.header("Cache-Control", "no-store");
          await (
            server as FastifyInstance & {
              authenticate: (
                request: FastifyRequest,
                reply: FastifyReply,
              ) => Promise<unknown>;
            }
          ).authenticate(request, reply);
        },
        bodyLimit: 2 * 1024 * 1024,
      },
      async (request, reply) => {
        const userId = await getUserId(request),
          claims = request.user as { sessionId?: string };
        if (!userId || !claims.sessionId)
          return sendApiError(
            reply,
            401,
            ErrorCode.UNAUTHORIZED,
            ErrorCode.UNAUTHORIZED,
          );
        const { channelId } = request.params as { channelId: string };
        const body = request.body as MediaEncryptionJoinRequest & {
          publish?: MediaStreamKeyPublishRequest;
          acknowledge?: MediaStreamKeyAcknowledgeRequest;
        };
        if (!body || typeof body !== "object")
          return sendApiError(
            reply,
            400,
            ErrorCode.INVALID_PARAMS,
            ErrorCode.INVALID_PARAMS,
          );
        try {
          if (body.version !== MEDIA_ENCRYPTION_VERSION)
            throw new Error(ErrorCode.MEDIA_E2EE_UNSUPPORTED);
          if (operation === "join")
            return await mediaEncryptionRegistry.join(
              userId,
              claims.sessionId,
              channelId,
              body,
            );
          if (operation === "sync")
            return await mediaEncryptionRegistry.snapshot(
              userId,
              claims.sessionId,
              channelId,
              body,
            );
          if (operation === "publish") {
            if (!body.publish) throw new Error(ErrorCode.INVALID_PARAMS);
            return await mediaEncryptionRegistry.publish(
              userId,
              claims.sessionId,
              channelId,
              body,
              body.publish,
            );
          }
          if (operation === "acknowledge") {
            if (!body.acknowledge) throw new Error(ErrorCode.INVALID_PARAMS);
            await mediaEncryptionRegistry.acknowledge(
              userId,
              claims.sessionId,
              channelId,
              body,
              body.acknowledge,
            );
            return { success: true };
          }
          if (
            typeof body.registrationId !== "string" ||
            !body.registrationId ||
            body.registrationId.length > 160
          )
            throw new Error(ErrorCode.INVALID_PARAMS);
          mediaEncryptionRegistry.leave(
            userId,
            channelId,
            body.gatewaySessionId,
            body.callId,
            body.registrationId,
          );
          return { success: true };
        } catch (error) {
          const code =
            error instanceof Error &&
            Object.values(ErrorCode).includes(error.message as ErrorCode)
              ? (error.message as ErrorCode)
              : ErrorCode.MEDIA_CONTEXT_STALE;
          return sendApiError(
            reply,
            code === ErrorCode.INVALID_PARAMS
              ? 400
              : code === ErrorCode.UNAUTHORIZED
                ? 401
                : code === ErrorCode.MEDIA_CONTEXT_STALE
                  ? 409
                  : 403,
            code,
            code,
          );
        }
      },
    );
}
