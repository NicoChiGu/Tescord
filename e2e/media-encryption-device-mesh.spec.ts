import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GatewayPayload, P2PSignalPayload } from "@tescord/types";
import { CURRENT_APP_VERSION } from "../apps/web/src/data/changelogs";

interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string };
}
async function proof(page: Page) {
  return page.evaluate(async () => {
    const mesh = (
      window as unknown as {
        voiceMeshManager: {
          peerConnections: Map<string, RTCPeerConnection>;
          participantAudioMap: Map<string, { analyserNode?: AnalyserNode }>;
        };
      }
    ).voiceMeshManager;
    const peers = [];
    for (const [id, pc] of mesh.peerConnections) {
      const stats = await pc.getStats();
      let sent = 0,
        received = 0,
        codec = "",
        pair: unknown = null;
      for (const item of stats.values()) {
        if (item.type === "outbound-rtp" && item.kind === "audio")
          sent += item.bytesSent || 0;
        if (item.type === "inbound-rtp" && item.kind === "audio") {
          received += item.bytesReceived || 0;
          codec = stats.get(item.codecId)?.mimeType || "";
        }
        if (
          item.type === "candidate-pair" &&
          item.nominated &&
          item.state === "succeeded"
        )
          pair = {
            local: stats.get(item.localCandidateId)?.candidateType,
            remote: stats.get(item.remoteCandidateId)?.candidateType,
          };
      }
      // The selected transport pair is authoritative after an ICE restart;
      // a candidate's nominated flag can lag the connected transport snapshot.
      for (const item of stats.values()) {
        if (item.type === "transport" && item.selectedCandidatePairId) {
          const selected = stats.get(item.selectedCandidatePairId);
          if (selected?.state === "succeeded") {
            pair = {
              local: stats.get(selected.localCandidateId)?.candidateType,
              remote: stats.get(selected.remoteCandidateId)?.candidateType,
            };
          }
        }
      }
      const analyser = mesh.participantAudioMap.get(id)?.analyserNode;
      let rms = 0;
      if (analyser) {
        const pcm = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(pcm);
        rms = Math.sqrt(pcm.reduce((sum, n) => sum + n * n, 0) / pcm.length);
      }
      peers.push({
        id,
        sent,
        received,
        codec,
        pair,
        rms,
        connection: pc.connectionState,
        transceivers: pc.getTransceivers().map((transceiver) => ({
          mid: transceiver.mid,
          direction: transceiver.currentDirection,
          kind: transceiver.receiver.track.kind,
          sending: transceiver.sender.track?.kind || null,
          trackState: transceiver.sender.track?.readyState || null,
        })),
      });
    }
    return {
      phase: document
        .querySelector('[data-testid="media-encryption-state"]')
        ?.getAttribute("data-phase"),
      counters: document.querySelector('[data-testid="media-encryption-state"]')
        ?.textContent,
      crypto: {
        encrypted: Number(
          document
            .querySelector('[data-testid="media-encryption-state"]')
            ?.getAttribute("data-encrypted-frames") || 0,
        ),
        decrypted: Number(
          document
            .querySelector('[data-testid="media-encryption-state"]')
            ?.getAttribute("data-decrypted-frames") || 0,
        ),
      },
      peers,
    };
  });
}

test("three real signed devices negotiate stream keys, render encrypted mesh audio, and rotate on leave", async ({
  browser,
  request,
}) => {
  test.setTimeout(120000);
  const sessions: Session[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const errors: string[] = [];
  const logs: string[] = [];
  const memberships = new Map<Page, string>();
  const heldOffers = new Map<string, () => void>();
  let forcedGlare = false;
  let releaseOffers = false;
  const releaseGlare = () => {
    if (!releaseOffers || heldOffers.size !== 2) return;
    forcedGlare = true;
    for (const forward of heldOffers.values()) forward();
    heldOffers.clear();
  };
  let staleAnswersInjected = 0;
  let missingIdAnswersInjected = 0;
  let unansweredOfferRetryAttempts = 0;
  const suffix = Date.now().toString(36);
  for (let index = 0; index < 3; index++) {
    const response = await request.post("/api/auth/register", {
      data: {
        username: `mesh_${suffix}_${index}`,
        email: `mesh_${suffix}_${index}@example.invalid`,
        password: "EncryptedMeshRegression123",
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    sessions.push(await response.json());
  }
  const auth = (session: Session) => ({
    Authorization: `Bearer ${session.accessToken}`,
  });
  const result = await request.post("/api/guilds", {
    headers: auth(sessions[0]),
    data: { name: `Encrypted mesh ${suffix}` },
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  const guild = (await result.json()) as { id: string };
  const create = await request.post(`/api/guilds/${guild.id}/channels`, {
    headers: auth(sessions[0]),
    data: { name: `mesh-${suffix}`, type: "VOICE", voiceMode: "p2p_mesh" },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const channel = (await create.json()) as { id: string };
  for (const member of sessions.slice(1)) {
    const invitation = await request.post(`/api/guilds/${guild.id}/invites`, {
      headers: auth(sessions[0]),
      data: { maxUses: 1, maxAge: 3600, forceNew: true },
    });
    expect(invitation.ok()).toBeTruthy();
    const { code } = (await invitation.json()) as { code: string };
    expect(
      (
        await request.post(`/api/invites/${code}/join`, {
          headers: auth(member),
        })
      ).ok(),
    ).toBeTruthy();
  }
  try {
    for (const session of sessions) {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        permissions: ["microphone"],
        locale: "zh-CN",
      });
      contexts.push(context);
      await context.addInitScript(
        ({ session, version }) => {
          localStorage.setItem("tescord_access_token", session.accessToken);
          localStorage.setItem("tescord_refresh_token", session.refreshToken);
          localStorage.setItem("tescord_last_seen_changelog_version", version);
          const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
            navigator.mediaDevices,
          );
          navigator.mediaDevices.getUserMedia = async (constraints) => {
            if (!constraints?.audio || constraints.video)
              return getUserMedia(constraints);
            const ctx = new AudioContext(),
              tone = ctx.createOscillator(),
              gain = ctx.createGain(),
              destination = ctx.createMediaStreamDestination();
            tone.frequency.value = 440;
            gain.gain.value = 0.05;
            tone.connect(gain).connect(destination);
            tone.start();
            await ctx.resume();
            const track = destination.stream.getAudioTracks()[0],
              stop = track.stop.bind(track);
            track.stop = () => {
              stop();
              tone.stop();
              void ctx.close();
            };
            return destination.stream;
          };
        },
        { session, version: CURRENT_APP_VERSION },
      );
      const page = await context.newPage();
      pages.push(page);
      await page.routeWebSocket("**/gateway", (socket) => {
        const server = socket.connectToServer();
        socket.onMessage((message) => {
          if (typeof message === "string") {
            const packet = JSON.parse(
              message,
            ) as GatewayPayload<P2PSignalPayload>;
            const signal = packet.t === "P2P_SIGNAL" ? packet.d : undefined;
            if (
              !forcedGlare &&
              signal?.type === "VOICE_OFFER" &&
              sessions
                .slice(0, 2)
                .some((session) => session.user.id === signal.senderId) &&
              sessions
                .slice(0, 2)
                .some((session) => session.user.id === signal.targetId)
            ) {
              heldOffers.set(signal.senderId, () => server.send(message));
              releaseGlare();
              return;
            }
          }
          server.send(message);
        });
        server.onMessage((message) => {
          if (typeof message === "string") {
            const packet = JSON.parse(
              message,
            ) as GatewayPayload<P2PSignalPayload>;
            const signal = packet.t === "P2P_SIGNAL" ? packet.d : undefined;
            if (signal?.type === "VOICE_ANSWER" && signal.negotiationId) {
              socket.send(
                JSON.stringify({
                  ...packet,
                  d: {
                    ...signal,
                    negotiationId: "obsolete-offer",
                    sdp: { type: "answer", sdp: "invalid-answer-regression" },
                  },
                }),
              );
              staleAnswersInjected++;
              socket.send(
                JSON.stringify({
                  ...packet,
                  d: {
                    ...signal,
                    negotiationId: undefined,
                    sdp: { type: "answer", sdp: "invalid-answer-regression" },
                  },
                }),
              );
              missingIdAnswersInjected++;
              socket.send(message);
              socket.send(message); // duplicate after successful answer must be ignored.
              return;
            }
          }
          socket.send(message);
        });
      });
      page.on("console", (message) => {
        if (/VoiceMesh|SFrame|media|密钥/.test(message.text()))
          logs.push(
            `${pages.indexOf(page)} ${message.type()} ${message.text()}`,
          );
      });
      page.on("response", async (response) => {
        if (response.url().includes("media-encryption") && response.ok()) {
          const snapshot = (await response.json().catch(() => null)) as {
            context?: { membershipVersion: string };
          } | null;
          if (snapshot?.context)
            memberships.set(page, snapshot.context.membershipVersion);
        }
        if (
          response.url().includes("media-encryption") &&
          response.status() >= 400
        )
          logs.push(
            `${pages.indexOf(page)} HTTP ${response.status()} ${new URL(response.url()).pathname}`,
          );
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("https://localhost:4173/");
      await page
        .getByRole("button", { name: `Encrypted mesh ${suffix}`, exact: true })
        .click();
      await page.evaluate(() =>
        (
          window as unknown as {
            useSettingsStore: {
              getState(): { setAudioConfig(config: unknown): void };
            };
          }
        ).useSettingsStore
          .getState()
          .setAudioConfig({
            noiseSuppressionMode: "off",
            noiseSuppression: false,
            vadSensitivity: 0,
            autoGainControl: false,
          }),
      );
      if (pages.length === 3) {
        // Force a remote offer to arrive while the third device is still
        // fetching ICE configuration. Its microphone must already be bound.
        await page.evaluate(() => {
          const mesh = (
            window as unknown as {
              voiceMeshManager: {
                fetchIceServers(force?: boolean): Promise<RTCIceServer[]>;
              };
            }
          ).voiceMeshManager;
          const fetch = mesh.fetchIceServers.bind(mesh);
          mesh.fetchIceServers = async (force) => {
            await new Promise((resolve) => setTimeout(resolve, 3500));
            return fetch(force);
          };
        });
      }
      await page
        .locator(`[data-channel-id="${channel.id}"]`)
        .first()
        .dblclick();
      await expect(
        page.getByTestId("media-encryption-state").first(),
      ).toHaveAttribute("data-phase", /ready|active/, { timeout: 20000 });
      if (pages.length === 2) {
        // Hold the joining device's offer until both PCs have local offers.
        // The normal roster can arrive before encryption initialization, so
        // explicitly initiate the other endpoint to deterministically exercise glare.
        await expect.poll(() => heldOffers.size).toBeGreaterThanOrEqual(1);
        // No answers are delivered yet. A second retry proves every restarted
        // offer has its own timeout rather than getting stuck after attempt one.
        await expect
          .poll(
            async () => {
              unansweredOfferRetryAttempts = await pages[1].evaluate(
                (peerId) =>
                  (
                    window as unknown as {
                      voiceMeshManager: {
                        peerRetries: Map<string, { attempts: number }>;
                      };
                    }
                  ).voiceMeshManager.peerRetries.get(peerId)?.attempts || 0,
                sessions[0].user.id,
              );
              return unansweredOfferRetryAttempts;
            },
            { timeout: 20000 },
          )
          .toBeGreaterThanOrEqual(2);
        releaseOffers = true;
        releaseGlare();
        if (!forcedGlare)
          await pages[0].evaluate(async (peerId) => {
            await (
              window as unknown as {
                voiceMeshManager: {
                  initiateCallToPeer(id: string): Promise<void>;
                };
              }
            ).voiceMeshManager.initiateCallToPeer(peerId);
          }, sessions[1].user.id);
      }
      if (pages.length >= 2) {
        for (const peer of pages)
          await expect
            .poll(
              async () =>
                (await proof(peer)).phase === "active"
                  ? (await proof(peer)).peers.filter(
                      (item) =>
                        item.received > 0 &&
                        item.sent > 0 &&
                        item.rms > 0.0001 &&
                        item.pair &&
                        item.connection === "connected",
                    ).length
                  : 0,
              { timeout: 20000 },
            )
            .toBe(pages.length - 1);
      }
    }
    expect(forcedGlare).toBe(true);
    expect(staleAnswersInjected).toBeGreaterThan(0);
    expect(missingIdAnswersInjected).toBeGreaterThan(0);
    const before = await Promise.all(pages.map(proof));
    for (const endpoint of before) {
      expect(endpoint.phase).toBe("active");
      expect(endpoint.crypto.encrypted).toBeGreaterThan(0);
      expect(endpoint.crypto.decrypted).toBeGreaterThan(0);
      expect(endpoint.peers).toHaveLength(2);
      for (const peer of endpoint.peers) {
        expect(peer.codec).toBe("audio/opus");
        expect(peer.pair).toBeTruthy();
        expect(peer.connection).toBe("connected");
      }
    }
    const membershipBeforeLeave = new Map(memberships);
    await pages[2]
      .getByRole("button", { name: "断开连接", exact: true })
      .first()
      .click();
    for (const page of pages.slice(0, 2))
      await expect
        .poll(
          async () => {
            const result = await proof(page);
            return (
              result.peers.length === 1 &&
              result.peers[0].rms > 0.0001 &&
              result.phase === "active" &&
              memberships.get(page) !== membershipBeforeLeave.get(page) &&
              result.peers[0].received >
                before[pages.indexOf(page)].peers.find(
                  (peer) => peer.id === result.peers[0].id,
                )!.received
            );
          },
          { timeout: 20000 },
        )
        .toBe(true);
    const path = resolve("test-results/media-encryption-proof");
    mkdirSync(path, { recursive: true });
    writeFileSync(
      resolve(path, "three-device-mesh.json"),
      JSON.stringify(
        {
          forcedGlare,
          delayedIceSetupMs: 3500,
          staleAnswersInjected,
          missingIdAnswersInjected,
          unansweredOfferRetryAttempts,
          before,
          after: await Promise.all(pages.slice(0, 2).map(proof)),
          errors,
        },
        null,
        2,
      ),
    );
    // A delayed manual retry must not resurrect a PC after leaving the mesh.
    const peersAfterCanceledRetry = await pages[0].evaluate(async (peerId) => {
      const mesh = (
        window as unknown as {
          voiceMeshManager: {
            fetchIceServers(force?: boolean): Promise<RTCIceServer[]>;
            retryPeer(id: string): Promise<void>;
            stopAll(): void;
            peerConnections: Map<string, RTCPeerConnection>;
          };
        }
      ).voiceMeshManager;
      const fetch = mesh.fetchIceServers;
      let release!: (servers: RTCIceServer[]) => void;
      mesh.fetchIceServers = async () =>
        new Promise((resolve) => {
          release = resolve;
        });
      try {
        const retry = mesh.retryPeer(peerId);
        mesh.stopAll();
        release([]);
        await retry;
        return mesh.peerConnections.size;
      } finally {
        mesh.fetchIceServers = fetch;
      }
    }, sessions[1].user.id);
    expect(peersAfterCanceledRetry).toBe(0);
    writeFileSync(
      resolve(path, "canceled-retry.json"),
      JSON.stringify(
        {
          remainingPeerConnections: peersAfterCanceledRetry,
          delayedIceFetchReleasedAfterStop: true,
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
    expect(logs.filter((line) => /^\d+ error /.test(line))).toEqual([]);
  } finally {
    const path = resolve("test-results/media-encryption-proof");
    mkdirSync(path, { recursive: true });
    writeFileSync(
      resolve(path, `three-device-diagnostics-${suffix}.json`),
      JSON.stringify(
        {
          endpoints: await Promise.all(
            pages.map((page) => proof(page).catch(() => null)),
          ),
          logs,
          errors,
        },
        null,
        2,
      ),
    );
    for (const context of contexts) await context.close();
  }
});
