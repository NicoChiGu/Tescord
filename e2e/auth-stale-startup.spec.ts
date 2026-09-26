import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

for (const path of ["/", "/invite/7326a0ae"]) {
  for (const mode of [
    "local",
    "session",
    "access-only",
    "saved-only",
  ] as const) {
    test(`invalid retained ${mode} credentials return to login at ${path}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("response", (response) => {
        if (
          response.status() >= 400 &&
          response.status() !== 401 &&
          !(
            path.startsWith("/invite/") &&
            response.status() === 404 &&
            response.url().includes("/api/invites/")
          )
        )
          errors.push(`${response.status()} ${response.url()}`);
      });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !message.text().includes("401") &&
          !(
            path.startsWith("/invite/") &&
            message.text().includes("404 (Not Found)")
          )
        )
          errors.push(message.text());
      });
      await page.addInitScript((mode) => {
        // Seed once so reload verifies that rejected credentials stay cleared.
        if (sessionStorage.getItem("stale-session-seeded")) return;
        sessionStorage.setItem("stale-session-seeded", "true");
        const user = {
          id: "deleted-user",
          email: "deleted@example.test",
          username: "DeletedUser",
          displayName: "Deleted User",
          discriminator: "0001",
          status: "OFFLINE",
        };
        localStorage.setItem("tescord_last_user", JSON.stringify(user));
        const storage = mode === "session" ? sessionStorage : localStorage;
        if (mode !== "saved-only")
          storage.setItem("tescord_access_token", "deleted-access-token");
        if (mode === "local" || mode === "session")
          storage.setItem("tescord_refresh_token", "deleted-refresh-token");
        localStorage.setItem(
          "tescord_saved_accounts",
          JSON.stringify([
            {
              ...user,
              lastActiveAt: Date.now(),
              rememberPassword: mode !== "access-only" && mode !== "session",
              refreshToken:
                mode === "local" || mode === "saved-only"
                  ? "deleted-refresh-token"
                  : undefined,
            },
          ]),
        );
      }, mode);

      await page.goto(path);
      await expect(page.getByTestId("account-picker")).toBeVisible();
      await expect(
        page.getByRole("progressbar", { name: "Loading" }),
      ).toHaveCount(0);
      await expect(page.getByTestId("reauth-modal-backdrop")).toHaveCount(0);
      expect(
        await page.evaluate(() => ({
          localAccess: localStorage.getItem("tescord_access_token"),
          localRefresh: localStorage.getItem("tescord_refresh_token"),
          sessionAccess: sessionStorage.getItem("tescord_access_token"),
          sessionRefresh: sessionStorage.getItem("tescord_refresh_token"),
          saved: JSON.parse(
            localStorage.getItem("tescord_saved_accounts") || "[]",
          ) as Array<{ refreshToken?: string }>,
        })),
      ).toEqual({
        localAccess: null,
        localRefresh: null,
        sessionAccess: null,
        sessionRefresh: null,
        saved: [
          expect.not.objectContaining({ refreshToken: expect.any(String) }),
        ],
      });

      // An anonymous 401 must also settle rather than enter the hidden replay queue.
      expect(
        await page.evaluate(async () => (await fetch("/api/auth/me")).status),
      ).toBe(401);
      await page.reload();
      await expect(page.getByTestId("account-picker")).toBeVisible();
      if (path.startsWith("/invite/")) {
        await expect(page.getByTestId("invite-landing-modal")).toBeVisible();
        await page.getByRole("button", { name: "关闭邀请卡片" }).click();
      }
      await page.getByTestId("use-other-account-btn").click();
      await expect(page.getByTestId("auth-email-input")).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

test("startup 401 still refreshes a valid remembered session", async ({
  page,
  request,
}) => {
  const login = await request.post("/api/auth/login", {
    data: {
      emailOrUsername: "admin@tescord.local",
      password: "adminpassword123",
    },
  });
  expect(login.ok()).toBe(true);
  const tokens: { refreshToken: string } = await login.json();
  await page.addInitScript(({ refreshToken }) => {
    localStorage.setItem("tescord_access_token", "expired-access-token");
    localStorage.setItem("tescord_refresh_token", refreshToken);
  }, tokens);
  await page.goto("/");
  await expect(page.getByTestId("current-user-panel-btn")).toBeVisible();
  await expect(page.getByTestId("reauth-modal-backdrop")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("tescord_refresh_token")),
  ).not.toBe(tokens.refreshToken);
});

test("authenticated invite deep link shows invalid and existing-member states", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const login = await request.post("/api/auth/login", {
    data: {
      emailOrUsername: "admin@tescord.local",
      password: "adminpassword123",
    },
  });
  expect(login.ok()).toBe(true);
  const tokens: { accessToken: string; refreshToken: string } =
    await login.json();
  await page.addInitScript((tokens) => {
    localStorage.setItem("tescord_access_token", tokens.accessToken);
    localStorage.setItem("tescord_refresh_token", tokens.refreshToken);
  }, tokens);
  await page.goto("/invite/7326a0ae");
  const modal = page.getByTestId("invite-landing-modal");
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("heading", { name: "邀请已失效" }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Loading" })).toHaveCount(
    0,
  );
  const invite = await request.post("/api/guilds/gld_default_01/invites", {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
    data: {},
  });
  expect(invite.ok()).toBe(true);
  const { code }: { code: string } = await invite.json();
  await page.goto(`/invite/${code}`);
  await expect(
    modal.getByRole("heading", { name: "Tescord 极客总部" }),
  ).toBeVisible();
  await expect(page.getByTestId("invite-landing-accept-btn")).toContainText(
    "已是该服务器成员",
  );
  await page.getByTestId("invite-landing-accept-btn").click();
  await expect(modal).toHaveCount(0);
  await expect(page).toHaveURL("/");
  expect(errors).toEqual([]);
});
