import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("packaged Windows app loads its bundled file UI with an isolated profile", async ({}, testInfo) => {
  const executablePath = process.env.TESCORD_E2E_PACKAGED_EXE;
  test.skip(!executablePath, "Set TESCORD_E2E_PACKAGED_EXE to the packaged Tescord.exe");
  const userData = testInfo.outputPath("packaged-user-data");
  await mkdir(userData, { recursive: true });
  const app = await electron.launch({
    executablePath: executablePath!,
    env: {
      ...process.env,
      NODE_ENV: "production",
      TESCORD_E2E_USER_DATA_DIR: userData,
      TESCORD_E2E_SKIP_SINGLE_INSTANCE: "true",
    },
    timeout: 20000,
  });
  try {
    const splash = await app.firstWindow();
    await expect.poll(() => splash.url()).toMatch(/^file:\/\//);
    const window = await app.waitForEvent("window", {
      predicate: (candidate) => candidate !== splash,
      timeout: 20000,
    });
    await expect.poll(() => window.url()).toMatch(/^file:\/\//);
    await expect(window.getByTestId("auth-email-input")).toBeVisible({ timeout: 15000 });
    const boundary = await window.evaluate(() => ({
      nodeRequire: typeof (window as any).require,
      nodeProcess: typeof (window as any).process,
      electronApi: typeof (window as any).electronAPI,
    }));
    expect(boundary).toEqual({
      nodeRequire: "undefined",
      nodeProcess: "undefined",
      electronApi: "object",
    });
  } finally {
    await app.close();
  }
});
