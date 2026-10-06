import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  ErrorCode,
  PermissionFlags,
  type GuildIconProcessRequest,
} from "@tescord/types";
import { permissionService } from "./services/permission.service.js";
import { storageService } from "./services/storage.service.js";
import { guildIconProcessor } from "./services/guild-icon.service.js";

export function registerGuildIconRoutes(
  server: FastifyInstance,
  authenticate: (request: FastifyRequest) => Promise<string | null>,
  sendApiError: (
    reply: FastifyReply,
    status: number,
    code: ErrorCode,
    fallback: string,
  ) => unknown,
) {
  const error = (reply: FastifyReply, code: string, status = 400) =>
    sendApiError(reply, status, code as ErrorCode, code);
  const authorize = async (request: FastifyRequest) => {
    const userId = await authenticate(request);
    const { guildId } = request.params as { guildId: string };
    if (!userId) throw new Error(ErrorCode.UNAUTHORIZED);
    if (
      !(await permissionService.hasGuildPermission(
        userId,
        guildId,
        PermissionFlags.MANAGE_GUILD,
      ))
    )
      throw new Error(ErrorCode.FORBIDDEN);
    return { userId, guildId };
  };
  for (const action of ["metadata", "preview", "process"] as const)
    server.post(
      `/api/guilds/:guildId/icon/${action}`,
      async (request, reply) => {
        let generated: string | undefined;
        let owner: { userId: string; guildId: string } | undefined;
        try {
          owner = await authorize(request);
          const body = request.body as Partial<GuildIconProcessRequest> | null;
          if (
            !body ||
            typeof body.fileUrl !== "string" ||
            body.fileUrl.length > 2048 ||
            (body.frame !== undefined &&
              (!Number.isSafeInteger(body.frame) || body.frame < 0))
          )
            return error(reply, ErrorCode.INVALID_PARAMS);
          const { bytes, mimeType, processed } =
            await storageService.readPendingGuildIcon(
              owner.userId,
              owner.guildId,
              body.fileUrl,
            );
          const result = await guildIconProcessor.run(async () => {
            if (action === "metadata")
              return {
                kind: "metadata" as const,
                value: await guildIconProcessor.metadata(bytes, processed),
              };
            if (action === "preview")
              return {
                kind: "preview" as const,
                value:
                  body.frame === undefined
                    ? bytes
                    : await guildIconProcessor.frame(
                        bytes,
                        body.frame,
                        processed,
                      ),
                mimeType: body.frame === undefined ? mimeType : "image/png",
              };
            if (body.output !== "animated" && body.output !== "frame")
              throw new Error(ErrorCode.INVALID_PARAMS);
            return {
              kind: "processed" as const,
              value: await guildIconProcessor.process(
                bytes,
                body as GuildIconProcessRequest,
              ),
            };
          });
          await authorize(request); // Re-check revoked sessions/permissions after expensive processing.
          storageService.assertPendingGuildIcon(
            owner.userId,
            owner.guildId,
            body.fileUrl,
          );
          if (request.raw.aborted || reply.raw.destroyed)
            throw new Error(ErrorCode.INVALID_PARAMS);
          if (result.kind === "metadata") return result.value;
          if (result.kind === "preview")
            return reply
              .header("Cache-Control", "no-store")
              .type(result.mimeType)
              .send(result.value);
          generated = await storageService.createProcessedGuildIcon(
            owner.userId,
            owner.guildId,
            result.value.bytes,
            body.output === "animated",
          );
          await authorize(request);
          storageService.assertPendingGuildIcon(
            owner.userId,
            owner.guildId,
            body.fileUrl,
          );
          if (request.raw.aborted || reply.raw.destroyed)
            throw new Error(ErrorCode.INVALID_PARAMS);
          return {
            fileUrl: generated,
            mimeType: body.output === "animated" ? "image/gif" : "image/png",
            metadata: result.value.metadata,
          };
        } catch (cause) {
          if (generated && owner)
            await storageService
              .discardPendingPublicAsset(owner.userId, owner.guildId, generated)
              .catch(() => {});
          const code =
            cause instanceof Error ? cause.message : ErrorCode.INTERNAL_ERROR;
          const known = new Set<string>([
            ...Object.values(ErrorCode),
            "ICON_PROCESS_TIMEOUT",
          ]);
          if (!known.has(code)) {
            request.log.warn({ err: cause }, "Guild icon processing rejected");
            return error(reply, ErrorCode.FILE_TYPE_UNSUPPORTED);
          }
          return error(
            reply,
            code,
            code === ErrorCode.UNAUTHORIZED
              ? 401
              : code === ErrorCode.FORBIDDEN
                ? 403
                : code === ErrorCode.RATE_LIMITED
                  ? 429
                  : 400,
          );
        }
      },
    );
}
