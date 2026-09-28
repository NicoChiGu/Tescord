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
  const launchApp = () =>
    electron.launch({
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
  let app = await launchApp();
  try {
    const window = await app.firstWindow();
    await expect.poll(() => window.url()).toMatch(/^file:\/\//);
    await expect
      .poll(() =>
        window.evaluate(() => Boolean((window as any).electronAPI?.storage)),
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
          (window as any).electronAPI.storage.getActiveTokens(),
        ),
      )
      .toBeNull();

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
          (await app.windows()).some((page) =>
            page.url().includes("window=auth"),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    const afterLogout = (await app.windows()).find((page) =>
      page.url().includes("window=auth"),
    )!;
    await expect
      .poll(() =>
        afterLogout.evaluate(async () =>
          (window as any).electronAPI.storage.getActiveTokens(),
        ),
      )
      .toBeNull();
    await expect
      .poll(() =>
        afterLogout.evaluate(
          () => (window as any).useAuthStore?.getState().isAuthenticated,
        ),
      )
      .toBe(false);
  } finally {
    await app.close();
  }
});

test("cache IPC stays scoped to each Electron window", async ({}, testInfo) => {
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
    await app.firstWindow();
    await app.evaluate(
      async ({ BrowserWindow }, preloadPath) => {
        for (const name of ["a", "b", "unbound"]) {
          const win = new BrowserWindow({
            show: false,
            webPreferences: {
              preload: preloadPath,
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          });
          await win.loadURL(`data:text/html,<title>scope-${name}</title>`);
        }
      },
      resolve(desktopRoot, "dist/preload.js"),
    );
    await expect
      .poll(async () => (await app.windows()).length)
      .toBeGreaterThanOrEqual(4);
    const pages = await app.windows();
    const byTitle = async (name: string) => {
      for (const page of pages)
        if ((await page.title()) === `scope-${name}`) return page;
      throw new Error(`Missing scope window ${name}`);
    };
    const a = await byTitle("a");
    const b = await byTitle("b");
    const unbound = await byTitle("unbound");
    await expect
      .poll(() =>
        a.evaluate(() => Boolean((window as any).electronAPI?.storage)),
      )
      .toBe(true);
    await expect
      .poll(() =>
        b.evaluate(() => Boolean((window as any).electronAPI?.storage)),
      )
      .toBe(true);

    const unboundRejected = await unbound.evaluate(async () => {
      try {
        await (window as any).electronAPI.storage.getLatestMessages("shared");
        return false;
      } catch (error) {
        return String(error).includes("not bound");
      }
    });
    expect(unboundRejected).toBe(true);

    await Promise.all([
      a.evaluate(() =>
        (window as any).electronAPI.storage.switchUser("scope_a"),
      ),
      b.evaluate(() =>
        (window as any).electronAPI.storage.switchUser("scope_b"),
      ),
    ]);
    await Promise.all([
      a.evaluate(() =>
        (window as any).electronAPI.storage.saveMessages("shared", [
          {
            id: "message-a",
            channelId: "shared",
            sequence: 1,
            authorId: "scope_a",
            content: "A",
            createdAt: new Date().toISOString(),
          },
        ]),
      ),
      b.evaluate(() =>
        (window as any).electronAPI.storage.saveMessages("shared", [
          {
            id: "message-b",
            channelId: "shared",
            sequence: 2,
            authorId: "scope_b",
            content: "B",
            createdAt: new Date().toISOString(),
          },
        ]),
      ),
    ]);
    const [aMessages, bMessages] = await Promise.all([
      a.evaluate(async () =>
        (
          await (window as any).electronAPI.storage.getLatestMessages("shared")
        ).map((message: any) => message.content),
      ),
      b.evaluate(async () =>
        (
          await (window as any).electronAPI.storage.getLatestMessages("shared")
        ).map((message: any) => message.content),
      ),
    ]);
    expect(aMessages).toEqual(["A"]);
    expect(bMessages).toEqual(["B"]);

    const invalidKeepsBinding = await a.evaluate(async () => {
      const storage = (window as any).electronAPI.storage;
      const invalid = await storage.switchUser("../scope_b").then(
        () => false,
        () => true,
      );
      const messages = await storage.getLatestMessages("shared");
      return {
        invalid,
        contents: messages.map((message: any) => message.content),
      };
    });
    expect(invalidKeepsBinding).toEqual({ invalid: true, contents: ["A"] });
  } finally {
    await app.close();
  }
});
