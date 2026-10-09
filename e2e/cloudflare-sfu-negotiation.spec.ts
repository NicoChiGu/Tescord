import { test, expect, type Page } from "@playwright/test";
import type { CfMediaPublication } from "@tescord/types";
import { createRequire } from "node:module";
import path from "node:path";

// Deterministic signaling regressions. These do not claim real SFU/RTP acceptance.
interface Harness {
  pc: RTCPeerConnection | null;
  sessionId: string | null;
  currentChannelId: string | null;
  currentPublications: Map<string, CfMediaPublication>;
  publishedTracks: Map<string, unknown>;
  subscribedTracks: Set<string>;
  mediaOperationEpoch: number;
  syncPublications(tracks: CfMediaPublication[]): Promise<void>;
  queue(task: () => Promise<void>): Promise<void>;
  unpublishSource(source: "camera"): Promise<void>;
  disconnect(): Promise<void>;
  subscribeRemoteTrack(sessionId: string, trackName: string): Promise<void>;
  readTrackResponse(
    response: Response,
    location: "local" | "remote",
  ): Promise<{
    tracks: Array<{ location: "local" | "remote"; mid?: string }>;
    sessionDescription?: { type: "offer" | "answer" };
  }>;
}

test.describe("SFU session negotiation queue", () => {
  const uncaughtErrors = new WeakMap<Page, string[]>();
  let identityServer: { close(): Promise<void> } | undefined;
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    uncaughtErrors.set(page, errors);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/auth/registration-status", (route) =>
      route.fulfill({
        json: { allowRegistration: true, requireInviteCode: false },
      }),
    );
  });
  test.afterEach(async ({ page }) => {
    await identityServer?.close();
    identityServer = undefined;
    expect(uncaughtErrors.get(page)).toEqual([]);
  });
  test("Real SFU compact publication result omits location", async ({
    page,
  }) => {
    await page.goto("/");
    const normalized = await page.evaluate(async () => {
      const service = (
        window as unknown as { cloudflareRealtimeService: Harness }
      ).cloudflareRealtimeService;
      return service.readTrackResponse(
        new Response(
          JSON.stringify({
            requiresImmediateRenegotiation: false,
            sessionDescription: { type: "answer", sdp: "v=0" },
            tracks: [{ mid: "0", trackName: "microphone-regression" }],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
        "local",
      );
    });
    expect(normalized.tracks).toEqual([
      { mid: "0", trackName: "microphone-regression", location: "local" },
    ]);
    expect(normalized.sessionDescription?.type).toBe("answer");
  });

  for (const scenario of [
    "offer",
    "no-sdp",
    "no-location",
    "partial",
    "all-rejected",
    "missing-mid",
    "unmatched-result",
    "unknown-result",
    "malformed-result",
    "stale-queued",
    "publication-replaced",
    "own-old-publication",
  ] as const) {
    test(`${scenario}: batch, deduplication and complete exchange ownership`, async ({
      page,
    }) => {
      const calls: string[] = [];
      const batches: string[][] = [];
      await page.route("**/api/cloudflare-realtime/**", async (route) => {
        const endpoint = new URL(route.request().url()).pathname
          .split("/")
          .at(-1)!;
        calls.push(endpoint);
        const body = route.request().postDataJSON() as {
          tracks?: Array<{ trackName: string; publisherSessionId: string }>;
        };
        if (endpoint === "subscribe") {
          batches.push((body.tracks || []).map((track) => track.trackName));
          if (scenario === "unknown-result") {
            await route.fulfill({
              status: 502,
              json: { code: "MEDIA_CONTEXT_STALE" },
            });
            return;
          }
          if (scenario === "malformed-result") {
            await route.fulfill({
              json: { requiresImmediateRenegotiation: true },
            });
            return;
          }
          await route.fulfill({
            json: {
              ...(scenario === "no-sdp" || scenario === "all-rejected"
                ? {}
                : {
                    requiresImmediateRenegotiation: true,
                    sessionDescription: { type: "offer", sdp: "v=0" },
                  }),
              tracks: (body.tracks || []).map((track, index) => ({
                ...(scenario === "no-location" ? {} : { location: "remote" }),
                trackName:
                  scenario === "unmatched-result" && index === 0
                    ? "unknown-track"
                    : track.trackName,
                sessionId: track.publisherSessionId,
                ...(scenario === "all-rejected" ||
                (scenario === "partial" && index === 1)
                  ? { errorCode: "TRACK_NOT_FOUND" }
                  : scenario === "missing-mid" && index === 0
                    ? {}
                    : { mid: String(index + 1) }),
              })),
            },
          });
        } else {
          if (endpoint === "renegotiate")
            await new Promise((resolve) => setTimeout(resolve, 120));
          await route.fulfill({ json: { ok: true } });
        }
      });
      if (scenario === "own-old-publication") {
        const webRoot = path.resolve(process.cwd(), "apps/web");
        const webRequire = createRequire(path.join(webRoot, "package.json"));
        const { createServer } = await import(webRequire.resolve("vite"));
        const server = await createServer({
          root: webRoot,
          server: { host: "127.0.0.1", port: 0, hmr: false },
        });
        identityServer = server;
        await server.listen();
        const origin = server.resolvedUrls!.local[0];
        await page.route(`${origin}identity-harness`, (route) =>
          route.fulfill({ contentType: "text/html", body: "<html></html>" }),
        );
        await page.goto(`${origin}identity-harness`);
        await page.evaluate(async () => {
          const { cloudflareRealtimeService } =
            await import("/src/services/cloudflare_realtime/CloudflareRealtimeService.ts");
          const { useAuthStore } = await import("/src/stores/useAuthStore.ts");
          // Module-only identity changes must not mount App account cleanup effects.
          Object.assign(window, { cloudflareRealtimeService, useAuthStore });
        });
      } else await page.goto("/");
      const result = await page.evaluate(async (scenario) => {
        const service = (
          window as unknown as { cloudflareRealtimeService: Harness }
        ).cloudflareRealtimeService;
        const descriptions: string[] = [];
        const pc = Object.assign(new EventTarget(), {
          connectionState: "connected",
          iceGatheringState: "complete",
          localDescription: {
            type: "answer",
            sdp: "v=0\r\na=candidate:1 1 UDP 1 203.0.113.1 6000 typ srflx\r\n",
          },
          getConfiguration: () => ({ iceTransportPolicy: "all" }),
          setRemoteDescription: async (
            description: RTCSessionDescriptionInit,
          ) => {
            descriptions.push(description.type);
          },
          createAnswer: async () => ({ type: "answer", sdp: "v=0" }),
          setLocalDescription: async () => undefined,
          removeTrack: () => descriptions.push("remove"),
          close: () => undefined,
          getSenders: () => [],
          getReceivers: () => [],
        }) as unknown as RTCPeerConnection;
        service.pc = pc;
        service.sessionId = "subscriber";
        service.currentChannelId = "channel";
        if (scenario === "own-old-publication")
          (
            window as unknown as {
              useAuthStore: { setState(state: { user: { id: string } }): void };
            }
          ).useAuthStore.setState({ user: { id: "user-1" } });
        const publications: CfMediaPublication[] = [1, 2, 3, 4].map(
          (index) => ({
            channelId: "channel",
            sessionId: `publisher-${index}`,
            userId: `user-${index}`,
            trackName: `microphone-${index}`,
            kind: "audio",
            source: "microphone",
          }),
        );
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const blocker = service.queue(async () => {
          entered();
          await gate;
        });
        await started;
        const first = service.syncPublications(publications).then(
          () => "ok",
          () => "rejected",
        );
        const latest =
          scenario === "publication-replaced"
            ? publications.slice(1)
            : publications;
        const second = service.syncPublications(latest).then(
          () => "ok",
          () => "rejected",
        );
        service.publishedTracks.set("camera", {
          sender: { track: { stop: () => undefined } },
          stream: new MediaStream(),
          mid: "8",
          trackName: "camera-local",
        });
        const close = service.unpublishSource("camera").catch(() => undefined);
        if (scenario === "stale-queued") service.mediaOperationEpoch++;
        release();
        await blocker;
        const outcomes = await Promise.all([first, second, close]);
        if (scenario === "partial") {
          for (
            let attempt = 0;
            attempt < 20 && service.subscribedTracks.size < 4;
            attempt++
          )
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const activeSession = service.sessionId;
        const subscribed = [...service.subscribedTracks].sort();
        await service.disconnect();
        return { descriptions, subscribed, outcomes, activeSession };
      }, scenario);
      if (scenario === "stale-queued") {
        expect(batches).toHaveLength(0);
        expect(result.outcomes.slice(0, 2)).toEqual(["rejected", "rejected"]);
      } else if (
        scenario === "unknown-result" ||
        scenario === "malformed-result" ||
        scenario === "missing-mid" ||
        scenario === "unmatched-result"
      ) {
        expect(batches).toHaveLength(1);
        expect(calls).not.toContain("close");
        expect(result.subscribed).toEqual([]);
        expect(result.activeSession).toBeNull();
      } else if (scenario === "all-rejected") {
        expect(batches).toHaveLength(1);
        expect(result.activeSession).toBe("subscriber");
        expect(result.subscribed).toEqual([]);
        expect(calls).not.toContain("renegotiate");
      } else if (
        scenario === "publication-replaced" ||
        scenario === "own-old-publication"
      ) {
        expect(batches).toHaveLength(1);
        expect(batches[0]).toEqual([
          "microphone-2",
          "microphone-3",
          "microphone-4",
        ]);
        expect(result.subscribed).toHaveLength(3);
      } else if (scenario === "partial") {
        // Keep successful MID allocations; retry only the resource explicitly rejected.
        expect(batches[0]).toHaveLength(4);
        expect(batches[1]).toEqual(["microphone-2"]);
        expect(result.subscribed).toHaveLength(4);
        expect(calls.indexOf("close")).toBeGreaterThan(
          calls.indexOf("renegotiate"),
        );
      } else {
        expect(batches).toHaveLength(1);
        expect(batches[0]).toHaveLength(4);
        expect(result.subscribed).toHaveLength(4);
        if (scenario === "offer" || scenario === "no-location") {
          expect(calls.indexOf("close")).toBeGreaterThan(
            calls.indexOf("renegotiate"),
          );
          expect(result.descriptions).toEqual(["offer", "remove"]);
        } else {
          expect(calls).not.toContain("renegotiate");
          expect(result.descriptions).toEqual(["remove"]);
        }
      }
    });
  }

  test("retry budget survives repeated snapshots and a staggered explicit screen watch", async ({
    page,
  }) => {
    const attempts = new Map<string, number>();
    await page.route("**/api/cloudflare-realtime/**", async (route) => {
      if (route.request().url().endsWith("/subscribe")) {
        const body = route.request().postDataJSON() as {
          tracks: Array<{ publisherSessionId: string; trackName: string }>;
        };
        for (const track of body.tracks)
          attempts.set(
            track.trackName,
            (attempts.get(track.trackName) || 0) + 1,
          );
        await route.fulfill({
          json: {
            tracks: body.tracks.map((track) => ({
              location: "remote",
              sessionId: track.publisherSessionId,
              trackName: track.trackName,
              errorCode: "TRACK_NOT_FOUND",
            })),
          },
        });
      } else await route.fulfill({ json: { ok: true } });
    });
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const service = (
        window as unknown as { cloudflareRealtimeService: Harness }
      ).cloudflareRealtimeService;
      const pc = Object.assign(new EventTarget(), {
        connectionState: "connected",
        iceGatheringState: "complete",
        getConfiguration: () => ({ iceTransportPolicy: "all" }),
        close: () => undefined,
        getSenders: () => [],
        getReceivers: () => [],
      }) as unknown as RTCPeerConnection;
      service.pc = pc;
      service.sessionId = "subscriber";
      service.currentChannelId = "channel";
      const microphone: CfMediaPublication = {
        channelId: "channel",
        sessionId: "publisher-microphone",
        userId: "remote-user",
        trackName: "microphone-exhausted",
        kind: "audio",
        source: "microphone",
      };
      const screen: CfMediaPublication = {
        ...microphone,
        sessionId: "publisher-screen",
        trackName: "screen-staggered",
        kind: "video",
        source: "screen",
      };
      // Frequent Gateway snapshots do not bypass the pending retry or reset its budget.
      for (let index = 0; index < 70; index++) {
        await service.syncPublications([microphone]);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await service.syncPublications([microphone, screen]);
      // The user directly watches this screen; retries must retain that intention.
      await service.subscribeRemoteTrack(screen.sessionId, screen.trackName);
      for (let index = 0; index < 70; index++) {
        await service.syncPublications([microphone, screen]);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const activeSession = service.sessionId;
      await service.disconnect();
      return { activeSession };
    });
    expect(result.activeSession).toBe("subscriber");
    expect(attempts.get("microphone-exhausted")).toBe(5);
    expect(attempts.get("screen-staggered")).toBe(5);
  });
});

test.describe("SFU bounded initial transport rebuild", () => {
  let server: {
    listen(): Promise<void>;
    close(): Promise<void>;
    resolvedUrls?: { local: string[] };
  };
  let origin: string;
  test.beforeAll(async () => {
    const webRoot = path.resolve(process.cwd(), "apps/web");
    const webRequire = createRequire(path.join(webRoot, "package.json"));
    const { createServer } = await import(webRequire.resolve("vite"));
    server = await createServer({
      root: webRoot,
      server: { host: "127.0.0.1", port: 0, hmr: false },
    });
    await server.listen();
    origin = server.resolvedUrls!.local[0];
  });
  test.afterAll(async () => {
    await server?.close();
  });
  for (const scenario of [
    "fresh-session",
    "retry-exhausted",
    "external-disconnect",
    "account-switch",
    "encryption-disabled",
    "malformed",
    "connection-before-subscribe",
    "ice-timeout",
    "ice-failed",
    "late-failure-cleanup",
    "new-session-unknown",
    "new-session-exhausted",
    "new-session-malformed",
    "new-session-forbidden",
    "snapshot-race",
  ] as const) {
    test(`${scenario}: an uncertain allocation is never replayed`, async ({
      page,
    }) => {
      let sessions = 0;
      const subscriptionSessions: string[] = [];
      const subscriptionNames: string[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(`${origin}rebuild-harness`, (route) =>
        route.fulfill({ contentType: "text/html", body: "<html></html>" }),
      );
      await page.route("**/api/cloudflare-realtime/**", async (route) => {
        const endpoint = new URL(route.request().url()).pathname;
        if (endpoint.endsWith("/session/new")) {
          sessions++;
          if (
            scenario === "new-session-exhausted" ||
            (sessions === 1 && scenario === "new-session-unknown")
          ) {
            await route.fulfill({
              status: 502,
              json: { code: "MEDIA_CONTEXT_STALE" },
            });
            return;
          }
          if (scenario === "new-session-forbidden") {
            await route.fulfill({ status: 403, json: { code: "FORBIDDEN" } });
            return;
          }
          if (sessions === 1 && scenario === "new-session-malformed") {
            await route.fulfill({ json: { sessionId: null } });
            return;
          }
          if (scenario === "snapshot-race")
            await page.evaluate(() => {
              const gateway = (
                window as unknown as {
                  rebuildGateway: {
                    emit(event: string, payload: unknown): void;
                  };
                }
              ).rebuildGateway;
              gateway.emit("CF_MEDIA_TRACKS", {
                channelId: "channel",
                revision: 7,
                tracks: [
                  {
                    channelId: "channel",
                    sessionId: "remote-publisher",
                    userId: "remote-user",
                    trackName: "microphone-new",
                    kind: "audio",
                    source: "microphone",
                  },
                ],
              });
              gateway.emit("CF_MEDIA_TRACKS", {
                channelId: "channel",
                revision: 6,
                tracks: [],
              });
            });
          await route.fulfill({
            json: {
              sessionId: `subscriber-${sessions}`,
              requiresE2EE: true,
              tracksRevision: 5,
              tracks: [
                {
                  channelId: "channel",
                  sessionId: "remote-publisher",
                  userId: "remote-user",
                  trackName: "microphone-remote",
                  kind: "audio",
                  source: "microphone",
                },
              ],
            },
          });
        } else if (endpoint.endsWith("/subscribe")) {
          const body = route.request().postDataJSON() as {
            sessionId: string;
            tracks: Array<{ publisherSessionId: string; trackName: string }>;
          };
          subscriptionSessions.push(body.sessionId);
          subscriptionNames.push(
            ...body.tracks.map((track) => track.trackName),
          );
          if (
            (subscriptionSessions.length === 1 &&
              scenario !== "connection-before-subscribe" &&
              scenario !== "ice-timeout" &&
              scenario !== "ice-failed" &&
              scenario !== "late-failure-cleanup" &&
              scenario !== "new-session-unknown" &&
              scenario !== "new-session-malformed" &&
              scenario !== "snapshot-race") ||
            scenario === "retry-exhausted"
          ) {
            await route.fulfill(
              scenario === "malformed"
                ? { json: { tracks: [{ trackName: "microphone-remote" }] } }
                : { status: 502, json: { code: "MEDIA_CONTEXT_STALE" } },
            );
          } else
            await route.fulfill({
              json: {
                tracks: body.tracks.map((track, index) => ({
                  location: "remote",
                  sessionId: track.publisherSessionId,
                  trackName: track.trackName,
                  mid: String(index),
                })),
              },
            });
        } else if (endpoint.endsWith("/session/leave")) {
          // Leave the retirement cleanup pending while the user invalidates the join.
          if (sessions === 1)
            await page.evaluate(async (scenario) => {
              const state = window as unknown as {
                rebuildService: Harness;
                rebuildAuth: {
                  setState(state: { user: { id: string } }): void;
                };
                rebuildCipher: { disable(): void };
              };
              if (scenario === "external-disconnect")
                await state.rebuildService.disconnect();
              if (scenario === "account-switch")
                state.rebuildAuth.setState({ user: { id: "another-user" } });
              if (scenario === "encryption-disabled")
                state.rebuildCipher.disable();
            }, scenario);
          await route.fulfill({ json: { ok: true } });
        } else await route.fulfill({ json: { ok: true } });
      });
      await page.goto(`${origin}rebuild-harness`);
      const outcome = await page.evaluate(async (scenario) => {
        const { cloudflareRealtimeService: service } =
          await import("/src/services/cloudflare_realtime/CloudflareRealtimeService.ts");
        const { sframeManager } = await import("/src/services/sframe.ts");
        const { useAuthStore } = await import("/src/stores/useAuthStore.ts");
        const { gatewayClient } = await import("/src/services/gateway.ts");
        const state = window as unknown as Record<string, unknown>;
        state.rebuildService = service;
        state.rebuildAuth = useAuthStore;
        state.rebuildCipher = sframeManager;
        state.rebuildGateway = gatewayClient;
        useAuthStore.setState({ user: { id: "joining-user" } });
        // State-machine isolation. Real signed-device/RTP tests run separately.
        sframeManager.beginContext(async (streamId) => ({
          streamId,
          keyId: 1,
          key: crypto.getRandomValues(new Uint8Array(32)),
        }));
        let peers = 0;
        window.RTCPeerConnection = class extends EventTarget {
          connectionState = "connected";
          iceGatheringState = "complete";
          constructor() {
            super();
            peers++;
          }
          close() {
            this.connectionState = "closed";
          }
          getSenders() {
            return [];
          }
          getReceivers() {
            return [];
          }
        } as unknown as typeof RTCPeerConnection;
        let capture: AudioContext | undefined;
        let audioStream: MediaStream | undefined;
        let connectionWaited = false;
        if (
          scenario === "connection-before-subscribe" ||
          scenario === "ice-timeout" ||
          scenario === "ice-failed"
        ) {
          capture = new AudioContext();
          audioStream = capture.createMediaStreamDestination().stream;
          const control = service as unknown as {
            createMediaSession(): Promise<string>;
            publishMicrophoneStream(stream: MediaStream): Promise<boolean>;
            waitForConnected(pc: RTCPeerConnection): Promise<void>;
            subscribedTracks: Set<string>;
          };
          // Even a completed publication SDP cannot bypass Cloudflare's connection gate.
          control.publishMicrophoneStream = async () => {
            await control.createMediaSession();
            const pc = (service as unknown as Harness).pc!;
            if (scenario === "connection-before-subscribe" || peers === 1)
              Object.assign(pc, {
                connectionState:
                  scenario === "ice-failed" ? "failed" : "connecting",
              });
            if (scenario === "ice-failed" && peers === 1)
              pc.onconnectionstatechange?.call(
                pc,
                new Event("connectionstatechange"),
              );
            gatewayClient.emit("CF_MEDIA_TRACKS", {
              channelId: "channel",
              revision: 6,
              tracks: [
                {
                  channelId: "channel",
                  sessionId: "remote-publisher",
                  userId: "remote-user",
                  trackName: "microphone-remote",
                  kind: "audio",
                  source: "microphone",
                },
              ],
            });
            return true;
          };
          if (scenario === "connection-before-subscribe")
            control.waitForConnected = async (pc) => {
              await new Promise((resolve) => setTimeout(resolve, 20));
              if (control.subscribedTracks.size)
                throw new Error(
                  "Subscription mutated the session before connection setup finished",
                );
              Object.assign(pc, { connectionState: "connected" });
              connectionWaited = true;
            };
        }
        const result = await service
          .connect("channel", {
            iceServers: [{ urls: "stun:example.invalid" }],
            audioStream,
          })
          .then(
            (sessionId: string) => ({ sessionId, error: null }),
            (error: Error) => ({ sessionId: null, error: error.message }),
          );
        let lateCleanupPreserved = false;
        if (scenario === "late-failure-cleanup") {
          const originalDisconnect = service.disconnect.bind(service);
          let releaseCleanup!: () => void;
          const cleanupGate = new Promise<void>((resolve) => {
            releaseCleanup = resolve;
          });
          let hold = true;
          service.disconnect = async (stopLocalAudio = true) => {
            const pending = originalDisconnect(stopLocalAudio);
            if (hold) {
              hold = false;
              await pending;
              await cleanupGate;
            } else await pending;
          };
          const firstPc = (service as unknown as Harness).pc!;
          Object.assign(firstPc, { connectionState: "failed" });
          firstPc.onconnectionstatechange?.call(
            firstPc,
            new Event("connectionstatechange"),
          );
          const replacement = await service.connect("channel", {
            iceServers: [{ urls: "stun:example.invalid" }],
          });
          const replacementStatus = service.status;
          releaseCleanup();
          await new Promise((resolve) => setTimeout(resolve, 20));
          lateCleanupPreserved =
            replacement === "subscriber-2" &&
            service.status === replacementStatus &&
            service.status !== "failed";
          service.disconnect = originalDisconnect;
        }
        const status = service.status;
        if (scenario === "snapshot-race") {
          gatewayClient.emit("CF_MEDIA_TRACKS", {
            channelId: "channel",
            revision: 6,
            tracks: [],
          });
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const publications = [
          ...(service as unknown as Harness).currentPublications.keys(),
        ];
        await service.disconnect();
        sframeManager.disable();
        await capture?.close();
        return {
          ...result,
          peers,
          status,
          publications,
          connectionWaited,
          lateCleanupPreserved,
        };
      }, scenario);
      expect(errors).toEqual([]);
      if (scenario === "fresh-session") {
        expect(sessions).toBe(2);
        expect(subscriptionSessions).toEqual(["subscriber-1", "subscriber-2"]);
        expect(outcome.sessionId).toBe("subscriber-2");
        expect(outcome.peers).toBe(2);
      } else if (scenario === "snapshot-race") {
        expect(sessions).toBe(1);
        expect(subscriptionNames).toEqual(["microphone-new"]);
        expect(outcome.sessionId).toBe("subscriber-1");
        expect(outcome.publications).toEqual([
          "remote-publisher:microphone-new",
        ]);
      } else if (scenario === "connection-before-subscribe") {
        expect(sessions).toBe(1);
        expect(subscriptionSessions).toEqual(["subscriber-1"]);
        expect(outcome.sessionId).toBe("subscriber-1");
        expect(outcome.connectionWaited).toBe(true);
      } else if (scenario === "ice-timeout" || scenario === "ice-failed") {
        expect(sessions).toBe(2);
        expect(subscriptionSessions).toEqual(["subscriber-2"]);
        expect(outcome.sessionId).toBe("subscriber-2");
        expect(outcome.peers).toBe(2);
      } else if (scenario === "late-failure-cleanup") {
        expect(sessions).toBe(2);
        expect(subscriptionSessions).toEqual(["subscriber-1", "subscriber-2"]);
        expect(outcome.peers).toBe(2);
        expect(outcome.lateCleanupPreserved).toBe(true);
      } else if (
        scenario === "new-session-unknown" ||
        scenario === "new-session-malformed"
      ) {
        expect(sessions).toBe(2);
        expect(subscriptionSessions).toEqual(["subscriber-2"]);
        expect(outcome.peers).toBe(2);
        expect(outcome.sessionId).toBe("subscriber-2");
      } else if (
        scenario === "new-session-exhausted" ||
        scenario === "new-session-forbidden"
      ) {
        expect(sessions).toBe(scenario === "new-session-exhausted" ? 2 : 1);
        expect(subscriptionSessions).toEqual([]);
        expect(outcome.error).toBeTruthy();
        expect(outcome.status).toBe("failed");
      } else if (scenario === "retry-exhausted") {
        expect(sessions).toBe(2);
        expect(subscriptionSessions).toEqual(["subscriber-1", "subscriber-2"]);
        expect(outcome.error).toBeTruthy();
        expect(outcome.status).toBe("failed");
      } else {
        expect(sessions).toBe(1);
        expect(subscriptionSessions).toEqual(["subscriber-1"]);
        expect(outcome.error).toBeTruthy();
      }
    });
  }
});

test.describe("SFU encrypted packet readiness", () => {
  let server: { close(): Promise<void> };
  let origin: string;
  test.beforeAll(async () => {
    const webRoot = path.resolve(process.cwd(), "apps/web");
    const webRequire = createRequire(path.join(webRoot, "package.json"));
    const { createServer } = await import(webRequire.resolve("vite"));
    const instance = await createServer({
      root: webRoot,
      server: { host: "127.0.0.1", port: 0, hmr: false },
    });
    server = instance;
    await instance.listen();
    origin = instance.resolvedUrls!.local[0];
  });
  test.afterAll(async () => {
    await server?.close();
  });
  for (const scenario of [
    "ack-and-rtp",
    "old-scope",
    "rotation",
    "pending-publication",
    "unpublish-pending",
    "replace-announced-camera",
  ] as const) {
    test(`${scenario}: advertise only current encrypted sender packets without blocking subscriptions`, async ({
      page,
    }) => {
      const readyRequests: string[] = [];
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route(`${origin}packet-ready-harness`, (route) =>
        route.fulfill({ contentType: "text/html", body: "<html></html>" }),
      );
      await page.route("**/api/cloudflare-realtime/**", async (route) => {
        if (route.request().url().endsWith("/ready"))
          readyRequests.push(route.request().postDataJSON().sessionId);
        if (route.request().url().endsWith("/subscribe")) {
          await route.fulfill({
            json: {
              tracks: [
                {
                  location: "remote",
                  sessionId: "remote",
                  trackName: "remote-mic",
                  mid: "3",
                },
              ],
            },
          });
        } else await route.fulfill({ json: { ok: true } });
      });
      await page.goto(`${origin}packet-ready-harness`);
      const result = await page.evaluate(async (scenario) => {
        // apiClient binds fetch at module evaluation; install the observation
        // before importing the service so early announcements are observable.
        const events: string[] = [];
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          if (String(input).endsWith("/ready")) events.push("ready");
          return originalFetch(input, init);
        };
        const { cloudflareRealtimeService: service } =
          await import("/src/services/cloudflare_realtime/CloudflareRealtimeService.ts");
        const { sframeManager } = await import("/src/services/sframe.ts");
        type Publication = {
          sender: RTCRtpSender;
          stream: MediaStream;
          mid: string;
          trackName: string;
          rtpBaseline: { bytes: number; packets: number };
          keyGeneration: number;
        };
        const control = service as unknown as {
          pc: RTCPeerConnection;
          sessionId: string;
          currentChannelId: string;
          publishedTracks: Map<string, Publication>;
          mediaOperationEpoch: number;
          scheduleTrackAnnouncement(): Promise<boolean>;
          syncPublications(tracks: CfMediaPublication[]): Promise<void>;
          subscribedTracks: Set<string>;
          announcedTracks: Set<string>;
          queue(task: () => Promise<void>): Promise<void>;
        };
        const delay = () => new Promise((resolve) => setTimeout(resolve, 150));
        const micState = {
          generation: 1,
          keyId: null as number | null,
          ready: false,
        };
        const cameraState = {
          generation: 1,
          keyId: null as number | null,
          ready: false,
        };
        let micBytes = 0,
          cameraBytes = 0;
        const sampledGenerations: number[] = [];
        const makeSender = (camera = false) =>
          ({
            track: {
              readyState: "live",
              kind: camera ? "video" : "audio",
              stop: () => undefined,
            },
            getStats: async () => {
              if (!camera) sampledGenerations.push(micState.generation);
              return new Map([
                [
                  "outbound",
                  {
                    type: "outbound-rtp",
                    bytesSent: camera ? cameraBytes : micBytes,
                    packetsSent: camera ? cameraBytes : micBytes,
                  },
                ],
              ]);
            },
          }) as unknown as RTCRtpSender;
        const mic = makeSender(),
          camera = makeSender(true);
        const owned = [mic];
        control.pc = Object.assign(new EventTarget(), {
          connectionState: "connected",
          close: () => undefined,
          getSenders: () => owned,
          getReceivers: () => [],
          removeTrack: (sender: RTCRtpSender) => {
            const index = owned.indexOf(sender);
            if (index >= 0) owned.splice(index, 1);
          },
        }) as unknown as RTCPeerConnection;
        control.sessionId = "current-session";
        control.currentChannelId = "channel";
        const publication = (
          sender: RTCRtpSender,
          name: string,
        ): Publication => ({
          sender,
          stream: new MediaStream(),
          mid: name,
          trackName: name,
          rtpBaseline: { bytes: 0, packets: 0 },
          keyGeneration: 1,
        });
        control.publishedTracks.set(
          "microphone",
          publication(mic, "current-mic"),
        );
        if (
          scenario === "unpublish-pending" ||
          scenario === "replace-announced-camera"
        ) {
          owned.push(camera);
          control.publishedTracks.set(
            "camera",
            publication(camera, "current-camera"),
          );
          if (scenario === "replace-announced-camera")
            control.announcedTracks.add("current-camera");
        }
        sframeManager.beginContext(async (streamId) => ({
          streamId,
          keyId: 1,
          key: new Uint8Array(32),
        }));
        // These are scheduling fixtures; signed key negotiation and RTP run separately.
        const originalReadiness =
          sframeManager.getSenderKeyReadiness.bind(sframeManager);
        sframeManager.getSenderKeyReadiness = (sender) => ({
          ...(sender === mic ? micState : cameraState),
        });
        let release!: () => void;
        let blocker: Promise<void> | undefined;
        if (scenario === "pending-publication") {
          let entered!: () => void;
          const started = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          blocker = control.queue(async () => {
            entered();
            await gate;
          });
          await started;
          micState.ready = true;
          micState.keyId = 1;
          micBytes = 10;
        }
        const announcement = control.scheduleTrackAnnouncement();
        const checks: boolean[] = [];
        if (
          scenario === "unpublish-pending" ||
          scenario === "replace-announced-camera"
        ) {
          await delay();
          checks.push(!events.includes("ready"));
          if (scenario === "unpublish-pending")
            await service.unpublishSource("camera");
          else {
            const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
            const track = document
              .createElement("canvas")
              .captureStream()
              .getVideoTracks()[0];
            navigator.mediaDevices.getUserMedia = async () =>
              new MediaStream([track]);
            Object.assign(camera, {
              replaceTrack: async (replacement: MediaStreamTrack) => {
                Object.assign(camera, { track: replacement });
              },
            });
            try {
              checks.push(await service.switchCameraDevice("default"));
            } finally {
              navigator.mediaDevices.getUserMedia = originalGetUserMedia;
            }
          }
          checks.push(!events.includes("ready"));
          micState.ready = true;
          micState.keyId = 1;
          micBytes = 10;
          await control.scheduleTrackAnnouncement();
        } else if (scenario === "pending-publication") {
          await delay();
          checks.push(!events.includes("ready"));
          owned.push(camera);
          control.publishedTracks.set(
            "camera",
            publication(camera, "current-camera"),
          );
          const replacement = control.scheduleTrackAnnouncement();
          release();
          await blocker;
          await delay();
          checks.push(!events.includes("ready"));
          cameraState.ready = true;
          cameraState.keyId = 2;
          cameraBytes = 10;
          await replacement;
        } else {
          await control.syncPublications([
            {
              channelId: "channel",
              sessionId: "remote",
              userId: "remote-user",
              trackName: "remote-mic",
              kind: "audio",
              source: "microphone",
            },
          ]);
          checks.push(
            control.subscribedTracks.has("remote:remote-mic"),
            !events.includes("ready"),
          );
          micState.ready = true;
          micState.keyId = 1;
          await delay();
          checks.push(!events.includes("ready"));
          if (scenario === "old-scope") {
            control.mediaOperationEpoch++;
            micBytes = 10;
          } else if (scenario === "rotation") {
            micState.generation = 2;
            micState.keyId = 2;
            micBytes = 100;
            for (
              let attempt = 0;
              attempt < 50 && !sampledGenerations.includes(2);
              attempt++
            )
              await new Promise((resolve) => setTimeout(resolve, 20));
            checks.push(sampledGenerations.includes(2));
            checks.push(!events.includes("ready"));
            micBytes = 101;
          } else micBytes = 10;
        }
        const announced = await announcement;
        if (scenario !== "old-scope") await control.scheduleTrackAnnouncement();
        await service.disconnect();
        sframeManager.getSenderKeyReadiness = originalReadiness;
        sframeManager.disable();
        return { checks, announced, events };
      }, scenario);
      expect(pageErrors).toEqual([]);
      expect(result.checks.every(Boolean)).toBe(true);
      expect(readyRequests).toEqual(
        scenario === "old-scope" ? [] : ["current-session"],
      );
      expect(result.events.filter((event) => event === "ready")).toHaveLength(
        scenario === "old-scope" ? 0 : 1,
      );
      if (
        scenario === "old-scope" ||
        scenario === "pending-publication" ||
        scenario === "unpublish-pending" ||
        scenario === "replace-announced-camera"
      )
        expect(result.announced).toBe(false);
      else expect(result.announced).toBe(true);
    });
  }
});
