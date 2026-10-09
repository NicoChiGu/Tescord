import {
  expect,
  type APIRequestContext,
  type Browser,
  type TestInfo,
} from "@playwright/test";
import type { MediaTransformEvent } from "@tescord/types";
import {
  createMultiplayerRoom,
  type MultiplayerMode,
} from "./encrypted-multiplayer";

/** Preserve native Workers/transforms and inject only a retired pipeline's queued error. */
export async function exerciseMemberLeave(
  browser: Browser,
  request: APIRequestContext,
  info: TestInfo,
  count: number,
  mode: MultiplayerMode,
) {
  const room = await createMultiplayerRoom(
    browser,
    request,
    info,
    count,
    mode,
    info.project.name === "relay",
    async (page, index) => {
      if (index !== 1) return;
      await page.addInitScript(() => {
        const scope = window as unknown as {
          RTCRtpScriptTransform: new (
            worker: Worker,
            options?: unknown,
            transfer?: Transferable[],
          ) => object;
          retiredReceiverProbe?: {
            worker: Worker;
            callback:
              ((event: MessageEvent<MediaTransformEvent>) => void) | null;
            track: MediaStreamTrack;
          };
          captureReceiverWorker?(transform: object): Worker | undefined;
        };
        const workers = new WeakMap<object, Worker>();
        const Native = scope.RTCRtpScriptTransform;
        scope.RTCRtpScriptTransform = class extends Native {
          constructor(
            worker: Worker,
            options?: unknown,
            transfer?: Transferable[],
          ) {
            super(worker, options, transfer);
            workers.set(this, worker);
          }
        };
        scope.captureReceiverWorker = (transform) => workers.get(transform);
      });
    },
  );
  const [a, b, c] = room.endpoints;
  const remaining = [a, b, ...room.endpoints.slice(3)];
  try {
    await room.join(a);
    await room.firstReady(a);
    for (const endpoint of remaining.slice(1)) {
      await room.join(endpoint);
      await room.waitForMedia(
        remaining.slice(0, remaining.indexOf(endpoint) + 1),
      );
    }
    await room.sustain(remaining, 3000);
    // Rejoining C must create an independent receiver; an older queued error
    // must not affect B or any surviving participant in either round.
    for (let iteration = 0; iteration < 2; iteration++) {
      await room.join(c);
      await room.waitForMedia(room.endpoints);
      await b.page.evaluate(
        ({ id, mode }) => {
          const scope = window as unknown as {
            voiceMeshManager: {
              peerConnections: Map<string, RTCPeerConnection>;
            };
            cloudflareRealtimeService: {
              pc: RTCPeerConnection | null;
              audioRoutes: Map<
                string,
                { publication?: { userId: string }; track: MediaStreamTrack }
              >;
            };
            captureReceiverWorker(transform: object): Worker | undefined;
            retiredReceiverProbe?: {
              worker: Worker;
              callback:
                ((event: MessageEvent<MediaTransformEvent>) => void) | null;
              track: MediaStreamTrack;
            };
          };
          const service = scope.cloudflareRealtimeService;
          const track =
            mode === "cloudflare_sfu"
              ? [...service.audioRoutes.values()].find(
                  (route) => route.publication?.userId === id,
                )?.track
              : scope.voiceMeshManager.peerConnections
                  .get(id)
                  ?.getReceivers()
                  .find((receiver) => receiver.track.kind === "audio")?.track;
          const pc =
            mode === "cloudflare_sfu"
              ? service.pc
              : scope.voiceMeshManager.peerConnections.get(id);
          const receiver = pc
            ?.getReceivers()
            .find((receiver) => receiver.track === track);
          const transform = (
            receiver as unknown as { transform?: object } | undefined
          )?.transform;
          const worker = transform && scope.captureReceiverWorker(transform);
          if (!worker || !track || !worker.onmessage)
            throw new Error("Missing real receiver pipeline probe");
          scope.retiredReceiverProbe = {
            worker,
            callback: worker.onmessage,
            track,
          };
        },
        { id: c.session.user.id, mode },
      );
      await room.leave(c);
      await room.waitForMedia(remaining);
      const proof = await b.page.evaluate(() => {
        const scope = window as unknown as {
          retiredReceiverProbe?: {
            worker: Worker;
            callback:
              ((event: MessageEvent<MediaTransformEvent>) => void) | null;
            track: MediaStreamTrack;
          };
        };
        const probe = scope.retiredReceiverProbe;
        if (!probe?.callback)
          throw new Error("Retired pipeline callback missing");
        probe.callback.call(
          probe.worker,
          new MessageEvent("message", {
            data: {
              type: "fatal",
              error: "MEDIA_KEY_UNAVAILABLE",
            } satisfies MediaTransformEvent,
          }),
        );
        delete scope.retiredReceiverProbe;
        return { injected: true, trackState: probe.track.readyState };
      });
      expect(proof.injected).toBe(true);
      if (mode === "cloudflare_sfu") expect(proof.trackState).toBe("ended");
      await room.sustain(remaining, 7000);
      for (const endpoint of remaining)
        await expect(
          endpoint.page
            .getByRole("button", { name: "断开连接", exact: true })
            .first(),
        ).toBeVisible();
    }
    expect(room.errors).toEqual([]);
  } finally {
    await room.cleanup();
  }
}
