import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type TestInfo,
} from "@playwright/test";
import { CURRENT_APP_VERSION } from "../../apps/web/src/data/changelogs";
import { writeFile } from "node:fs/promises";
import type { MediaJoinTimingTrace, MediaTransformEvent } from "@tescord/types";

type PipelineCounters = Omit<
  Extract<MediaTransformEvent, { type: "stats" }>,
  "type"
>;

export type MultiplayerMode = "p2p_mesh" | "cloudflare_sfu";
type Mode = MultiplayerMode;
interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string };
}
export interface MultiplayerEndpoint {
  page: Page;
  context: BrowserContext;
  session: Session;
  joinedAt?: number;
  playableAt?: number;
  firstPlayableAt?: number;
  readyAt?: number;
}
type Endpoint = MultiplayerEndpoint;
interface Rtp {
  id: string;
  sent: number;
  received: number;
  encrypted: number;
  decrypted: number;
  codec: string;
  rms: number;
  pair: { local: string; remote: string } | null;
  connected: boolean;
}
export interface MediaProof {
  phase: string | null;
  encrypted: number;
  decrypted: number;
  peers: Rtp[];
  timing: MediaJoinTimingTrace | null;
  uplink: {
    sent: number;
    encrypted: number;
    codec: string;
    connected: boolean;
    pair: Rtp["pair"];
  } | null;
  publicationSnapshot: { latest: string[] | null; initial: string[] } | null;
}

export async function multiplayerProof(
  page: Page,
  mode: Mode,
): Promise<MediaProof> {
  return page.evaluate(async (transport) => {
    interface Service {
      pc: RTCPeerConnection | null;
      audioRoutes: Map<
        string,
        {
          track: MediaStreamTrack;
          analyser?: AnalyserNode;
          publication?: { userId: string };
        }
      >;
      getJoinTimingTrace?(): MediaJoinTimingTrace | null;
      latestPublications?: { userId: string }[] | null;
      initialPublications?: { userId: string }[];
    }
    interface Mesh {
      peerConnections: Map<string, RTCPeerConnection>;
      participantAudioMap: Map<string, { analyserNode?: AnalyserNode }>;
    }
    const global = window as unknown as {
      voiceMeshManager: Mesh;
      cloudflareRealtimeService: Service;
      readMediaPipelineCounters?(transform: unknown): PipelineCounters | null;
    };
    const counters = (owner: RTCRtpSender | RTCRtpReceiver | undefined) =>
      global.readMediaPipelineCounters?.(
        (owner as unknown as { transform?: unknown } | undefined)?.transform,
      );
    const indicator = document.querySelector(
      '[data-testid="media-encryption-state"]',
    );
    const rows: Rtp[] = [];
    let uplink: MediaProof["uplink"] = null;
    const read = async (
      pc: RTCPeerConnection,
      id: string,
      analyser?: AnalyserNode,
      trackId?: string,
    ) => {
      const report = await pc.getStats();
      let sent = 0,
        received = 0,
        codec = "";
      let pair: Rtp["pair"] = null;
      const inbound = [...report.values()].filter(
        (item) =>
          item.type === "inbound-rtp" &&
          (item.kind || item.mediaType) === "audio",
      );
      const receiver = pc
        .getTransceivers()
        .find((item) =>
          trackId
            ? item.receiver.track.id === trackId
            : item.receiver.track.kind === "audio",
        );
      const sender = pc
        .getSenders()
        .find((item) => item.track?.kind === "audio");
      for (const item of report.values()) {
        if (
          item.type === "outbound-rtp" &&
          (item.kind || item.mediaType) === "audio"
        )
          sent += item.bytesSent || 0;
        if (item.type === "transport" && item.selectedCandidatePairId) {
          const selected = report.get(item.selectedCandidatePairId);
          if (selected?.state === "succeeded")
            pair = {
              local: report.get(selected.localCandidateId)?.candidateType || "",
              remote:
                report.get(selected.remoteCandidateId)?.candidateType || "",
            };
        }
      }
      const matched = trackId
        ? inbound.filter(
            (item) =>
              item.trackIdentifier === trackId ||
              (typeof receiver?.mid === "string" && item.mid === receiver.mid),
          )
        : inbound;
      for (const item of matched) {
        received += item.bytesReceived || 0;
        codec = report.get(item.codecId)?.mimeType || "";
      }
      let rms = 0;
      if (analyser) {
        const pcm = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(pcm);
        rms = Math.sqrt(
          pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length,
        );
      }
      rows.push({
        id,
        sent,
        received,
        encrypted: counters(sender)?.encrypted || 0,
        decrypted: counters(receiver?.receiver)?.decrypted || 0,
        codec,
        rms,
        pair,
        connected: pc.connectionState === "connected",
      });
    };
    if (transport === "p2p_mesh") {
      for (const [id, pc] of global.voiceMeshManager.peerConnections)
        await read(
          pc,
          id,
          global.voiceMeshManager.participantAudioMap.get(id)?.analyserNode,
        );
    } else {
      const service = global.cloudflareRealtimeService;
      if (service.pc) {
        const report = await service.pc.getStats();
        const outbound = [...report.values()].filter(
          (item) =>
            item.type === "outbound-rtp" &&
            (item.kind || item.mediaType) === "audio",
        );
        const transport = [...report.values()].find(
          (item) => item.type === "transport" && item.selectedCandidatePairId,
        );
        const selected = transport
          ? report.get(transport.selectedCandidatePairId)
          : undefined;
        uplink = {
          encrypted:
            counters(
              service.pc
                .getSenders()
                .find((item) => item.track?.kind === "audio"),
            )?.encrypted || 0,
          sent: outbound.reduce(
            (total, item) => total + (item.bytesSent || 0),
            0,
          ),
          codec: outbound.length
            ? report.get(outbound[0].codecId)?.mimeType || ""
            : "",
          connected: service.pc.connectionState === "connected",
          pair:
            selected?.state === "succeeded"
              ? {
                  local:
                    report.get(selected.localCandidateId)?.candidateType || "",
                  remote:
                    report.get(selected.remoteCandidateId)?.candidateType || "",
                }
              : null,
        };
        for (const route of service.audioRoutes.values())
          if (route.publication?.userId)
            await read(
              service.pc,
              route.publication.userId,
              route.analyser,
              route.track.id,
            );
      }
    }
    return {
      phase: indicator?.getAttribute("data-phase") || null,
      encrypted: Number(indicator?.getAttribute("data-encrypted-frames") || 0),
      decrypted: Number(indicator?.getAttribute("data-decrypted-frames") || 0),
      peers: rows,
      timing:
        transport === "cloudflare_sfu"
          ? global.cloudflareRealtimeService.getJoinTimingTrace?.() || null
          : null,
      uplink,
      publicationSnapshot:
        transport === "cloudflare_sfu"
          ? {
              latest:
                global.cloudflareRealtimeService.latestPublications?.map(
                  (track) => track.userId,
                ) ?? null,
              initial:
                global.cloudflareRealtimeService.initialPublications?.map(
                  (track) => track.userId,
                ) ?? [],
            }
          : null,
    };
  }, mode);
}

export async function createMultiplayerRoom(
  browser: Browser,
  request: APIRequestContext,
  info: TestInfo,
  count: number,
  mode: Mode,
  relay = false,
  beforeNavigate?: (page: Page, index: number) => Promise<void>,
) {
  const marker = `${Date.now().toString(36)}_${info.workerIndex}_${Math.random().toString(36).slice(2, 7)}`;
  const name = `Encrypted matrix ${marker}`;
  const sessions: Session[] = [];
  const endpoints: Endpoint[] = [];
  const errors: string[] = [];
  const events: unknown[] = [];
  const auth = (session: Session) => ({
    Authorization: `Bearer ${session.accessToken}`,
  });
  for (let index = 0; index < count; index++) {
    const response = await request.post("/api/auth/register", {
      data: {
        username: `multi_${marker}_${index}`,
        email: `multi_${marker}_${index}@example.invalid`,
        password: "EncryptedMatrixRegression123",
      },
    });
    expect(response.ok(), `register ${response.status()}`).toBeTruthy();
    sessions.push(await response.json());
  }
  const create = await request.post("/api/guilds", {
    headers: auth(sessions[0]),
    data: { name },
  });
  expect(create.ok()).toBeTruthy();
  const guild = (await create.json()) as { id: string };
  const channelResponse = await request.post(
    `/api/guilds/${guild.id}/channels`,
    {
      headers: auth(sessions[0]),
      data: {
        name: `matrix-${marker}`,
        type: "VOICE",
        voiceMode: mode === "p2p_mesh" ? "p2p_mesh" : "sfu",
      },
    },
  );
  expect(channelResponse.ok()).toBeTruthy();
  const channel = (await channelResponse.json()) as { id: string };
  for (const session of sessions.slice(1)) {
    const invitation = await request.post(`/api/guilds/${guild.id}/invites`, {
      headers: auth(sessions[0]),
      data: { maxUses: 1, maxAge: 3600, forceNew: true },
    });
    expect(invitation.ok()).toBeTruthy();
    const { code } = (await invitation.json()) as { code: string };
    expect(
      (
        await request.post(`/api/invites/${code}/join`, {
          headers: auth(session),
        })
      ).ok(),
    ).toBeTruthy();
  }
  const makeEndpoint = async (session: Session): Promise<Endpoint> => {
    const context = await browser.newContext({
      baseURL: String(info.project.use.baseURL || "https://localhost:4173"),
      ignoreHTTPSErrors: true,
      permissions: ["microphone"],
      locale: "zh-CN",
    });
    await context.tracing.start({
      // Media is verified from RTP and decoded PCM; snapshots and network
      // traces preserve the UI evidence without recording every audio poll.
      screenshots: false,
      snapshots: true,
      sources: true,
    });
    await context.addInitScript(
      ({ session, version, relay, mode }) => {
        // Passively observe the production Worker's real statistics. Keep the
        // original native transform, options and Worker message handler intact.
        const pipelines = new WeakMap<object, PipelineCounters>();
        Object.defineProperty(window, "readMediaPipelineCounters", {
          value: (transform: unknown): PipelineCounters | null => {
            if (!transform || typeof transform !== "object") return null;
            const value = pipelines.get(transform);
            return value ? { ...value } : null;
          },
        });
        const NativeTransform = (
          window as unknown as {
            RTCRtpScriptTransform?: new (
              worker: Worker,
              options?: unknown,
              transfer?: Transferable[],
            ) => object;
          }
        ).RTCRtpScriptTransform;
        if (NativeTransform) {
          class ObservedTransform extends NativeTransform {
            constructor(
              worker: Worker,
              options?: unknown,
              transfer?: Transferable[],
            ) {
              super(worker, options, transfer);
              const value: PipelineCounters = {
                encrypted: 0,
                decrypted: 0,
                replay: 0,
              };
              pipelines.set(this, value);
              worker.addEventListener(
                "message",
                (event: MessageEvent<MediaTransformEvent>) => {
                  const message = event.data;
                  if (!message || message.type !== "stats") return;
                  if (
                    ![
                      message.encrypted,
                      message.decrypted,
                      message.replay,
                    ].every(
                      (count) => Number.isSafeInteger(count) && count >= 0,
                    )
                  )
                    return;
                  value.encrypted += message.encrypted;
                  value.decrypted += message.decrypted;
                  value.replay += message.replay;
                },
              );
            }
          }
          Object.defineProperty(window, "RTCRtpScriptTransform", {
            value: ObservedTransform,
            configurable: true,
            writable: true,
          });
        }
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const gate = (
            window as unknown as {
              publicationGate?: { entered: boolean; pending: Promise<void> };
            }
          ).publicationGate;
          const url = input instanceof Request ? input.url : String(input);
          if (
            gate &&
            !gate.entered &&
            url.endsWith("/media-encryption/publish")
          ) {
            gate.entered = true;
            await gate.pending;
          }
          return originalFetch(input, init);
        };
        localStorage.setItem("tescord_access_token", session.accessToken);
        localStorage.setItem("tescord_refresh_token", session.refreshToken);
        localStorage.setItem("tescord_last_seen_changelog_version", version);
        const native = navigator.mediaDevices.getUserMedia.bind(
          navigator.mediaDevices,
        );
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          if (!constraints?.audio || constraints.video)
            return native(constraints);
          const context = new AudioContext(),
            tone = context.createOscillator(),
            gain = context.createGain(),
            destination = context.createMediaStreamDestination();
          tone.frequency.value = 440;
          gain.gain.value = 0.05;
          tone.connect(gain).connect(destination);
          tone.start();
          await context.resume();
          const track = destination.stream.getAudioTracks()[0],
            stop = track.stop.bind(track);
          track.stop = () => {
            stop();
            tone.stop();
            void context.close();
          };
          return destination.stream;
        };
        if (relay) {
          const Native = RTCPeerConnection;
          window.RTCPeerConnection = class extends Native {
            constructor(configuration?: RTCConfiguration) {
              super({ ...configuration, iceTransportPolicy: "relay" });
            }
          };
        }
        localStorage.setItem("multiplayer-acceptance-transport", mode);
      },
      { session, version: CURRENT_APP_VERSION, relay, mode },
    );
    const page = await context.newPage();
    const endpoint = { page, context, session };
    endpoints.push(endpoint);
    const requestStarts = new Map<Request, number>();
    const isMediaRequest = (url: string) =>
      /media-encryption|cloudflare-realtime/.test(url);
    page.on("request", (request) => {
      if (isMediaRequest(request.url())) requestStarts.set(request, Date.now());
    });
    page.on("requestfailed", (request) => {
      if (!isMediaRequest(request.url())) return;
      const startedAt = requestStarts.get(request);
      requestStarts.delete(request);
      events.push({
        userId: session.user.id,
        path: new URL(request.url()).pathname,
        failure: request.failure()?.errorText,
        durationMs: startedAt ? Date.now() - startedAt : undefined,
        at: Date.now(),
      });
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        const expectedStaleResponse =
          message.text().includes("409") &&
          message.location().url.includes("media-encryption");
        if (!expectedStaleResponse) errors.push(message.text());
      }
      if (/media|SFrame|Cloudflare|VoiceMesh/.test(message.text()))
        events.push({
          userId: session.user.id,
          type: message.type(),
          text: message.text(),
          at: Date.now(),
        });
    });
    page.on("response", async (response) => {
      const startedAt = requestStarts.get(response.request());
      requestStarts.delete(response.request());
      if (/media-encryption|cloudflare-realtime/.test(response.url()))
        events.push({
          userId: session.user.id,
          path: new URL(response.url()).pathname,
          status: response.status(),
          durationMs: startedAt ? Date.now() - startedAt : undefined,
          at: Date.now(),
        });
      if (
        /cloudflare-realtime\/tracks\/(publish|subscribe|renegotiate|unsubscribe)$/.test(
          new URL(response.url()).pathname,
        ) ||
        (response.status() >= 400 &&
          /media-encryption|cloudflare-realtime/.test(response.url()))
      ) {
        const body: unknown = await response.json().catch(() => null);
        if (body && typeof body === "object") {
          const record = body as Record<string, unknown>;
          const tracks = Array.isArray(record.tracks)
            ? record.tracks.map((value: unknown) => {
                if (!value || typeof value !== "object") return null;
                const track = value as Record<string, unknown>;
                return {
                  mid: typeof track.mid === "string" ? track.mid : null,
                  errorCode:
                    typeof track.errorCode === "string"
                      ? track.errorCode
                      : null,
                };
              })
            : undefined;
          const description =
            record.sessionDescription &&
            typeof record.sessionDescription === "object"
              ? (record.sessionDescription as Record<string, unknown>)
              : null;
          events.push({
            userId: session.user.id,
            path: new URL(response.url()).pathname,
            responseCode:
              typeof record.code === "string" ? record.code : undefined,
            tracks,
            descriptionType:
              typeof description?.type === "string"
                ? description.type
                : undefined,
            requiresImmediateRenegotiation:
              record.requiresImmediateRenegotiation === true,
            at: Date.now(),
          });
        }
      }
    });
    if (beforeNavigate) await beforeNavigate(page, endpoints.length - 1);
    await page.goto("/");
    await page.getByRole("button", { name, exact: true }).click();
    await page.evaluate((mode) => {
      const store = (
        window as unknown as {
          useSettingsStore: {
            getState(): {
              setAudioConfig(config: unknown): void;
              setVoiceTransmissionMode(mode: string): void;
            };
          };
        }
      ).useSettingsStore.getState();
      store.setAudioConfig({
        noiseSuppressionMode: "off",
        noiseSuppression: false,
        vadSensitivity: 0,
        autoGainControl: false,
      });
      store.setVoiceTransmissionMode(
        mode === "p2p_mesh" ? "p2p_mesh" : "cloudflare_realtime",
      );
    }, mode);
    return endpoint;
  };
  try {
    for (const session of sessions) await makeEndpoint(session);
  } catch (error) {
    for (const endpoint of endpoints) await endpoint.context.close();
    throw error;
  }

  const join = async (endpoint: Endpoint) => {
    endpoint.joinedAt = Date.now();
    endpoint.playableAt = undefined;
    endpoint.firstPlayableAt = undefined;
    events.push({
      action: "join",
      userId: endpoint.session.user.id,
      at: endpoint.joinedAt,
    });
    await endpoint.page
      .locator(`button[data-channel-id="${channel.id}"]`)
      .first()
      .dblclick();
  };
  const firstReady = async (endpoint: Endpoint) => {
    await expect(
      endpoint.page.getByTestId("media-encryption-state").first(),
    ).toHaveAttribute("data-phase", /ready|active/, { timeout: 20000 });
    await expect(
      endpoint.page
        .getByRole("button", { name: "断开连接", exact: true })
        .first(),
    ).toBeVisible({ timeout: 20000 });
    if (mode === "cloudflare_sfu") {
      await expect
        .poll(
          async () => {
            const proof = await multiplayerProof(endpoint.page, mode);
            return Boolean(
              proof.encrypted > 0 &&
              proof.uplink?.connected &&
              proof.uplink.encrypted > 0 &&
              proof.uplink.sent > 0 &&
              proof.uplink.codec.toLowerCase() === "audio/opus" &&
              proof.uplink.pair &&
              (!relay || proof.uplink.pair.local === "relay"),
            );
          },
          { timeout: 20000, intervals: [100, 200, 400] },
        )
        .toBe(true);
    }
    // Empty-room readiness is reported separately from first received audio.
    endpoint.readyAt = Date.now();
    events.push({
      userId: endpoint.session.user.id,
      emptyRoomReadyMs: Date.now() - endpoint.joinedAt!,
      at: Date.now(),
    });
  };
  const waitForMedia = async (active: Endpoint[]) => {
    await Promise.all(
      active.map(async (endpoint) => {
        const expected = active
          .filter((peer) => peer !== endpoint)
          .map((peer) => peer.session.user.id)
          .sort();
        await expect
          .poll(
            async () => {
              const proof = await multiplayerProof(endpoint.page, mode);
              const healthy = proof.peers
                .filter(
                  (peer) =>
                    peer.connected &&
                    peer.sent > 0 &&
                    peer.received > 0 &&
                    peer.encrypted > 0 &&
                    peer.decrypted > 0 &&
                    peer.codec.toLowerCase() === "audio/opus" &&
                    peer.rms > 0.0001 &&
                    peer.pair &&
                    (!relay || peer.pair.local === "relay"),
                )
                .map((peer) => peer.id)
                .sort();
              if (
                proof.phase !== "active" ||
                proof.encrypted <= 0 ||
                proof.decrypted <= 0
              )
                return [];
              if (JSON.stringify(healthy) === JSON.stringify(expected)) {
                endpoint.playableAt ??= Date.now();
                const trace = proof.timing;
                const firstAudio = trace?.stages.firstPlayableAudio;
                if (
                  mode === "cloudflare_sfu" &&
                  trace?.channelId === channel.id &&
                  typeof firstAudio === "number" &&
                  Number.isFinite(firstAudio) &&
                  firstAudio >= 0 &&
                  Number.isFinite(trace.startedAt) &&
                  trace.startedAt + firstAudio >= endpoint.joinedAt! &&
                  trace.startedAt + firstAudio <= Date.now()
                )
                  endpoint.firstPlayableAt ??= trace.startedAt + firstAudio;
                if (
                  mode === "cloudflare_sfu" &&
                  expected.length &&
                  !endpoint.firstPlayableAt
                )
                  return [];
              }
              return healthy;
            },
            { timeout: 25000, intervals: [100, 200, 400] },
          )
          .toEqual(expected);
      }),
    );
    return Promise.all(
      active.map((endpoint) => multiplayerProof(endpoint.page, mode)),
    );
  };
  const leave = async (endpoint: Endpoint) => {
    events.push({
      action: "leave",
      userId: endpoint.session.user.id,
      at: Date.now(),
    });
    await endpoint.page
      .getByRole("button", { name: "断开连接", exact: true })
      .first()
      .click();
    await expect(
      endpoint.page.getByRole("button", { name: "断开连接", exact: true }),
    ).toHaveCount(0, { timeout: 10000 });
  };
  const holdNextPublication = async (endpoint: Endpoint) => {
    await endpoint.page.evaluate(() => {
      const target = window as unknown as {
        publicationGate?: {
          entered: boolean;
          pending: Promise<void>;
          release(): void;
        };
      };
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const gate = {
        entered: false,
        pending,
        release: () => {
          release();
          delete target.publicationGate;
        },
      };
      // Delay the actual fetch boundary. Routing every subsequent request with
      // Playwright interception can manufacture ERR_TOO_MANY_RETRIES in Chrome.
      // The original signed request, abort signal and server validation remain.
      target.publicationGate = gate;
    });
    return {
      wait: async () => {
        await expect
          .poll(
            () =>
              endpoint.page.evaluate(
                () =>
                  (
                    window as unknown as {
                      publicationGate?: { entered: boolean };
                    }
                  ).publicationGate?.entered === true,
              ),
            { timeout: 10000 },
          )
          .toBe(true);
        events.push({
          heldPublication: endpoint.session.user.id,
          at: Date.now(),
        });
      },
      release: () =>
        endpoint.page.evaluate(() =>
          (
            window as unknown as { publicationGate?: { release(): void } }
          ).publicationGate?.release(),
        ),
    };
  };
  const sustain = async (active: Endpoint[], milliseconds: number) => {
    const before = await waitForMedia(active);
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(5000, deadline - Date.now())),
      );
      await waitForMedia(active);
    }
    const after = await waitForMedia(active);
    for (const [index, proof] of after.entries()) {
      expect(proof.encrypted).toBeGreaterThan(before[index].encrypted);
      expect(proof.decrypted).toBeGreaterThan(before[index].decrypted);
      for (const peer of proof.peers) {
        const previous = before[index].peers.find((row) => row.id === peer.id)!;
        expect(peer.sent).toBeGreaterThan(previous.sent);
        expect(peer.received).toBeGreaterThan(previous.received);
        expect(peer.encrypted).toBeGreaterThan(previous.encrypted);
        expect(peer.decrypted).toBeGreaterThan(previous.decrypted);
      }
    }
    events.push({ sustainedMs: milliseconds, before, after });
  };
  const transfer = async (old: Endpoint, active: Endpoint[]) => {
    const replacement = await makeEndpoint(old.session);
    await join(replacement);
    await expect(old.page.getByTestId("voice-transfer-notice")).toBeVisible({
      timeout: 20000,
    });
    await expect(
      old.page.getByRole("button", { name: "断开连接", exact: true }),
    ).toHaveCount(0);
    const next = active.map((endpoint) =>
      endpoint === old ? replacement : endpoint,
    );
    await waitForMedia(next);
    events.push({
      deviceTransfer: old.session.user.id,
      proof: await Promise.all(
        next.map((endpoint) => multiplayerProof(endpoint.page, mode)),
      ),
    });
    return next;
  };
  const cleanup = async () => {
    const evidencePath = info.outputPath(`multiplayer-${marker}.json`);
    await writeFile(
      evidencePath,
      JSON.stringify(
        {
          evidenceSchemaVersion: 2,
          mode,
          relay,
          count,
          errors,
          events,
          endpoints: await Promise.all(
            endpoints.map(async (endpoint) => ({
              userId: endpoint.session.user.id,
              joinToPlayableMs:
                endpoint.playableAt && endpoint.joinedAt
                  ? endpoint.playableAt - endpoint.joinedAt
                  : null,
              joinToFirstPlayableMs:
                endpoint.firstPlayableAt && endpoint.joinedAt
                  ? endpoint.firstPlayableAt - endpoint.joinedAt
                  : null,
              proof: await multiplayerProof(endpoint.page, mode).catch(
                () => null,
              ),
            })),
          ),
        },
        null,
        2,
      ),
    );
    await info.attach(`multiplayer-${marker}.json`, {
      path: evidencePath,
      contentType: "application/json",
    });
    for (const endpoint of endpoints) {
      if (!endpoint.page.isClosed()) {
        const disconnect = endpoint.page
          .getByRole("button", { name: "断开连接", exact: true })
          .first();
        if (await disconnect.isVisible().catch(() => false))
          await disconnect.click().catch(() => undefined);
      }
    }
    const traceFailures: string[] = [];
    for (const [index, endpoint] of endpoints.entries()) {
      const traceName = `multiplayer-${marker}-${index}.zip`;
      const tracePath = info.outputPath(traceName);
      try {
        await endpoint.context.tracing.stop({ path: tracePath });
        // Register custom context traces too: HTML reports copy only attachments,
        // while arbitrary files in outputDir have no independent report backup.
        await info.attach(traceName, {
          path: tracePath,
          contentType: "application/zip",
        });
      } catch {
        traceFailures.push(traceName);
      }
      await endpoint.context.close();
    }
    const response = await request.delete(`/api/guilds/${guild.id}`, {
      headers: auth(sessions[0]),
      data: { nameConfirmation: name },
    });
    expect(response.ok(), "delete isolated test guild").toBeTruthy();
    expect(traceFailures, "save every endpoint trace").toEqual([]);
  };
  return {
    endpoints,
    join,
    firstReady,
    waitForMedia,
    leave,
    holdNextPublication,
    sustain,
    transfer,
    cleanup,
    errors,
    events,
  };
}
