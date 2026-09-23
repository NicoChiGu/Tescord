import { test as setup, expect } from "@playwright/test";
import path from "node:path";

const authFile = path.join(
  process.cwd(),
  "test-results",
  "e2e-admin-storage.json",
);

setup(
  "create a real signed admin session for legacy UI fixtures",
  async ({ request }) => {
    const response = await request.post("/api/auth/login", {
      data: { emailOrUsername: "Jackey", password: "adminpassword123" },
    });
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    let normalResponse = await request.post("/api/auth/login", {
      data: { emailOrUsername: "Alice", password: "alicepassword123" },
    });
    if (!normalResponse.ok()) {
      normalResponse = await request.post("/api/auth/register", {
        data: {
          username: "Alice",
          email: "alice@tescord.local",
          password: "alicepassword123",
        },
      });
    }
    expect(normalResponse.ok()).toBeTruthy();
    const normal = (await normalResponse.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    await request.storageState({ path: authFile });
    const state = JSON.parse(
      await (await import("node:fs/promises")).readFile(authFile, "utf8"),
    );
    state.origins = [
      {
        origin: "https://localhost:4173",
        localStorage: [
          { name: "tescord_access_token", value: body.accessToken },
          { name: "tescord_refresh_token", value: body.refreshToken },
          { name: "tescord_e2e_access_token", value: body.accessToken },
          { name: "tescord_e2e_refresh_token", value: body.refreshToken },
          {
            name: "tescord_e2e_normal_access_token",
            value: normal.accessToken,
          },
          {
            name: "tescord_e2e_normal_refresh_token",
            value: normal.refreshToken,
          },
        ],
      },
    ];
    await (
      await import("node:fs/promises")
    ).writeFile(authFile, JSON.stringify(state), "utf8");
  },
);
