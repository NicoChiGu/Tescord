import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 端到端自动化测试配置
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",
  /* 并行运行测试 */
  fullyParallel: true,
  /* CI 环境下禁止 test.only */
  forbidOnly: !!process.env.CI,
  /* 失败重试次数 */
  retries: process.env.CI ? 2 : 0,
  /* 并发 worker 数量 */
  workers: process.env.CI ? 1 : 2,
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
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "test-results/e2e-admin-storage.json",
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
  ],

  /* 自动启动 Web 预览服务 */
  webServer: [
    {
      command: "pnpm --filter @tescord/server exec tsx scripts/run-e2e-server.ts",
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: "pnpm --filter @tescord/web preview --port 4173",
      url: "https://localhost:4173",
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
