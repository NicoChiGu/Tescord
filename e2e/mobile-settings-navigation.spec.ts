import { expect, test, type Page } from "@playwright/test";

const openInitialDrawer = async (page: Page) => {
  const button = page
    .getByTitle("打开频道与服务器抽屉")
    .or(page.getByTestId("toggle-mobile-drawer-btn"))
    .or(page.getByTestId("mobile-open-drawer-btn"))
    .first();
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.click();
  await expect(page.getByTestId("home-nav-button")).toBeVisible();
};

const expectDetailFits = async (page: Page, testId: string) => {
  const detail = page.getByTestId(testId);
  await expect(detail).toBeVisible();
  const bounds = await detail.boundingBox();
  const width = page.viewportSize()!.width;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
  expect(bounds!.width).toBeGreaterThan(width - 4);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(width + 2);
};

test("320px 用户设置目录和详情均可阅读，返回保留表单", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await openInitialDrawer(page);
  await page.getByTestId("user-settings-gear-btn").click();

  await expect(page.getByTestId("user-settings-detail")).toBeVisible();
  await page.getByTestId("user-settings-back").click();
  await expect(page.getByTestId("user-settings-menu")).toBeVisible();
  await expect(page.getByTestId("user-settings-detail")).toBeHidden();
  await page.getByTestId("tab-profile-btn").click();
  await expectDetailFits(page, "user-settings-detail");
  const nameInput = page.getByTestId("profile-display-name-input");
  await nameInput.fill("Mobile Draft");
  await page.getByTestId("user-settings-back").click();
  await expect(page.getByTestId("user-settings-menu")).toBeVisible();
  await page.getByTestId("tab-profile-btn").click();
  await expect(nameInput).toHaveValue("Mobile Draft");
  await page.getByTestId("reset-profile-changes-btn").click();
  await page.getByTestId("close-user-settings-mobile-btn").click();
  expect(errors).toEqual([]);
});

test("390px 私信主页可以打开服务器列表并进入服务器", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  await openInitialDrawer(page);
  await page.getByTestId("home-nav-button").click();
  await expect(page.getByTestId("friends-open-server-menu")).toBeVisible();
  await page.getByTestId("friends-open-server-menu").click();
  const server = page
    .getByRole("button", { name: /Tescord 极客总部|极客/i })
    .first();
  await expect(server).toBeVisible();
  await server.click();
  await expect(page.getByTestId("home-nav-button")).toBeHidden();
  expect(errors).toEqual([]);
});

test("375px 管理后台使用目录和全宽详情", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await openInitialDrawer(page);
  await page.getByTestId("admin-dashboard-btn").click();
  await expect(page.getByTestId("admin-settings-menu")).toBeVisible();
  await page.getByTestId("admin-tab-users").click();
  await expect(page.getByTestId("admin-settings-menu")).toBeHidden();
  await expectDetailFits(page, "admin-settings-detail");
  await page.getByTestId("admin-settings-back").click();
  await expect(page.getByTestId("admin-settings-menu")).toBeVisible();
  await page.getByRole("button", { name: "关闭管理后台" }).click();
  expect(errors).toEqual([]);
});

test("390px 服务器设置目录切换后内容占满屏宽", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  await openInitialDrawer(page);
  const server = page
    .getByRole("button", { name: /Tescord 极客总部|极客/i })
    .first();
  await expect(server).toBeVisible();
  await server.click();
  await page.getByTestId("toggle-mobile-drawer-btn").click();
  await page.getByTestId("mobile-server-settings-btn").click();
  await expect(page.getByTestId("server-settings-menu")).toBeVisible();
  await page.getByTestId("server-settings-roles-tab").click();
  await expect(page.getByTestId("server-settings-menu")).toBeHidden();
  await expectDetailFits(page, "server-settings-detail");
  await page.getByTestId("server-settings-back").click();
  await expect(page.getByTestId("server-settings-menu")).toBeVisible();
  await page.getByRole("button", { name: "关闭服务器设置" }).click();
  expect(errors).toEqual([]);
});
