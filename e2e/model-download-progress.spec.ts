import { expect, test } from "@playwright/test";
import fs from "node:fs";
import ts from "typescript";
import { CURRENT_APP_VERSION } from "../apps/web/src/data/changelogs";

test("streamed download counts bytes, ignores compressed totals, and cancels stalled bodies", async ({
  page,
}) => {
  await page.route("**/download-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("/download-fixture");
  const source = ts
    .transpileModule(
      fs.readFileSync("apps/web/src/services/downloadProgress.ts", "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      },
    )
    .outputText.replace(
      "export async function readDownload",
      "window.readDownload = async function readDownload",
    );
  await page.addScriptTag({ content: source });
  const result = await page.evaluate(async () => {
    const read = (
      window as unknown as {
        readDownload: (
          response: Response,
          callback?: (progress: { loaded: number; total?: number }) => void,
          signal?: AbortSignal,
          stall?: number,
        ) => Promise<ArrayBuffer>;
      }
    ).readDownload;
    const progress: { loaded: number; total?: number }[] = [];
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (let i = 0; i < 3; i++) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          controller.enqueue(new Uint8Array(512));
        }
        controller.close();
      },
    });
    const bytes = await read(
      new Response(stream, { headers: { "content-length": "1536" } }),
      (value) => progress.push(value),
    );
    let compressedTotal: number | undefined;
    await read(
      new Response(new Uint8Array(1024), {
        headers: { "content-length": "100", "content-encoding": "gzip" },
      }),
      (value) => {
        compressedTotal = value.total;
      },
    );
    const abort = new AbortController();
    let cancelled = false,
      cancellationSeen = false;
    const hanging = new ReadableStream({
      cancel() {
        cancellationSeen = true;
      },
    });
    const task = read(new Response(hanging), undefined, abort.signal);
    setTimeout(() => abort.abort(), 20);
    try {
      await task;
    } catch (cause) {
      cancelled = cause instanceof DOMException && cause.name === "AbortError";
    }
    let stalled = false;
    try {
      await read(new Response(new ReadableStream()), undefined, undefined, 30);
    } catch (cause) {
      stalled = cause instanceof Error && cause.message.includes("stalled");
    }
    return {
      progress,
      size: bytes.byteLength,
      compressedTotal,
      cancelled,
      cancellationSeen,
      stalled,
    };
  });
  expect(result.size).toBe(1536);
  expect(result.progress.map((value) => value.loaded)).toEqual(
    expect.arrayContaining([0, 512, 1024, 1536]),
  );
  expect(result.progress.every((value) => value.total === 1536)).toBe(true);
  expect(result.compressedTotal).toBeUndefined();
  expect(result.cancelled).toBe(true);
  expect(result.cancellationSeen).toBe(true);
  expect(result.stalled).toBe(true);
});

test("model switches use one persistent localized toast, cache verified bytes, and isolate superseded failures", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (version) =>
      localStorage.setItem("tescord_last_seen_changelog_version", version),
    CURRENT_APP_VERSION,
  );
  let downloads = 0;
  await page.route("**/rnnoise/*.wasm", async (route) => {
    downloads++;
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    await route.fulfill({
      contentType: "application/wasm",
      body: fs.readFileSync(`apps/web/public/rnnoise/${name}`),
    });
  });
  await page.route("**/models/dtln/*.onnx", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await route.fulfill({
      contentType: "application/octet-stream",
      body: "corrupted model",
    });
  });
  await page.goto("/");
  if (page.viewportSize()!.width < 768)
    await page.getByTestId("toggle-mobile-drawer-btn").click();
  await page.getByTestId("user-settings-gear-btn").click();
  const audioTab = page.getByTestId("tab-audio-btn");
  // The mobile audio shortcut opens the pane directly; its navigation tab is hidden.
  if (page.viewportSize()!.width >= 768) await audioTab.click();
  const off = page.getByRole("button", { name: /直通原声/ });
  const rnnoise = page.getByRole("button", { name: /RNNoise 标准轻量/ });
  const dtln = page.getByRole("button", { name: /DTLN 深度净化/ });
  await off.click();
  await expect(
    page.locator('[role="status"]').filter({ hasText: /直通原声/ }),
  ).toContainText(/已切换|已下载/);
  await page.evaluate(() => caches.delete("tescord-verified-models-v1"));
  await rnnoise.click();
  const toast = page.locator('[role="status"]').filter({ hasText: /RNNoise/ });
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText(/下载/);
  await expect(toast.getByRole("progressbar")).toBeVisible();
  await expect(toast).toContainText(/已切换|已下载/, { timeout: 12000 });
  const networkCount = downloads;
  await off.click();
  await rnnoise.click();
  await expect(toast).toContainText(/已切换|已下载/);
  expect(downloads).toBe(networkCount);
  await dtln.click();
  await expect(
    page.locator('[role="status"]').filter({ hasText: /DTLN/ }),
  ).toHaveCount(1);
  await off.click();
  await page.waitForTimeout(2200);
  await expect(
    page.locator('[role="status"]').filter({ hasText: /DTLN/ }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
