import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-electron",
  workers: 1,
  timeout: 60000,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report/electron" }],
  ],
  use: { trace: "on", screenshot: "only-on-failure" },
  outputDir: "test-results/electron",
  webServer: [
    {
      command:
        "pnpm --filter @tescord/server exec tsx scripts/run-e2e-server.ts",
      url: "http://127.0.0.1:3101/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "node scripts/build-desktop-web.mjs && pnpm --filter @tescord/web preview --port 4173",
      env: {
        TESCORD_E2E_BACKEND_PORT: "3101",
        VITE_API_URL: "http://127.0.0.1:3101",
        VITE_GATEWAY_URL: "ws://127.0.0.1:3101/gateway",
      },
      url: "https://localhost:4173",
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
