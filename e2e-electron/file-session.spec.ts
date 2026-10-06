import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const desktopRoot = resolve(process.cwd(), "apps/desktop");
const desktopRequire = createRequire(resolve(desktopRoot, "package.json"));

test("real Electron keeps remembered credentials in native storage", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const userData = testInfo.outputPath("user-data");
  await mkdir(userData, { recursive: true });
  const launchApp = async () => {
    const launched = await electron.launch({
      executablePath: desktopRequire("electron"),
      args: [desktopRoot],
      env: {
        ...process.env,
        TESCORD_E2E_USER_DATA_DIR: userData,
        TESCORD_E2E_FORCE_FILE: "true",
        TESCORD_E2E_SKIP_SINGLE_INSTANCE: "true",
        NODE_ENV: "development",
      },
      timeout: 45000,
    });
    return launched;
  };
  let app = await launchApp();
  try {
    const window = await app.firstWindow();
    await expect.poll(() => window.url()).toMatch(/^file:\/\//);
    await expect(window.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      "./favicon.svg",
    );
    await expect(window.locator('script[type="module"]')).toHaveAttribute(
      "src",
      /^\.\/assets\//,
    );
    await expect
      .poll(() =>
        window.evaluate(() =>
          Boolean(
            (window as any).electronAPI?.storage &&
            (window as any).electronAPI?.syncTrayUnread,
          ),
        ),
      )
      .toBe(true);
    await expect(window.getByTestId("auth-email-input")).toBeVisible({
      timeout: 30_000,
    });
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
    await expect
      .poll(async () =>
        mainWindow.evaluate(async () => {
          const storage = (window as any).electronAPI.storage;
          const accounts = await storage.getSavedAccounts();
          const active = await storage.getActiveTokens();
          return {
            accounts: accounts.some((account: any) =>
              Boolean(account.refreshToken),
            ),
            active: Boolean(active?.remember && active.refreshToken),
            localAccess: localStorage.getItem("tescord_access_token"),
            localRefresh: localStorage.getItem("tescord_refresh_token"),
            localAccounts: JSON.stringify(
              JSON.parse(
                localStorage.getItem("tescord_saved_accounts") || "[]",
              ),
            ).includes("refreshToken"),
            authenticated: (window as any).useAuthStore.getState()
              .isAuthenticated,
          };
        }),
      )
      .toEqual({
        accounts: true,
        active: true,
        localAccess: null,
        localRefresh: null,
        localAccounts: false,
        authenticated: true,
      });

    await app.close();
    app = await launchApp();
    const restoredMain = await app.firstWindow();
    await expect.poll(() => restoredMain.url()).toMatch(/^file:\/\//);
    await expect(
      restoredMain.getByTestId("current-user-panel-btn"),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() =>
        restoredMain.evaluate(
          async () =>
            (await (window as any).electronAPI.storage.getActiveTokens())
              ?.remember,
        ),
      )
      .toBe(true);

    await expect
      .poll(() =>
        restoredMain.evaluate(
          () => (window as any).useAuthStore.getState().isLoading,
        ),
      )
      .toBe(false);
    await restoredMain.evaluate(async () => {
      await (window as any).useAuthStore.getState().login({
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
        rememberMe: false,
      });
    });
    await expect
      .poll(async () =>
        restoredMain.evaluate(async () => ({
          activeRemember: (
            await (window as any).electronAPI.storage.getActiveTokens()
          )?.remember,
          localRefresh: localStorage.getItem("tescord_refresh_token"),
          sessionRefresh: Boolean(
            sessionStorage.getItem("tescord_refresh_token"),
          ),
        })),
      )
      .toEqual({
        activeRemember: false,
        localRefresh: null,
        sessionRefresh: true,
      });
    await expect
      .poll(() =>
        restoredMain.evaluate(async () =>
          (await (window as any).electronAPI.storage.getSavedAccounts()).map(
            (account: any) => ({
              remember: account.rememberPassword,
              hasRefresh: Boolean(account.refreshToken),
            }),
          ),
        ),
      )
      .toEqual([{ remember: false, hasRefresh: false }]);

    await app.close();
    app = await launchApp();
    await expect
      .poll(
        async () =>
          (await app.windows()).some((page) =>
            page.url().includes("window=auth"),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    const freshAuth = (await app.windows()).find((page) =>
      page.url().includes("window=auth"),
    )!;
    await freshAuth.waitForLoadState("domcontentloaded");
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (win) =>
              win.webContents.getURL().includes("window=auth") &&
              win.isVisible(),
          ),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        freshAuth.evaluate(
          () => (window as any).useAuthStore?.getState().isAuthenticated,
        ),
      )
      .toBe(false);
    await expect
      .poll(() =>
        freshAuth.evaluate(async () =>
          Boolean(await (window as any).electronAPI.storage.getActiveTokens()),
        ),
      )
      .toBe(false);

    await expect(freshAuth.getByTestId("use-other-account-btn")).toBeVisible();
    await freshAuth.getByTestId("use-other-account-btn").click();
    await freshAuth.getByTestId("auth-email-input").fill("admin@tescord.local");
    await freshAuth.getByTestId("auth-submit-btn").click();
    await freshAuth.getByTestId("auth-password-input").fill("adminpassword123");
    const logoutMainPromise = app.waitForEvent("window", {
      predicate: (candidate) => candidate !== freshAuth,
    });
    await freshAuth.getByTestId("auth-submit-btn").click();
    const logoutMain = await logoutMainPromise;
    await expect(logoutMain.getByTestId("current-user-panel-btn")).toBeVisible({
      timeout: 30_000,
    });
    await logoutMain.evaluate(() => {
      void (window as any).useAuthStore.getState().logout();
    });
    await expect
      .poll(
        async () =>
          (await app.windows()).some(
            (page) => page !== freshAuth && page.url().includes("window=auth"),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    const afterLogout = (await app.windows()).find(
      (page) => page !== freshAuth && page.url().includes("window=auth"),
    )!;
    await expect
      .poll(() =>
        afterLogout.evaluate(
          () => (window as any).useAuthStore?.getState().isLoading,
        ),
      )
      .toBe(false);
    await expect
      .poll(() =>
        afterLogout.evaluate(async () =>
          Boolean(await (window as any).electronAPI.storage.getActiveTokens()),
        ),
      )
      .toBe(false);
    await expect
      .poll(() =>
        afterLogout.evaluate(
          () => (window as any).useAuthStore?.getState().isAuthenticated,
        ),
      )
      .toBe(false);
    await expect(afterLogout.getByTestId("account-picker")).toBeVisible();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => {
          const windows = BrowserWindow.getAllWindows();
          return (
            windows.length === 1 &&
            windows[0].isVisible() &&
            windows[0].webContents.getURL().includes("window=auth")
          );
        }),
      )
      .toBe(true);
  } catch (error) {
    console.error("Credential scenario failed before cleanup", String(error));
    throw error;
  } finally {
    await app.close();
  }
});

test("cache IPC rejects untrusted windows and isolates users", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const userData = testInfo.outputPath("scope-user-data");
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
    timeout: 45_000,
  });
  try {
    const trusted = await app.firstWindow();
    await expect(trusted.getByTestId("auth-email-input")).toBeVisible({
      timeout: 30_000,
    });
    await app.evaluate(
      async ({ BrowserWindow }, preloadPath) => {
        const win = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        await win.loadURL("data:text/html,<title>scope-untrusted</title>");
      },
      resolve(desktopRoot, "dist/preload.js"),
    );
    await expect
      .poll(async () => (await app.windows()).length)
      .toBeGreaterThanOrEqual(2);
    // Playwright pages are resolved asynchronously; select by title explicitly.
    let foreignWindow;
    for (const page of await app.windows()) {
      if ((await page.title()) === "scope-untrusted") foreignWindow = page;
    }
    expect(foreignWindow).toBeDefined();
    await expect
      .poll(() =>
        foreignWindow!.evaluate(() =>
          Boolean((window as any).electronAPI?.storage),
        ),
      )
      .toBe(true);
    const foreignRejected = await foreignWindow!.evaluate(async () => {
      const storage = (window as any).electronAPI.storage;
      const attempts = await Promise.allSettled([
        storage.getLatestMessages("shared"),
        storage.switchUser("scope_a"),
      ]);
      return attempts.map(
        (result) =>
          result.status === "rejected" &&
          String(result.reason).includes("Untrusted IPC sender"),
      );
    });
    expect(foreignRejected).toEqual([true, true]);

    const cacheContents = await trusted.evaluate(async () => {
      const storage = (window as any).electronAPI.storage;
      const contents = async () =>
        (await storage.getLatestMessages("shared")).map(
          (message: any) => message.content,
        );
      await storage.switchUser("scope_a");
      await storage.saveMessages("shared", [
        {
          id: "message-a",
          channelId: "shared",
          sequence: 1,
          authorId: "scope_a",
          content: "A",
          createdAt: new Date().toISOString(),
        },
      ]);
      const aFirst = await contents();
      await storage.switchUser("scope_b");
      const bBefore = await contents();
      await storage.saveMessages("shared", [
        {
          id: "message-b",
          channelId: "shared",
          sequence: 2,
          authorId: "scope_b",
          content: "B",
          createdAt: new Date().toISOString(),
        },
      ]);
      const bAfter = await contents();
      await storage.switchUser("scope_a");
      const aAgain = await contents();
      const invalid = await storage.switchUser("../scope_b").then(
        () => false,
        () => true,
      );
      return {
        aFirst,
        bBefore,
        bAfter,
        aAgain,
        invalid,
        afterInvalid: await contents(),
      };
    });
    expect(cacheContents).toEqual({
      aFirst: ["A"],
      bBefore: [],
      bAfter: ["B"],
      aAgain: ["A"],
      invalid: true,
      afterInvalid: ["A"],
    });
  } finally {
    await app.close();
  }
});
