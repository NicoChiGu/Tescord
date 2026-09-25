import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

declare global {
  interface Window { __cloudflareAcceptancePcs: RTCPeerConnection[]; }
}

async function mediaSnapshot(page: Page) {
  return page.evaluate(async () => {
    const rows = [];
    for (const pc of window.__cloudflareAcceptancePcs || []) {
      const report = await pc.getStats();
      let localType = "";
      const rtp = [];
      for (const item of report.values()) {
        if (item.type === "candidate-pair" && item.nominated && item.state === "succeeded") localType = report.get(item.localCandidateId)?.candidateType || "";
        if (item.type === "outbound-rtp" || item.type === "inbound-rtp") rtp.push({ direction: item.type, kind: item.kind, bytes: item.bytesSent || item.bytesReceived || 0, codec: report.get(item.codecId)?.mimeType || null, frames: item.framesDecoded || 0 });
      }
      rows.push({ state: pc.connectionState, localType, rtp });
    }
    return rows;
  });
}

test("three authorized browsers exchange Cloudflare SFU audio, camera and screen tracks", async ({ browser, request }) => {
  const onTarget = Boolean(process.env.TESCORD_TARGET_BASE_URL);
  const forceRelay = process.env.TESCORD_FORCE_RELAY === "1";
  const adminLogin = await request.post("/api/auth/login", { data: {
    emailOrUsername: onTarget ? process.env.TESCORD_ACCEPTANCE_ADMIN_USERNAME || "AcceptanceAdmin" : "Jackey",
    password: onTarget ? process.env.TESCORD_ACCEPTANCE_ADMIN_PASSWORD : "adminpassword123",
  } });
  expect(adminLogin.ok()).toBeTruthy();
  const adminToken = (await adminLogin.json()).accessToken as string;
  let guildId = "gld_default_01";
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
    const guild = await request.post("/api/guilds", { headers: { Authorization: `Bearer ${adminToken}` }, data: { name: `Cloudflare acceptance ${marker}` } });
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
  for (const token of [adminToken, aliceToken, bobToken]) {
    const index = pages.length;
    const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: "zh-CN", permissions: ["microphone", "camera"] });
    await context.addInitScript(({ accessToken, forceRelay }) => {
      localStorage.setItem("tescord_access_token", accessToken);
      const NativePC = window.RTCPeerConnection;
      window.__cloudflareAcceptancePcs = [];
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        configurable: true,
        value: () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
      });
      window.RTCPeerConnection = class extends NativePC {
        constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
          super({ ...args[0], ...(forceRelay ? { iceTransportPolicy: "relay" as const } : {}) });
          window.__cloudflareAcceptancePcs.push(this);
        }
      };
    }, { accessToken: token, forceRelay });
    const page = await context.newPage();
    page.on("websocket", socket => socket.on("framereceived", frame => {
      try {
        const packet = JSON.parse(String(frame.payload));
        if (packet.t === "CF_MEDIA_TRACKS") diagnostics[index].push({ event: "gateway_tracks", count: packet.d?.tracks?.length || 0 });
      } catch { /* Other Gateway frames are irrelevant. */ }
    }));
    page.on("response", async response => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.includes("/api/cloudflare-realtime/session/new")) {
        const body = await response.json().catch(() => ({}));
        diagnostics[index].push({ event: "session_new", status: response.status(), count: body.tracks?.length || 0 });
      } else if (pathname.includes("/api/cloudflare-realtime/tracks/ready") || pathname.includes("/api/cloudflare-realtime/tracks/subscribe")) {
        diagnostics[index].push({ event: pathname.endsWith("ready") ? "ready" : "subscribe", status: response.status() });
      }
    });
    page.on("console", message => { if (message.type() === "error" || message.type() === "warning") console.log(`browser ${pages.length} ${message.type()}: ${message.text()}`); });
    page.on("pageerror", error => console.log(`browser ${pages.length} pageerror: ${error.message}`));
    pages.push(page);
    await page.goto("/");
    await expect(page.getByTestId("current-user-panel-btn")).toBeVisible({ timeout: 20_000 });
  }

  for (const page of pages) {
    const voice = page.locator('button[title="单击预览房间，双击加入语音通话"]').first();
    await expect(voice).toBeVisible({ timeout: 10_000 });
    await voice.click();
    await page.getByRole("button", { name: "加入语音通话" }).click();
    await expect(page.getByRole("button", { name: "断开连接" }).first()).toBeVisible({ timeout: 25_000 });
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
  const after = await Promise.all(pages.map(mediaSnapshot));
  if (forceRelay) expect(after.every(rows => rows.some(row => row.state === "connected" && row.localType === "relay"))).toBe(true);
  for (let i = 0; i < pages.length; i++) {
    const inbound = (rows: Awaited<ReturnType<typeof mediaSnapshot>>) => rows.flatMap(row => row.rtp).filter(rtp => rtp.direction === "inbound-rtp" && rtp.kind === "audio").reduce((sum, rtp) => sum + rtp.bytes, 0);
    const outbound = (rows: Awaited<ReturnType<typeof mediaSnapshot>>) => rows.flatMap(row => row.rtp).filter(rtp => rtp.direction === "outbound-rtp" && rtp.kind === "audio").reduce((sum, rtp) => sum + rtp.bytes, 0);
    expect(inbound(after[i])).toBeGreaterThan(inbound(before[i]));
    expect(outbound(after[i])).toBeGreaterThan(outbound(before[i]));
  }
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
  const evidence = { result: "PASS", peers: after, cameraReceiver: videoAfter, screenReceiver };
  if (onTarget) {
    const directory = resolve("test-results/cloudflare-target");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "media-stats.json"), JSON.stringify(evidence, null, 2));
    await pages[1].screenshot({ path: resolve(directory, "media-receiver.png"), fullPage: true });
  }
  console.log(JSON.stringify(evidence));
  await Promise.all(pages.map(page => page.context().close()));
});
