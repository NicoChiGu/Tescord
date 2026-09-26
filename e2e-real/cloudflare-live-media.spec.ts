import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

declare global {
  interface Window { __cloudflareAcceptancePcs: RTCPeerConnection[]; __acceptanceSelectedMic?: string; }
}

async function mediaSnapshot(page: Page) {
  return page.evaluate(async () => {
    const rows = [];
    for (const pc of window.__cloudflareAcceptancePcs || []) {
      const report = await pc.getStats();
      let localType = "";
      const rtp = [];
      const selectedPairId = [...report.values()].find(item => item.type === "transport" && item.selectedCandidatePairId)?.selectedCandidatePairId;
      for (const item of report.values()) {
        if (item.type === "candidate-pair" && item.state === "succeeded" && (item.id === selectedPairId || item.nominated || item.selected)) localType = report.get(item.localCandidateId)?.candidateType || "";
        if (item.type === "outbound-rtp" || item.type === "inbound-rtp") rtp.push({ direction: item.type, kind: item.kind, bytes: item.bytesSent || item.bytesReceived || 0, codec: report.get(item.codecId)?.mimeType || null, frames: item.framesDecoded || 0 });
      }
      rows.push({ state: pc.connectionState, localType, rtp });
    }
    return rows;
  });
}

test("three authorized browsers exchange Cloudflare SFU audio, camera and screen tracks", async ({ browser, request }) => {
  const onTarget = Boolean(process.env.TESCORD_TARGET_BASE_URL);
  if (onTarget) test.setTimeout(180_000);
  const forceRelay = process.env.TESCORD_FORCE_RELAY === "1";
  const testP2PFallback = process.env.TESCORD_TEST_P2P_FALLBACK === "1";
  if (testP2PFallback) test.setTimeout(180_000);
  if (process.env.TESCORD_TEST_SERVER_RESTART === "1") test.setTimeout(240_000);
  if (process.env.TESCORD_TEST_NETWORK_RECOVERY === "1") test.setTimeout(240_000);
  const adminLogin = await request.post("/api/auth/login", { data: {
    emailOrUsername: onTarget ? process.env.TESCORD_ACCEPTANCE_ADMIN_USERNAME || "AcceptanceAdmin" : "Jackey",
    password: onTarget ? process.env.TESCORD_ACCEPTANCE_ADMIN_PASSWORD : "adminpassword123",
  } });
  expect(adminLogin.ok()).toBeTruthy();
  const adminToken = (await adminLogin.json()).accessToken as string;
  let guildId = "gld_default_01";
  let guildName: string | null = null;
  let aliceToken: string;
  let bobToken: string;
  if (onTarget) {
    const marker = randomBytes(5).toString("hex");
    const registrationInvite = await request.post("/api/admin/registration-invites", { headers: { Authorization: `Bearer ${adminToken}` }, data: { note: `Cloudflare acceptance ${marker}`, maxUses: 2 } });
    expect(registrationInvite.ok()).toBeTruthy();
    const inviteCode = (await registrationInvite.json()).code as string;
    const register = async (label: string) => {
      const response = await request.post("/api/auth/register", { data: { username: `${label}_${marker}`, email: `${label}-${marker}@example.invalid`, password: randomBytes(24).toString("base64url"), inviteCode } });
      expect(response.ok()).toBeTruthy();
      return (await response.json()).accessToken as string;
    };
    aliceToken = await register("alice");
    bobToken = await register("bob");
    guildName = `Cloudflare acceptance ${marker}`;
    const guild = await request.post("/api/guilds", { headers: { Authorization: `Bearer ${adminToken}` }, data: { name: guildName } });
    expect(guild.ok()).toBeTruthy();
    guildId = (await guild.json()).id as string;
  } else {
    const aliceLogin = await request.post("/api/auth/login", { data: { emailOrUsername: "alice@tescord.local", password: "alicepassword123" } });
    expect(aliceLogin.ok()).toBeTruthy();
    aliceToken = (await aliceLogin.json()).accessToken as string;
    const bobLogin = await request.post("/api/auth/login", { data: { emailOrUsername: "bob@tescord.local", password: "bobpassword123" } });
    expect(bobLogin.ok()).toBeTruthy();
    bobToken = (await bobLogin.json()).accessToken as string;
  }
  for (const token of [aliceToken, bobToken]) {
    const invite = await request.post(`/api/guilds/${guildId}/invites`, { headers: { Authorization: `Bearer ${adminToken}` }, data: { maxUses: 1 } });
    expect(invite.ok()).toBeTruthy();
    const code = (await invite.json()).code as string;
    const joined = await request.post(`/api/invites/${code}/join`, { headers: { Authorization: `Bearer ${token}` } });
    expect(joined.ok()).toBeTruthy();
  }

  const pages: Page[] = [];
  const diagnostics: Array<Array<{ event: string; count?: number; status?: number }>> = [[], [], []];
  const activeConsoleErrors: string[] = [];
  let tearingDown = false;
  for (const token of [adminToken, aliceToken, bobToken]) {
    const index = pages.length;
    const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: "zh-CN", permissions: ["microphone", "camera"] });
    await context.addInitScript(({ accessToken, forceRelay, blockP2P }) => {
      localStorage.setItem("tescord_access_token", accessToken);
      const nativeEnumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = async () => [
        ...await nativeEnumerate(),
        { deviceId: "acceptance_mic_2", groupId: "acceptance", kind: "audioinput", label: "Acceptance microphone 2" } as MediaDeviceInfo,
        { deviceId: "acceptance_camera_2", groupId: "acceptance", kind: "videoinput", label: "Acceptance camera 2" } as MediaDeviceInfo,
      ];
      navigator.mediaDevices.getUserMedia = async constraints => {
        const videoId = typeof constraints?.video === "object" ? (constraints.video.deviceId as { exact?: string } | undefined)?.exact : undefined;
        if (videoId === "acceptance_camera_2") {
          const canvas = document.createElement("canvas");
          canvas.width = 640; canvas.height = 360;
          const context = canvas.getContext("2d")!;
          let frame = 0;
          const paint = () => { context.fillStyle = frame++ % 2 ? "#4eb0b8" : "#ee7448"; context.fillRect(0, 0, 640, 360); };
          paint();
          setInterval(paint, 100);
          return canvas.captureStream(15);
        }
        const audioId = typeof constraints?.audio === "object" ? (constraints.audio.deviceId as { exact?: string } | undefined)?.exact : undefined;
        if (audioId === "acceptance_mic_2") {
          window.__acceptanceSelectedMic = audioId;
          const audio = new AudioContext();
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          const destination = audio.createMediaStreamDestination();
          gain.gain.value = 0.02;
          oscillator.connect(gain).connect(destination);
          oscillator.start();
          return destination.stream;
        }
        return nativeGetUserMedia(constraints);
      };
      const NativePC = window.RTCPeerConnection;
      window.__cloudflareAcceptancePcs = [];
      let blockNextOffer = blockP2P;
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        configurable: true,
        value: () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
      });
      window.RTCPeerConnection = class extends NativePC {
        constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
          super({ ...args[0], ...(forceRelay ? { iceTransportPolicy: "relay" as const } : {}) });
          if (blockNextOffer) {
            blockNextOffer = false;
            this.createOffer = async () => { throw new Error("Acceptance test blocked P2P negotiation"); };
          }
          window.__cloudflareAcceptancePcs.push(this);
        }
      };
    }, { accessToken: token, forceRelay, blockP2P: testP2PFallback && index === 1 });
    const page = await context.newPage();
    page.on("websocket", socket => socket.on("framereceived", frame => {
      try {
        const packet = JSON.parse(String(frame.payload));
        if (packet.t === "CF_MEDIA_TRACKS") diagnostics[index].push({ event: "gateway_tracks", count: packet.d?.tracks?.length || 0 });
      } catch { /* Other Gateway frames are irrelevant. */ }
    }));
    page.on("response", async response => {
      const pathname = new URL(response.url()).pathname;
      if (response.status() >= 400 && pathname.includes("/api/cloudflare-realtime/")) {
        diagnostics[index].push({ event: pathname, status: response.status() });
      }
      if (pathname.includes("/api/cloudflare-realtime/session/new")) {
        const body = await response.json().catch(() => ({}));
        diagnostics[index].push({ event: "session_new", status: response.status(), count: body.tracks?.length || 0 });
      } else if (pathname.includes("/api/cloudflare-realtime/tracks/ready") || pathname.includes("/api/cloudflare-realtime/tracks/subscribe")) {
        diagnostics[index].push({ event: pathname.endsWith("ready") ? "ready" : "subscribe", status: response.status() });
      }
    });
    page.on("console", message => {
      if (message.type() === "error" && !tearingDown) activeConsoleErrors.push(`browser ${index}: ${message.text()}`);
      if (message.type() === "error" || message.type() === "warning") console.log(`browser ${index} ${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", error => console.log(`browser ${index} pageerror: ${error.message}`));
    pages.push(page);
    await page.goto("/");
    await expect(page.getByTestId("current-user-panel-btn")).toBeVisible({ timeout: 20_000 });
  }

  for (const [index, page] of pages.entries()) {
    if (guildName) await page.getByRole("button", { name: guildName, exact: true }).click();
    if (testP2PFallback && index === 1) {
      await page.evaluate(() => (window as Window & { useSettingsStore: { getState(): { setVoiceTransmissionMode(mode: string): void } } }).useSettingsStore.getState().setVoiceTransmissionMode("p2p_mesh"));
    }
    const voice = page.locator('button[title="单击预览房间，双击加入语音通话"]').first();
    await expect(voice).toBeVisible({ timeout: 10_000 });
    await voice.click();
    await page.getByRole("button", { name: "加入语音通话" }).click();
    try {
      // ICE may use the client's 30-second first-attempt timeout before its single retry.
      await expect(page.getByRole("button", { name: "断开连接" }).first()).toBeVisible({ timeout: 70_000 });
    } catch (error) {
      console.log(JSON.stringify({ stage: "join", snapshots: await Promise.all(pages.map(mediaSnapshot)), diagnostics }));
      throw error;
    }
    if (testP2PFallback && index === 0) {
      await expect.poll(async () => (await mediaSnapshot(page)).some(peer => peer.state === "connected"), { timeout: 30_000 }).toBe(true);
      await page.waitForTimeout(1500);
    }
  }

  if (testP2PFallback) {
    await expect.poll(async () => {
      const rows = await mediaSnapshot(pages[1]);
      return rows.length >= 2 && rows[0].state === "closed" && rows.some(row => row.state === "connected");
    }, { timeout: 30_000 }).toBe(true);
  }

  try {
    await expect.poll(async () => {
      const snapshots = await Promise.all(pages.map(mediaSnapshot));
      return snapshots.every((rows) => rows.some((row) => row.state === "connected" && row.rtp.some((rtp) => rtp.direction === "inbound-rtp" && rtp.kind === "audio" && rtp.bytes > 1000)));
    }, { timeout: 30_000 }).toBe(true);
  } catch (error) {
    console.log(JSON.stringify({ stage: "audio", snapshots: await Promise.all(pages.map(mediaSnapshot)), diagnostics }));
    throw error;
  }
  const before = await Promise.all(pages.map(mediaSnapshot));
  await pages[0].waitForTimeout(1200);
  let after = await Promise.all(pages.map(mediaSnapshot));
  if (forceRelay) await expect.poll(async () => {
    const rows = await Promise.all(pages.map(mediaSnapshot));
    return rows.every(peers => peers.some(peer => peer.state === "connected" && peer.localType === "relay"));
  }, { timeout: 10_000 }).toBe(true);
  if (forceRelay) after = await Promise.all(pages.map(mediaSnapshot));
  for (let i = 0; i < pages.length; i++) {
    const inbound = (rows: Awaited<ReturnType<typeof mediaSnapshot>>) => rows.flatMap(row => row.rtp).filter(rtp => rtp.direction === "inbound-rtp" && rtp.kind === "audio").reduce((sum, rtp) => sum + rtp.bytes, 0);
    const outbound = (rows: Awaited<ReturnType<typeof mediaSnapshot>>) => rows.flatMap(row => row.rtp).filter(rtp => rtp.direction === "outbound-rtp" && rtp.kind === "audio").reduce((sum, rtp) => sum + rtp.bytes, 0);
    expect(inbound(after[i])).toBeGreaterThan(inbound(before[i]));
    expect(outbound(after[i])).toBeGreaterThan(outbound(before[i]));
  }
  await pages[0].getByTestId("voice-mic-menu-btn").click();
  await pages[0].getByTestId("mic-option-acceptance_mic_2").click();
  await expect.poll(async () => pages[0].evaluate(() => window.__acceptanceSelectedMic), { timeout: 10_000 }).toBe("acceptance_mic_2");
  const micBefore = await mediaSnapshot(pages[1]);
  await pages[0].waitForTimeout(1200);
  const micAfter = await mediaSnapshot(pages[1]);
  const audioReceived = (rows: Awaited<ReturnType<typeof mediaSnapshot>>) => rows.flatMap(row => row.rtp)
    .filter(rtp => rtp.direction === "inbound-rtp" && rtp.kind === "audio").reduce((sum, rtp) => sum + rtp.bytes, 0);
  expect(audioReceived(micAfter)).toBeGreaterThan(audioReceived(micBefore));
  await pages[0].getByTestId("voice-toggle-camera-btn").click();
  await expect.poll(async () => {
    const rows = await mediaSnapshot(pages[1]);
    return rows.some(row => row.rtp.some(rtp => rtp.direction === "inbound-rtp" && rtp.kind === "video" && rtp.bytes > 1000 && rtp.frames > 0));
  }, { timeout: 30_000 }).toBe(true);
  const videoBefore = await mediaSnapshot(pages[1]);
  await pages[1].waitForTimeout(1200);
  const videoAfter = await mediaSnapshot(pages[1]);
  const videoBytes = (rows: Awaited<ReturnType<typeof mediaSnapshot>>) => rows.flatMap(row => row.rtp).filter(rtp => rtp.direction === "inbound-rtp" && rtp.kind === "video").reduce((sum, rtp) => sum + rtp.bytes, 0);
  expect(videoBytes(videoAfter)).toBeGreaterThan(videoBytes(videoBefore));
  const cameraTrackBefore = await pages[0].evaluate(() => window.__cloudflareAcceptancePcs.filter(pc => pc.connectionState === "connected").flatMap(pc => pc.getSenders())
    .find(sender => sender.track?.kind === "video")?.track?.id || "");
  await pages[0].getByTestId("voice-camera-menu-btn").click();
  await pages[0].getByTestId("camera-option-acceptance_camera_2").click();
  await expect.poll(async () => pages[0].evaluate(() => window.__cloudflareAcceptancePcs.filter(pc => pc.connectionState === "connected").flatMap(pc => pc.getSenders())
    .find(sender => sender.track?.kind === "video" && sender.track.readyState === "live")?.track?.id || ""),
  { timeout: 15_000 }).not.toBe(cameraTrackBefore);
  const cameraTrackAfter = await pages[0].evaluate(() => window.__cloudflareAcceptancePcs.filter(pc => pc.connectionState === "connected").flatMap(pc => pc.getSenders())
    .find(sender => sender.track?.kind === "video" && sender.track.readyState === "live")?.track?.id || "");
  expect(cameraTrackAfter).toBeTruthy();
  expect(cameraTrackAfter).not.toBe(cameraTrackBefore);
  const switchedVideoBefore = await mediaSnapshot(pages[1]);
  await pages[0].waitForTimeout(1200);
  const switchedVideoAfter = await mediaSnapshot(pages[1]);
  expect(videoBytes(switchedVideoAfter)).toBeGreaterThan(videoBytes(switchedVideoBefore));
  await pages[0].getByTestId("voice-toggle-camera-btn").click();
  await expect.poll(async () => (await mediaSnapshot(pages[0])).some(row => row.state === "connected"), { timeout: 10_000 }).toBe(true);
  await pages[0].getByTestId("voice-toggle-screen-btn").click();
  await pages[0].getByTestId("screen-share-audio-checkbox").check({ force: true });
  await pages[0].getByTestId("start-screen-share-confirm-btn").click();
  await expect.poll(async () => {
    const rows = await mediaSnapshot(pages[1]);
    return rows.some(row => row.rtp.filter(rtp => rtp.direction === "inbound-rtp" && rtp.kind === "video" && rtp.frames > 0).length >= 2 && row.rtp.filter(rtp => rtp.direction === "inbound-rtp" && rtp.kind === "audio" && rtp.bytes > 1000).length >= 3);
  }, { timeout: 30_000 }).toBe(true);
  const screenReceiver = await mediaSnapshot(pages[1]);
  await pages[0].getByTestId("voice-toggle-screen-btn").click();
  let networkReceiver: Awaited<ReturnType<typeof mediaSnapshot>> | undefined;
  if (onTarget && process.env.TESCORD_TEST_NETWORK_RECOVERY === "1") {
    await pages[0].context().setOffline(true);
    await pages[0].waitForTimeout(4_000);
    await pages[0].context().setOffline(false);
    const baseline = await mediaSnapshot(pages[0]);
    const audioBytes = (rows: Awaited<ReturnType<typeof mediaSnapshot>>, direction: string) => rows.flatMap(peer => peer.rtp)
      .filter(rtp => rtp.direction === direction && rtp.kind === "audio").reduce((sum, rtp) => sum + rtp.bytes, 0);
    try {
      await expect.poll(async () => {
        const peers = await mediaSnapshot(pages[0]);
        return peers.some(peer => peer.state === "connected" && peer.localType === "relay") &&
          audioBytes(peers, "inbound-rtp") > audioBytes(baseline, "inbound-rtp") + 1000 &&
          audioBytes(peers, "outbound-rtp") > audioBytes(baseline, "outbound-rtp") + 1000;
      }, { timeout: 90_000 }).toBe(true);
    } catch (error) {
      console.log(JSON.stringify({ stage: "network_recovery", baseline, after: await mediaSnapshot(pages[0]), diagnostics: diagnostics[0] }));
      throw error;
    }
    networkReceiver = await mediaSnapshot(pages[0]);
  }
  let restartReceiver: Awaited<ReturnType<typeof mediaSnapshot>> | undefined;
  if (onTarget && process.env.TESCORD_TEST_SERVER_RESTART === "1") {
    const oldCounts = await Promise.all(pages.map(async page => (await mediaSnapshot(page)).length));
    const compose = "podman-compose -f /home/tera/apps/tescord/docker/docker-compose-cloudflare.yml --env-file /home/tera/apps/tescord/docker/.env.cloudflare up -d --no-build server";
    try {
      await execFileAsync("ssh", ["tera@100.69.12.101", `podman stop docker_server_1 && podman rm docker_server_1 && ${compose}`], { timeout: 45_000 });
    } catch (error) {
      await execFileAsync("ssh", ["tera@100.69.12.101", compose], { timeout: 45_000 }).catch(() => undefined);
      throw error;
    }
    await expect.poll(async () => {
      const rows = await Promise.all(pages.map(mediaSnapshot));
      return rows.every((peers, index) => peers.length > oldCounts[index] && peers.some(peer => peer.state === "connected" &&
        peer.rtp.some(rtp => rtp.direction === "inbound-rtp" && rtp.kind === "audio" && rtp.bytes > 1000)));
    }, { timeout: 90_000 }).toBe(true);
    const beforeRestartRtp = await Promise.all(pages.map(mediaSnapshot));
    await pages[0].waitForTimeout(1200);
    const afterRestartRtp = await Promise.all(pages.map(mediaSnapshot));
    for (let index = 0; index < pages.length; index++) {
      const inbound = (rows: Awaited<ReturnType<typeof mediaSnapshot>>) => rows.flatMap(peer => peer.rtp)
        .filter(rtp => rtp.direction === "inbound-rtp" && rtp.kind === "audio").reduce((sum, rtp) => sum + rtp.bytes, 0);
      expect(inbound(afterRestartRtp[index])).toBeGreaterThan(inbound(beforeRestartRtp[index]));
    }
    restartReceiver = afterRestartRtp[1];
  }
  const evidence = { result: "PASS", peers: after, microphoneSwitchReceiver: micAfter,
    cameraReceiver: videoAfter, cameraSwitch: { trackChanged: cameraTrackAfter !== cameraTrackBefore,
      receiver: switchedVideoAfter }, screenReceiver, networkReceiver, restartReceiver };
  if (onTarget) {
    const directory = resolve("test-results/cloudflare-target");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "media-stats.json"), JSON.stringify(evidence, null, 2));
    await pages[1].screenshot({ path: resolve(directory, "media-receiver.png"), fullPage: true });
  }
  expect(activeConsoleErrors, JSON.stringify(diagnostics)).toEqual([]);
  tearingDown = true;
  for (const page of pages) {
    const shareModal = page.locator(".fixed.inset-0.z-50").filter({ has: page.getByRole("heading", { name: /屏幕与应用直播分享/ }) });
    if (await shareModal.isVisible().catch(() => false)) await shareModal.getByRole("button", { name: "关闭" }).click();
    await page.getByRole("button", { name: "断开连接" }).first().click();
  }
  await expect.poll(async () => (await Promise.all(pages.map(page => page.evaluate(() =>
    (window.__cloudflareAcceptancePcs || []).every(pc => pc.connectionState === "closed" &&
      pc.getSenders().every(sender => !sender.track || sender.track.readyState === "ended"))
  )))).every(Boolean), { timeout: 15_000 }).toBe(true);
  console.log(JSON.stringify(evidence));
  await Promise.all(pages.map(page => page.context().close()));
});
