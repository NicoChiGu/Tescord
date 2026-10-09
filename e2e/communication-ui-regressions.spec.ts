import { test, expect } from "@playwright/test";
import { CURRENT_APP_VERSION } from "../apps/web/src/data/changelogs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNw6TiDFTEMLQkAuRFmAZ3Xk4AAAAAASUVORK5CYII=",
  "base64",
);
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) =>
    console.error("Communication UI exception:", error.message),
  );
  await page.addInitScript(
    (version) =>
      localStorage.setItem("tescord_last_seen_changelog_version", version),
    CURRENT_APP_VERSION,
  );
});

test("original image keeps preview while loading, rejects failed decode and retries", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/channels/*/messages*", (route) => {
    const channelId = new URL(route.request().url()).pathname.split("/")[3];
    return route.fulfill({
      json: {
        messages: [
          {
            id: "progress-image",
            channelId,
            content: "",
            sequence: 1,
            authorId: "usr_default_admin",
            author: { id: "usr_default_admin", username: "Jackey" },
            createdAt: new Date().toISOString(),
            attachments: [
              {
                id: "progress-attachment",
                url: "/progress-original.png",
                previewUrl: "/progress-preview.png",
                fileName: "progress.png",
                fileSize: png.length,
                mimeType: "image/png",
                width: 100,
                height: 100,
              },
            ],
          },
        ],
        hasOlder: false,
        hasNewer: false,
      },
    });
  });
  await page.route("**/api/attachments/access", (route) =>
    route.fulfill({
      json: {
        attachments: [
          {
            id: "progress-attachment",
            url: "/progress-original.png",
            previewUrl: "/progress-preview.png",
            expiresAt: Date.now() + 3600000,
          },
        ],
      },
    }),
  );
  await page.route("**/progress-preview.png", (route) =>
    route.fulfill({ contentType: "image/png", body: png }),
  );
  let attempt = 0;
  await page.route("**/progress-original.png", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({
      contentType: "image/png",
      body: ++attempt === 1 ? Buffer.from("invalid image") : png,
    });
  });
  await page.goto("/");
  await page.locator('img[alt="progress.png"]').first().click();
  const modal = page.getByTestId("lightbox-modal");
  const image = modal.locator("img");
  const preview = await image.getAttribute("src");
  await modal.getByRole("button", { name: /^(原图|查看原图)$/ }).click();
  const status = page.getByTestId("lightbox-load-status");
  await expect(status.locator("progress")).toBeVisible();
  await expect(image).toHaveAttribute("src", preview!);
  await expect(
    modal.getByTestId("lightbox-image-info").getByText(/· 原图/),
  ).toHaveCount(0);
  await status.getByRole("button", { name: /重试/ }).click();
  await expect(status).toHaveCount(0);
  await expect(image).not.toHaveAttribute("src", preview!);
  await expect(modal.getByText(/progress.png · 原图/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("older-page spinner preserves first visible message position after prepending", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let olderRequests = 0;
  await page.route("**/api/channels/*/messages*", async (route) => {
    const url = new URL(route.request().url());
    const channelId = url.pathname.split("/")[3];
    const older = url.searchParams.has("before");
    if (older) {
      olderRequests++;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    const first = older ? 1 : 51;
    const messages = Array.from({ length: 50 }, (_, i) => ({
      id: `history-${first + i}`,
      channelId,
      content: `history content ${first + i}`,
      sequence: first + i,
      authorId: "usr_default_admin",
      author: { id: "usr_default_admin", username: "Jackey" },
      createdAt: new Date(1700000000000 + (first + i) * 60000).toISOString(),
    }));
    await route.fulfill({
      json: { messages, hasOlder: !older, hasNewer: false },
    });
  });
  await page.goto("/");
  const scroll = page.getByTestId("chat-scroll-container");
  await expect(page.locator('[data-message-id="history-100"]')).toBeVisible();
  await scroll.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect(
    page.getByTestId("history-older-state").locator(".animate-spin"),
  ).toBeVisible();
  const before = await scroll.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const row = Array.from(
      el.querySelectorAll<HTMLElement>("[data-history-message-id]"),
    ).find((item) => item.getBoundingClientRect().bottom > top)!;
    return {
      id: row.dataset.historyMessageId!,
      offset: row.getBoundingClientRect().top - top,
    };
  });
  await expect(page.getByTestId("history-older-state")).toHaveCount(0);
  await expect
    .poll(async () =>
      scroll.evaluate((el, anchor) => {
        const row = Array.from(
          el.querySelectorAll<HTMLElement>("[data-history-message-id]"),
        ).find((item) => item.dataset.historyMessageId === anchor.id);
        return row
          ? Math.abs(
              row.getBoundingClientRect().top -
                el.getBoundingClientRect().top -
                anchor.offset,
            )
          : 999;
      }, before),
    )
    .toBeLessThan(8);
  expect(olderRequests).toBe(1);
  expect(errors).toEqual([]);
});

test("mobile member profile is above drawer and Escape closes only profile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "成员列表", exact: true }).click();
  const drawer = page.getByTestId("member-list-drawer-panel");
  await expect(drawer).toHaveClass(/translate-x-0/);
  await drawer.locator("[data-member-item]").first().click();
  const profile = page.getByTestId("user-profile-popout");
  await expect(profile).toBeVisible();
  await expect
    .poll(async () =>
      profile.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(rect.left + 25, rect.top + 25),
        );
      }),
    )
    .toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(profile).toHaveCount(0);
  await expect(drawer).toHaveClass(/translate-x-0/);
});

test("mobile channel label long press opens menu while manager handle owns sorting", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("toggle-mobile-drawer-btn").click();
  const label = page.getByTestId("channel-button-general");
  await expect(label).toBeVisible();
  const channelId = await label.getAttribute("data-channel-id");
  const handle = page.getByTestId(`channel-drag-handle-${channelId}`);
  await expect(handle).toBeVisible();
  const size = await handle.boundingBox();
  expect(size!.width).toBeGreaterThanOrEqual(44);
  expect(size!.height).toBeGreaterThanOrEqual(44);
  const cdp = await page.context().newCDPSession(page);
  const markAsRead = page
    .getByRole("dialog")
    .getByRole("button", { name: "标记为已读", exact: true });
  // Coordinate-based CDP touch input needs the drawer's final position.
  // Playwright's actionability trial waits for the label to stop animating.
  await label.click({ trial: true });
  const box = (await label.boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await expect(markAsRead).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.keyboard.press("Escape");
  await expect(markAsRead).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Movement cancels the label timer, preserving scrolling rather than sorting.
  await label.click({ trial: true });
  const movedBox = (await label.boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      {
        x: movedBox.x + movedBox.width / 2,
        y: movedBox.y + movedBox.height / 2,
      },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      {
        x: movedBox.x + movedBox.width / 2,
        y: movedBox.y + movedBox.height / 2 + 20,
      },
    ],
  });
  await page.waitForTimeout(650);
  await expect(markAsRead).toHaveCount(0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await handle.click({ trial: true });
  const handleBox = (await handle.boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      {
        x: handleBox.x + handleBox.width / 2,
        y: handleBox.y + handleBox.height / 2,
      },
    ],
  });
  await expect(
    page.getByTestId(`channel-sortable-${channelId}`),
  ).toHaveAttribute("data-dragging", "true");
  await expect(markAsRead).toHaveCount(0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(
    page.getByTestId(`channel-sortable-${channelId}`),
  ).toHaveAttribute("data-dragging", "false");
  await cdp.detach();
});

test("newer-page loading follows the bottom and keeps existing messages readable", async ({
  page,
}) => {
  let newerRequests = 0;
  await page.route("**/api/channels/*/messages*", async (route) => {
    const url = new URL(route.request().url());
    const channelId = url.pathname.split("/")[3];
    const newer = url.searchParams.has("after");
    if (newer) {
      newerRequests++;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    const first = newer ? 51 : 1;
    const messages = Array.from({ length: 50 }, (_, i) => ({
      id: `newer-${first + i}`,
      channelId,
      content: `newer history ${first + i}`,
      sequence: first + i,
      authorId: "usr_default_admin",
      author: { id: "usr_default_admin", username: "Jackey" },
      createdAt: new Date(1700000000000 + (first + i) * 60000).toISOString(),
    }));
    await route.fulfill({
      json: { messages, hasOlder: false, hasNewer: !newer },
    });
  });
  await page.goto("/");
  await expect(
    page.getByTestId("history-newer-state").locator(".animate-spin"),
  ).toBeVisible();
  await expect(page.locator('[data-message-id="newer-50"]')).toBeVisible();
  await expect(page.getByTestId("history-newer-state")).toHaveCount(0);
  await expect(page.locator('[data-message-id="newer-100"]')).toBeVisible();
  expect(newerRequests).toBe(1);
});

test("missing audio and WebRTC APIs leave chat usable and reject unencrypted voice", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    for (const name of [
      "AudioWorkletNode",
      "RTCRtpSender",
      "RTCRtpReceiver",
      "RTCRtpScriptTransform",
    ])
      Object.defineProperty(window, name, {
        configurable: true,
        value: undefined,
      });
  });
  await page.goto("/");
  await expect(page.getByTestId("chat-scroll-container")).toBeVisible();
  if (page.viewportSize()!.width < 768)
    await page.getByTestId("toggle-mobile-drawer-btn").click();
  await page.getByTestId("channel-button-voice-chat").click();
  await page.getByRole("button", { name: "加入语音通话", exact: true }).click();
  await expect(
    page
      .locator('[role="status"]')
      .filter({ hasText: "此设备不支持媒体端到端加密" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
