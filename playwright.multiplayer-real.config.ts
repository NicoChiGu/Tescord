import { defineConfig, devices } from "@playwright/test";
import { localHttpsCertificateArgument } from "./e2e/helpers/local-https";

if (process.env.TESCORD_TARGET_BASE_URL)
  throw new Error(
    "Multiplayer acceptance only permits its isolated local server",
  );
if (
  !/^tescord-real-media-[a-f0-9-]{36}\.sqlite$/.test(
    process.env.TESCORD_REAL_MEDIA_DATABASE || "",
  )
)
  throw new Error("Start with node scripts/run-real-multiplayer.mjs");

export default defineConfig({
  testDir: "./e2e-real",
  testMatch: "multiplayer-encrypted-sfu.spec.ts",
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-multiplayer-report" }],
  ],
  outputDir: `test-results/multiplayer-real/${process.env.TESCORD_REAL_MEDIA_DATABASE!.slice("tescord-real-media-".length, -".sqlite".length)}`,
  use: {
    baseURL: "https://localhost:4174",
    ignoreHTTPSErrors: true,
    locale: "zh-CN",
    // The helper saves a separate complete trace for every signed device.
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: ["auto", "relay"].map((name) => ({
    name,
    use: {
      ...devices["Desktop Chrome"],
      launchOptions: {
        args: [
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          "--autoplay-policy=no-user-gesture-required",
          localHttpsCertificateArgument(),
        ],
      },
    },
  })),
  webServer: [
    {
      command:
        "pnpm --filter @tescord/server exec tsx scripts/run-e2e-server.ts",
      env: {
        TESCORD_REAL_MEDIA: "1",
        TESCORD_REAL_MEDIA_DATABASE: process.env.TESCORD_REAL_MEDIA_DATABASE!,
      },
      url: "http://127.0.0.1:3102/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "pnpm --filter @tescord/web preview --port 4174 --outDir build/real-media",
      env: { TESCORD_E2E_BACKEND_PORT: "3102" },
      url: "https://localhost:4174",
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
