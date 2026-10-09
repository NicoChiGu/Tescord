import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  outputDir: "test-results/audio-output",
  projects: base.projects
    ?.filter(
      (project) => project.name === "setup" || project.name === "chromium",
    )
    .map((project) => ({
      ...project,
      testMatch:
        project.name === "chromium"
          ? /audio-output.*\.spec\.ts/
          : project.testMatch,
      use: {
        ...project.use,
        channel: process.env.TESCORD_E2E_BROWSER_CHANNEL || "chrome",
      },
    })),
});
