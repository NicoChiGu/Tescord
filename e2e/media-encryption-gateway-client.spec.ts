import { test, expect } from "@playwright/test";
import type { GatewayClient } from "../apps/web/src/services/gateway";
import type { MediaEncryptionSyncRequest } from "@tescord/types";

test("Gateway sync correlates responses, rejects invalid scope, and releases cancelled requests", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  let mode = "reply";
  let held: MediaEncryptionSyncRequest | undefined;
  let sendLate: (() => void) | undefined;
  await page.routeWebSocket("**/gateway", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (typeof message !== "string") return server.send(message);
      const packet = JSON.parse(message) as {
        t?: string;
        d?: MediaEncryptionSyncRequest;
      };
      if (
        packet.t !== "MEDIA_ENCRYPTION_SYNC" ||
        packet.d?.registrationId !== "client-probe"
      )
        return server.send(message);
      const request = packet.d;
      const result = {
        requestId: request.requestId,
        channelId: request.channelId,
        registrationId: request.registrationId,
        success: false,
        code: "MEDIA_CONTEXT_STALE",
      };
      const send = (data: unknown) =>
        socket.send(
          JSON.stringify({ op: 0, t: "MEDIA_ENCRYPTION_SYNC_RESULT", d: data }),
        );
      if (mode === "hold") {
        held = request;
        sendLate = () => send(result);
        return;
      }
      if (mode === "channel")
        return send({ ...result, channelId: "foreign-channel" });
      if (mode === "registration")
        return send({ ...result, registrationId: "old-registration" });
      if (mode === "malformed") return send({ ...result, success: true });
      if (mode === "unrelated")
        send({ ...result, requestId: "unrelated-request" });
      send(result);
      send(result); // Duplicate completion must be harmless.
    });
  });
  await page.goto("/");
  await page.waitForFunction(() => {
    const gateway = (window as unknown as { __gatewayClient: GatewayClient })
      .__gatewayClient;
    return (
      gateway?.getConnectionState() === "connected" &&
      gateway.supportsMediaEncryptionSync()
    );
  });
  const probe = async (
    action: "request" | "abort" | "disconnect" = "request",
  ) =>
    page.evaluate(async (operation) => {
      const gateway = (
        window as unknown as {
          __gatewayClient: GatewayClient;
        }
      ).__gatewayClient;
      const internal = gateway as unknown as {
        authenticatedUserId: string;
        pendingMediaSync: Map<string, unknown>;
      };
      const controller = new AbortController();
      const pending = gateway.requestMediaEncryptionSync(
        internal.authenticatedUserId,
        {
          version: 3,
          channelId: "probe-channel",
          deviceId: "probe-device",
          gatewaySessionId: gateway.getSessionId(),
          registrationId: "client-probe",
        },
        controller.signal,
      );
      if (operation === "abort") controller.abort();
      if (operation === "disconnect") gateway.disconnect();
      try {
        return {
          result: await pending,
          pending: internal.pendingMediaSync.size,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : "",
          pending: internal.pendingMediaSync.size,
        };
      }
    }, action);
  for (const next of ["reply", "unrelated"]) {
    mode = next;
    const value = await probe();
    expect(value.result).toMatchObject({
      success: false,
      code: "MEDIA_CONTEXT_STALE",
    });
    expect(value.pending).toBe(0);
  }
  for (const next of ["channel", "registration", "malformed"]) {
    mode = next;
    const value = await probe();
    expect(value.error).toBe("MEDIA_KEY_INVALID");
    expect(value.pending).toBe(0);
  }
  mode = "hold";
  const timedOut = await probe();
  expect(timedOut.name).toBe("TimeoutError");
  expect(timedOut.pending).toBe(0);
  expect(held).toBeDefined();
  sendLate?.();
  const aborted = await probe("abort");
  expect(aborted.name).toBe("AbortError");
  expect(aborted.pending).toBe(0);
  const disconnected = await probe("disconnect");
  expect(disconnected.name).toBe("TypeError");
  expect(disconnected.pending).toBe(0);
  await info.attach("gateway-sync-cancellation-proof.json", {
    body: JSON.stringify({
      correlation: true,
      invalidScopeRejected: 3,
      timedOut,
      aborted,
      disconnected,
    }),
    contentType: "application/json",
  });
});
