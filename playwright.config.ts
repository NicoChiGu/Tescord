import { defineConfig, devices } from "@playwright/test";
import { localHttpsCertificateArgument } from "./e2e/helpers/local-https";

// Long media matrices create their own signed accounts. Run them after the UI
// suite so the setup project's short-lived access tokens remain usable there.
const multiplayerTests =
  /(?:media-encryption-device-mesh|media-encryption-lifecycle|voice-mesh-bootstrap)\.spec\.ts/;
const chromiumUse = {
  ...devices["Desktop Chrome"],
  storageState: "test-results/e2e-admin-storage.json",
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      localHttpsCertificateArgument(),
    ],
  },
};

/**
 * Playwright 端到端自动化测试配置
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",
  // Playwright clears outputDir at startup. Keep real-media evidence and validation
  // logs outside this disposable directory so full E2E cannot delete another run.
  outputDir: "test-results/default-e2e",
  /* 并行运行测试 */
  fullyParallel: true,
  /* CI 环境下禁止 test.only */
  forbidOnly: !!process.env.CI,
  /* 失败重试次数 */
  retries: process.env.CI ? 2 : 0,
  /* 并发 worker 数量：音视频房间与全局单例测试需串行执行避免状态竞态 */
  workers: 1,
  /* 控制台与 HTML 报告 */
  reporter: [["list"], ["html", { open: "never" }]],
  /* 通用配置 */
  use: {
    baseURL: "https://localhost:4173",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "zh-CN",
  },

  /* 默认重点测试 Chromium (兼容 Electron 渲染环境) */
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      testIgnore: [/auth\.setup\.ts/, multiplayerTests],
      dependencies: ["setup"],
      use: chromiumUse,
    },
    {
      name: "multiplayer",
      testMatch: multiplayerTests,
      // Single-worker project order keeps these long matrices after UI tests;
      // an unrelated UI failure must not skip the media acceptance matrix.
      dependencies: ["setup"],
      use: chromiumUse,
    },
  ],

  /* 自动启动 Web 预览服务 */
  webServer: [
    {
      command:
        "pnpm --filter @tescord/server exec tsx scripts/run-e2e-server.ts",
      url: "http://127.0.0.1:3101/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: "pnpm --filter @tescord/web preview --port 4173",
      env: { TESCORD_E2E_BACKEND_PORT: "3101" },
      url: "https://localhost:4173",
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
