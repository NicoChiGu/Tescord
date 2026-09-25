import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const serverRequire = createRequire(
  resolve(process.cwd(), "apps/server/package.json"),
);
const { PrismaClient } = serverRequire("@prisma/client");
const isolatedDatabase = resolve(
  process.cwd(),
  "apps/server/prisma/tescord-playwright.sqlite",
).replaceAll("\\", "/");

test.describe("session rotation and saved-account recovery", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test("session-only login refreshes without persisting credentials", async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const store = (window as any).useAuthStore;
      await store.getState().login({
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
        rememberMe: false,
      });
      const before = store.getState().refreshToken;
      const refreshed = await store.getState().refreshAuth();
      return {
        refreshed,
        rotated: before !== store.getState().refreshToken,
        persistent: localStorage.getItem("tescord_refresh_token"),
        session: sessionStorage.getItem("tescord_refresh_token"),
      };
    });
    expect(result.refreshed).toBe(true);
    expect(result.rotated).toBe(true);
    expect(result.persistent).toBeNull();
    expect(result.session).toBeTruthy();
  });

  test("temporary refresh outage retains credentials and does not ask for password", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      await (window as any).useAuthStore.getState().login({
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
        rememberMe: true,
      });
    });
    const before = await page.evaluate(() =>
      localStorage.getItem("tescord_refresh_token"),
    );
    await page.route("**/api/auth/refresh", (route) =>
      route.fulfill({ status: 503, body: "{}" }),
    );
    const outcome = await page.evaluate(async () => {
      const store = (window as any).useAuthStore;
      return store.getState().refreshAuth();
    });
    expect(outcome).toBe(false);
    expect(
      await page.evaluate(() => localStorage.getItem("tescord_refresh_token")),
    ).toBe(before);
    expect(
      await page.evaluate(
        () => (window as any).useAuthStore.getState().refreshFailure,
      ),
    ).toBe("transient");
    await expect(page.getByTestId("reauth-modal-backdrop")).not.toBeVisible();
  });

  test("switching A to B and back keeps each remembered login", async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const store = (window as any).useAuthStore;
      await store.getState().login({
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
        rememberMe: true,
      });
      const a = store.getState().user.id;
      store.getState().switchAccount();
      const savedA = store
        .getState()
        .savedAccounts.find((account: any) => account.id === a);
      await store.getState().login({
        emailOrUsername: "alice@tescord.local",
        password: "alicepassword123",
        rememberMe: true,
      });
      const b = store.getState().user.id;
      store.getState().switchAccount();
      const restored = await store.getState().loginWithSavedAccount(savedA);
      return {
        a,
        b,
        saved: Boolean(savedA.refreshToken),
        restored,
        current: store.getState().user?.id,
      };
    });
    expect(result.a).not.toBe(result.b);
    expect(result.saved).toBe(true);
    expect(result.restored).toBe(true);
    expect(result.current).toBe(result.a);
  });

  test("logout revokes the current session", async ({ request }) => {
    const login = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
      },
    });
    expect(login.ok()).toBe(true);
    const tokens = await login.json();
    const revoked = await request.post("/api/auth/logout", {
      data: { refreshToken: tokens.refreshToken },
    });
    expect(revoked.status()).toBe(204);
    const me = await request.get("/api/auth/me", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(me.status()).toBe(401);
    const refresh = await request.post("/api/auth/refresh", {
      data: { refreshToken: tokens.refreshToken },
    });
    expect(refresh.status()).toBe(401);
  });

  test("refresh lifetime is 30 days and rotation is atomic", async ({
    request,
  }) => {
    const login = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
      },
    });
    expect(login.ok()).toBe(true);
    const tokens = await login.json();
    const db = new PrismaClient({
      datasources: { db: { url: `file:${isolatedDatabase}` } },
    });
    try {
      const hash = createHash("sha256")
        .update(tokens.refreshToken)
        .digest("hex");
      const session = await db.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hash },
      });
      const remaining = session.expiresAt.getTime() - Date.now();
      expect(remaining).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
      expect(remaining).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);

      const responses = await Promise.all([
        request.post("/api/auth/refresh", {
          data: { refreshToken: tokens.refreshToken },
        }),
        request.post("/api/auth/refresh", {
          data: { refreshToken: tokens.refreshToken },
        }),
      ]);
      expect(responses.map((res) => res.status()).sort()).toEqual([200, 401]);
      const rotated = await responses
        .find((res) => res.status() === 200)!
        .json();
      expect(await db.refreshToken.count({ where: { id: session.id } })).toBe(
        1,
      );
      expect(await db.refreshToken.count({ where: { tokenHash: hash } })).toBe(
        0,
      );
      await db.refreshToken.update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await request.post("/api/auth/refresh", {
        data: { refreshToken: rotated.refreshToken },
      });
      expect(expired.status()).toBe(401);
      expect((await expired.json()).code).toBe("AUTH_REFRESH_EXPIRED");
    } finally {
      await db.$disconnect();
    }
  });

  test("two tabs share one rotation without losing login", async ({
    context,
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      await (window as any).useAuthStore.getState().login({
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
        rememberMe: true,
      });
    });
    const second = await context.newPage();
    await second.goto("/");
    await expect(second.getByTestId("current-user-panel-btn")).toBeVisible();
    const outcomes = await Promise.all(
      [page, second].map((tab) =>
        tab.evaluate(() =>
          (window as any).useAuthStore.getState().refreshAuth(),
        ),
      ),
    );
    expect(outcomes).toEqual([true, true]);
    expect(
      await page.evaluate(
        () => (window as any).useAuthStore.getState().isAuthenticated,
      ),
    ).toBe(true);
    expect(
      await second.evaluate(
        () => (window as any).useAuthStore.getState().isAuthenticated,
      ),
    ).toBe(true);
    const latest = await second.evaluate(() =>
      localStorage.getItem("tescord_refresh_token"),
    );
    expect(latest).toBe(
      await page.evaluate(() => localStorage.getItem("tescord_refresh_token")),
    );
  });
});
