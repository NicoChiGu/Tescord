import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const desktopRoot = resolve(process.cwd(), "apps/desktop");
const desktopRequire = createRequire(resolve(desktopRoot, "package.json"));

test("real Electron loads file:// and restores a remembered account", async ({}, testInfo) => {
  const userData = testInfo.outputPath("user-data");
  await mkdir(userData, { recursive: true });
  const app = await electron.launch({
    executablePath: desktopRequire("electron"),
    args: [desktopRoot],
    env: {
      ...process.env,
      TESCORD_E2E_USER_DATA_DIR: userData,
      TESCORD_E2E_FORCE_FILE: "true",
      TESCORD_E2E_SKIP_SINGLE_INSTANCE: "true",
      NODE_ENV: "development",
    },
    timeout: 15000,
  });
  try {
    const window = await app.firstWindow();
    await expect.poll(() => window.url()).toMatch(/^file:\/\//);
    await expect(window.getByTestId("auth-email-input")).toBeVisible();
    await window.getByTestId("auth-email-input").fill("admin@tescord.local");
    await window.getByTestId("auth-submit-btn").click();
    await window.getByTestId("auth-password-input").fill("adminpassword123");
    const mainWindowPromise = app.waitForEvent("window", {
      predicate: (candidate) => candidate !== window,
    });
    await window.getByTestId("auth-submit-btn").click();
    const mainWindow = await mainWindowPromise;
    await expect(mainWindow.getByTestId("current-user-panel-btn")).toBeVisible({
      timeout: 15000,
    });
    const session = await mainWindow.evaluate(() => ({
      access: Boolean(localStorage.getItem("tescord_access_token")),
      refresh: Boolean(localStorage.getItem("tescord_refresh_token")),
      api: (window as any).useAuthStore.getState().isAuthenticated,
    }));
    expect(session).toEqual({ access: true, refresh: true, api: true });
  } finally {
    await app.close();
  }
});
