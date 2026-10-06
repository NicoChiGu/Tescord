import { test, expect, type Page } from "@playwright/test";
import type { GuildIconProcessRequest } from "@tescord/types";
import { CURRENT_APP_VERSION } from "../apps/web/src/data/changelogs";

const gif = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNw6TiDFTEMLQkAuRFmAZ3Xk4AAAAAASUVORK5CYII=",
  "base64",
);
async function openSettings(page: Page) {
  await page.goto("/");
  if (page.viewportSize()!.width < 768)
    await page.getByTestId("toggle-mobile-drawer-btn").click();
  await page.getByTestId("server-header").click({ button: "right" });
  await page.getByTestId("server-menu-settings-btn").click();
  const modal = page.getByTestId("server-settings-modal");
  await expect(modal).toBeVisible();
  if (page.viewportSize()!.width < 768)
    await modal.getByRole("button", { name: "概况", exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (version) =>
      localStorage.setItem("tescord_last_seen_changelog_version", version),
    CURRENT_APP_VERSION,
  );
});

test("GIF frame selection uses backend crop processing and resets both upload grants", async ({
  page,
}) => {
  const discarded: string[] = [];
  let processed: GuildIconProcessRequest | undefined;
  await page.route("**/api/attachments/presigned-url", (route) =>
    route.fulfill({
      json: {
        uploadUrl: "/ui-gif-upload",
        fileUrl: "/public-assets/ui-source.gif",
        requiresAuth: false,
      },
    }),
  );
  await page.route("**/ui-gif-upload", (route) =>
    route.fulfill({ status: 200 }),
  );
  await page.route("**/api/guilds/*/icon/metadata", (route) =>
    route.fulfill({
      json: { width: 1, height: 1, frames: 3, delays: [100, 100, 100] },
    }),
  );
  await page.route("**/api/guilds/*/icon/preview", (route) =>
    route.fulfill({ body: png, contentType: "image/png" }),
  );
  await page.route("**/api/guilds/*/icon/process", (route) => {
    processed = route.request().postDataJSON() as GuildIconProcessRequest;
    return route.fulfill({ json: { fileUrl: "/public-assets/ui-result.png" } });
  });
  await page.route("**/api/guilds/*/pending-icon", (route) => {
    discarded.push(
      (route.request().postDataJSON() as { fileUrl: string }).fileUrl,
    );
    return route.fulfill({ status: 200, json: { ok: true } });
  });
  await openSettings(page);
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "animated.gif",
    mimeType: "image/gif",
    buffer: gif,
  });
  await expect(page.getByTestId("gif-icon-controls")).toBeVisible();
  await page.getByTestId("gif-icon-static").click();
  await page.getByTestId("gif-icon-frame").fill("2");
  const confirm = page.getByRole("button", { name: "确认并上传", exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByTestId("gif-icon-controls")).toHaveCount(0);
  expect(processed).toMatchObject({
    output: "frame",
    frame: 2,
    fileUrl: "/public-assets/ui-source.gif",
  });
  expect(processed?.crop?.size).toBeGreaterThan(0);
  await expect.poll(() => discarded).toContain("/public-assets/ui-source.gif");
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect.poll(() => discarded).toContain("/public-assets/ui-result.png");
});

test("cancel during GIF upload discards its grant and never installs a late result", async ({
  page,
}) => {
  const discarded: string[] = [];
  await page.route("**/api/attachments/presigned-url", (route) =>
    route.fulfill({
      json: {
        uploadUrl: "/ui-gif-slow-upload",
        fileUrl: "/public-assets/ui-cancel.gif",
        requiresAuth: false,
      },
    }),
  );
  await page.route("**/ui-gif-slow-upload", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 200 }).catch(() => {});
  });
  await page.route("**/api/guilds/*/pending-icon", (route) => {
    discarded.push(
      (route.request().postDataJSON() as { fileUrl: string }).fileUrl,
    );
    return route.fulfill({ status: 200, json: { ok: true } });
  });
  await openSettings(page);
  const upload = page.waitForRequest("**/ui-gif-slow-upload");
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "animated.gif",
    mimeType: "image/gif",
    buffer: gif,
  });
  await upload;
  await page
    .getByRole("dialog", { name: "编辑 GIF 服务器图标" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect.poll(() => discarded).toContain("/public-assets/ui-cancel.gif");
  await expect(page.getByTestId("gif-icon-controls")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "保存更改", exact: true }),
  ).toHaveCount(0);
});

test("reduced motion requests server static GIF variant and hot preference changes restore animation", async ({
  page,
}) => {
  const variants: boolean[] = [];
  await page.addInitScript(() => {
    // The icon fixture owns guild data independently from real Gateway READY.
    (window as unknown as { WebSocket: unknown }).WebSocket = class extends (
      EventTarget
    ) {
      readyState = 3;
      close() {}
      send() {}
    };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/guilds", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const guilds = (await response.json()) as Array<{ iconUrl: string | null }>;
    guilds[0].iconUrl = "/public-assets/ui-reduced-icon.gif";
    await route.fulfill({ response, json: guilds });
  });
  await page.route("**/public-assets/ui-reduced-icon.gif*", (route) => {
    const isStatic =
      new URL(route.request().url()).searchParams.get("static") === "1";
    variants.push(isStatic);
    return route.fulfill({
      body: isStatic ? png : gif,
      contentType: isStatic ? "image/png" : "image/gif",
    });
  });
  await page.goto("/");
  if (page.viewportSize()!.width < 768)
    await page.getByTestId("toggle-mobile-drawer-btn").click();
  const image = page.locator('img[src*="ui-reduced-icon.gif"]').first();
  await expect(image).toHaveAttribute("src", /static=1/);
  await expect.poll(() => variants.length).toBeGreaterThan(0);
  expect(variants.every(Boolean)).toBeTruthy();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(image).not.toHaveAttribute("src", /static=1/);
  await expect.poll(() => variants).toContain(false);
});
