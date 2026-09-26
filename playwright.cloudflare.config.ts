import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-real",
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-cloudflare-report" }],
  ],
  use: {
    baseURL: "https://localhost:4173",
    ignoreHTTPSErrors: true,
    locale: "zh-CN",
  },
  projects: [
    {
      name: "cloudflare-chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command:
        "pnpm --filter @tescord/server exec tsx scripts/run-e2e-server.ts",
      url: "http://127.0.0.1:3101/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: "pnpm --filter @tescord/web preview --port 4173",
      env: { TESCORD_E2E_BACKEND_PORT: "3101" },
      url: "https://localhost:4173",
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
