import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-real",
  outputDir: "test-results/cloudflare-target-browser",
  workers: 1,
  timeout: 120_000,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-cloudflare-report" }],
  ],
  use: {
    baseURL:
      process.env.TESCORD_TARGET_BASE_URL || "https://tescord.terata.top",
    locale: "zh-CN",
  },
  projects: [
    {
      name: "cloudflare-target-chromium",
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
});
