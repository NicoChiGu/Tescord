import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  outputDir: "test-results/communication-webkit",
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: "playwright-report/communication-webkit" },
    ],
  ],
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "webkit-iphone",
      dependencies: ["setup"],
      testMatch:
        /(?:communication-ui-regressions|gif-icon-editor|model-download-progress)\.spec\.ts/,
      // This one test uses Chromium's native CDP touch injection; it runs in the full Chromium gate.
      grepInvert: /mobile channel label long press/,
      use: {
        ...devices["iPhone 13"],
        storageState: "test-results/e2e-admin-storage.json",
      },
    },
  ],
});
