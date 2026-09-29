import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

declare global {
  interface Window {
    __dmAcceptancePcs: RTCPeerConnection[];
    __dmEncodedHooks: { send: number; receive: number };
  }
}

async function snapshot(page: Page) {
  return page.evaluate(async () =>
    Promise.all(
      (window.__dmAcceptancePcs || []).map(async (pc) => {
        const report = await pc.getStats();
        const selectedPairId = [...report.values()].find(
          (item) => item.type === "transport" && item.selectedCandidatePairId,
        )?.selectedCandidatePairId;
        const pair = report.get(selectedPairId || "");
        const rtp = [...report.values()]
          .filter(
            (item) =>
              item.type === "inbound-rtp" || item.type === "outbound-rtp",
          )
          .map((item) => ({
            direction: item.type,
            kind: item.kind,
            bytes: item.bytesReceived || item.bytesSent || 0,
            codec: report.get(item.codecId)?.mimeType || null,
          }));
        return {
          state: pc.connectionState,
          localCandidateType:
            report.get(pair?.localCandidateId)?.candidateType || null,
          remoteCandidateType:
            report.get(pair?.remoteCandidateId)?.candidateType || null,
          rtp,
        };
      }),
    ),
  );
}

test("public DM call negotiates E2EE and exchanges audio after Cloudflare SFU fallback", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const marker = process.env.TESCORD_ACCEPTANCE_MARKER || "";
  if (!/^[a-f0-9]{10}$/.test(marker))
    throw new Error(
      "TESCORD_ACCEPTANCE_MARKER must be ten lowercase hex characters",
    );
  const adminUsername =
    process.env.TESCORD_ACCEPTANCE_ADMIN_USERNAME ||
    `AcceptanceAdmin_${marker}`;
  if (adminUsername !== `AcceptanceAdmin_${marker}`)
    throw new Error(
      "Acceptance admin username does not match the cleanup marker",
    );
  const directory = resolve("test-results/cloudflare-target");
  const resourcesPath = resolve(directory, "resources.json");
  await mkdir(directory, { recursive: true });
  let previousResources: Record<string, string> = {};
  try {
    previousResources = JSON.parse(
      await readFile(resourcesPath, "utf8"),
    ) as Record<string, string>;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  if (
    !previousResources ||
    Array.isArray(previousResources) ||
    typeof previousResources !== "object" ||
    Object.keys(previousResources).some(
      (key) => key !== "marker" && key !== "adminUserId",
    ) ||
    (previousResources.marker !== undefined &&
      previousResources.marker !== marker) ||
    (previousResources.adminUserId !== undefined &&
      typeof previousResources.adminUserId !== "string")
  )
    throw new Error("Acceptance resource manifest contains another test run");
  const resources: Record<string, string | string[]> = {
    ...previousResources,
    marker,
  };
  const saveResources = async () => {
    const temporaryPath = `${resourcesPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(resources, null, 2));
    await rename(temporaryPath, resourcesPath);
  };
  const admin = await request.post("/api/auth/login", {
    data: {
      emailOrUsername: adminUsername,
      password: process.env.TESCORD_ACCEPTANCE_ADMIN_PASSWORD,
    },
  });
  expect(admin.ok()).toBeTruthy();
  const adminSession = (await admin.json()) as {
    accessToken: string;
    user: { id: string };
  };
  const adminToken = adminSession.accessToken;
  if (resources.adminUserId && resources.adminUserId !== adminSession.user.id)
    throw new Error("Acceptance manifest admin ID does not match login");
  resources.adminUserId = adminSession.user.id;
  await saveResources();
  const registration = await request.post("/api/admin/registration-invites", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { note: `Cloudflare acceptance ${marker}`, maxUses: 2 },
  });
  expect(registration.ok()).toBeTruthy();
  const inviteCode = (await registration.json()).code as string;
  resources.registrationInviteCode = inviteCode;
  await saveResources();
  const users = [] as Array<{ id: string; token: string }>;
  for (const label of ["alice", "bob"]) {
    const result = await request.post("/api/auth/register", {
      data: {
        username: `${label}_${marker}`,
        email: `${label}-${marker}@example.invalid`,
        password: randomBytes(24).toString("base64url"),
        inviteCode,
      },
    });
    expect(result.ok()).toBeTruthy();
    const data = await result.json();
    users.push({ id: data.user.id, token: data.accessToken });
    resources[`${label}UserId`] = data.user.id;
    await saveResources();
  }
  const guild = await request.post("/api/guilds", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { name: `Cloudflare acceptance ${marker}` },
  });
  expect(guild.ok()).toBeTruthy();
  const guildId = (await guild.json()).id as string;
  resources.guildId = guildId;
  await saveResources();
  const channelsResponse = await request.get(
    `/api/guilds/${guildId}/channels`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  expect(channelsResponse.ok()).toBeTruthy();
  resources.channelIds = (
    (await channelsResponse.json()) as Array<{ id: string }>
  ).map((channel) => channel.id);
  await saveResources();
  for (const user of users) {
    const invitation = await request.post(`/api/guilds/${guildId}/invites`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { maxUses: 1 },
    });
    expect(invitation.ok()).toBeTruthy();
    const code = (await invitation.json()).code as string;
    resources.guildInviteCodes = [
      ...((resources.guildInviteCodes as string[] | undefined) || []),
      code,
    ];
    await saveResources();
    const joined = await request.post(`/api/invites/${code}/join`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(joined.ok()).toBeTruthy();
  }
  const dm = await request.post("/api/users/@me/channels", {
    headers: { Authorization: `Bearer ${users[0].token}` },
    data: { recipientId: users[1].id },
  });
  expect(dm.ok()).toBeTruthy();
  const dmId = (await dm.json()).id as string;
  resources.dmChannelId = dmId;
  await saveResources();

  const pages: Page[] = [];
  const diagnostics: Array<
    Array<{ event: string; status?: number; detail?: string }>
  > = [[], []];
  for (const user of users) {
    const index = pages.length;
    const context = await browser.newContext({
      permissions: ["microphone", "camera"],
      locale: "zh-CN",
    });
    await context.addInitScript((token) => {
      localStorage.setItem("tescord_access_token", token);
      localStorage.setItem("tescord_last_seen_changelog_version", "0.2.0");
      const NativePC = window.RTCPeerConnection;
      window.__dmAcceptancePcs = [];
      window.__dmEncodedHooks = { send: 0, receive: 0 };
      let blockFirstOffer = true;
      window.RTCPeerConnection = class extends NativePC {
        constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
          super(...args);
          if (blockFirstOffer) {
            blockFirstOffer = false;
            this.createOffer = async () => {
              throw new Error("Acceptance test blocks P2P offer");
            };
          }
          window.__dmAcceptancePcs.push(this);
        }
      };
      const senderProto = RTCRtpSender.prototype as RTCRtpSender & {
        createEncodedStreams?: () => unknown;
      };
      const receiverProto = RTCRtpReceiver.prototype as RTCRtpReceiver & {
        createEncodedStreams?: () => unknown;
      };
      for (const [prototype, direction] of [
        [senderProto, "send"],
        [receiverProto, "receive"],
      ] as const) {
        const native = prototype.createEncodedStreams;
        if (typeof native !== "function") continue;
        prototype.createEncodedStreams = function () {
          window.__dmEncodedHooks[direction]++;
          return native.call(this);
        };
      }
    }, user.token);
    const page = await context.newPage();
    page.on("console", (message) => {
      if (
        message.type() === "error" ||
        message.type() === "warning" ||
        /VoiceEngine|VoiceMesh|CF Realtime|Cloudflare|DM 呼叫|语音服务/.test(
          message.text(),
        )
      )
        diagnostics[index].push({
          event: message.type(),
          detail: message.text().slice(0, 200),
        });
    });
    page.on("websocket", (socket) =>
      socket.on("framereceived", (frame) => {
        try {
          const packet = JSON.parse(String(frame.payload));
          if (
            typeof packet.t === "string" &&
            (packet.t.startsWith("CALL_") || packet.t === "P2P_SIGNAL")
          )
            diagnostics[index].push({
              event: packet.t,
              detail:
                packet.t === "P2P_SIGNAL"
                  ? packet.d?.type
                  : packet.d?.state || packet.d?.reason,
            });
        } catch {
          /* Ignore unrelated frames. */
        }
      }),
    );
    page.on("websocket", (socket) =>
      socket.on("framesent", (frame) => {
        try {
          const packet = JSON.parse(String(frame.payload));
          if (typeof packet.t === "string" && packet.t.startsWith("CALL_"))
            diagnostics[index].push({ event: `sent_${packet.t}` });
        } catch {
          /* Ignore unrelated frames. */
        }
      }),
    );
    page.on("pageerror", (error) =>
      diagnostics[index].push({
        event: "pageerror",
        detail: error.message.slice(0, 200),
      }),
    );
    page.on("response", (response) => {
      if (response.url().includes("/api/cloudflare-realtime/"))
        diagnostics[index].push({
          event: new URL(response.url()).pathname,
          status: response.status(),
        });
      if (response.url().includes("/e2ee/"))
        diagnostics[index].push({
          event: new URL(response.url()).pathname,
          status: response.status(),
        });
    });
    pages.push(page);
    await page.goto("/");
    await expect(page.getByTestId("current-user-panel-btn")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole("button", {
        name: `Cloudflare acceptance ${marker}`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "私信与主页" }).click();
    await expect(page.getByText("直接消息", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId(`dm-item-${dmId}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`dm-item-${dmId}`).click();
    await expect(page.getByTestId("dm-start-voice-call-btn")).toBeVisible();
  }
  await pages[0].getByTestId("dm-start-voice-call-btn").click();
  await expect(pages[1].getByTestId("accept-call-btn")).toBeVisible({
    timeout: 15_000,
  });
  await expect(pages[1].getByTestId("dm-call-encryption-status")).toContainText(
    "E2EE",
    { timeout: 15_000 },
  );
  await pages[1].getByTestId("accept-call-btn").click();
  await pages[1].waitForTimeout(1500);
  console.log(
    JSON.stringify({
      stage: "dm_after_accept",
      diagnostics,
      incomingVisible: await pages[1]
        .getByTestId("accept-call-btn")
        .isVisible()
        .catch(() => false),
    }),
  );
  try {
    await expect
      .poll(
        async () => {
          const rows = await Promise.all(pages.map(snapshot));
          return rows.every((pcs) =>
            pcs.some(
              (pc) =>
                pc.state === "connected" &&
                pc.rtp.some(
                  (item) =>
                    item.direction === "outbound-rtp" &&
                    item.kind === "audio" &&
                    item.bytes > 1000,
                ) &&
                pc.rtp.some(
                  (item) =>
                    item.direction === "inbound-rtp" &&
                    item.kind === "audio" &&
                    item.bytes > 1000,
                ),
            ),
          );
        },
        { timeout: 45_000 },
      )
      .toBe(true);
    const hooks = await Promise.all(
      pages.map((page) => page.evaluate(() => window.__dmEncodedHooks)),
    );
    for (const hook of hooks) {
      expect(hook.send).toBeGreaterThan(0);
      expect(hook.receive).toBeGreaterThan(0);
    }
    const before = await Promise.all(pages.map(snapshot));
    for (const peers of before) {
      expect(peers.length).toBeGreaterThanOrEqual(2);
      expect(peers[0].state).toBe("closed");
      expect(
        peers.some(
          (peer) => peer.state === "connected" && peer.localCandidateType,
        ),
      ).toBe(true);
    }
    for (const rows of diagnostics) {
      expect(
        rows.some(
          (item) => item.event.endsWith("/session/new") && item.status === 200,
        ),
      ).toBe(true);
      expect(
        rows.some(
          (item) =>
            item.event.endsWith("/tracks/publish") && item.status === 200,
        ),
      ).toBe(true);
    }
    await pages[0].waitForTimeout(1500);
    const after = await Promise.all(pages.map(snapshot));
    for (let index = 0; index < pages.length; index++) {
      for (const direction of ["inbound-rtp", "outbound-rtp"]) {
        const bytes = (rows: Awaited<ReturnType<typeof snapshot>>) =>
          rows
            .flatMap((pc) => pc.rtp)
            .filter(
              (item) => item.kind === "audio" && item.direction === direction,
            )
            .reduce((total, item) => total + item.bytes, 0);
        expect(bytes(after[index])).toBeGreaterThan(bytes(before[index]));
      }
    }
    const directory = resolve("test-results/cloudflare-target");
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "dm-media-stats.json"),
      JSON.stringify(
        {
          before,
          after,
          hooks,
          cloudflareStatuses: diagnostics.map((rows) =>
            rows.filter((item) =>
              item.event.startsWith("/api/cloudflare-realtime/"),
            ),
          ),
        },
        null,
        2,
      ),
    );
    await pages[1].screenshot({
      path: resolve(directory, "dm-call.png"),
      fullPage: true,
    });
  } catch (error) {
    console.log(
      JSON.stringify({
        stage: "dm_media",
        stats: await Promise.all(pages.map(snapshot)),
        hooks: await Promise.all(
          pages.map((page) => page.evaluate(() => window.__dmEncodedHooks)),
        ),
        voiceUi: await Promise.all(
          pages.map((page) =>
            page.getByRole("button", { name: "断开连接" }).count(),
          ),
        ),
        diagnostics,
      }),
    );
    throw error;
  } finally {
    await Promise.all(pages.map((page) => page.context().close()));
  }
});
