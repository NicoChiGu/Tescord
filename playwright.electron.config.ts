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
      command: "pnpm --filter @tescord/web preview --port 4173",
      env: { TESCORD_E2E_BACKEND_PORT: "3101" },
      url: "https://localhost:4173",
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
