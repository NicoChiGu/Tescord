import { test, expect } from "@playwright/test";
import { CURRENT_APP_VERSION } from "../apps/web/src/data/changelogs.js";

/**
 * 创建合法的最小 PCM WAV 音频二进制 Buffer
 */
function createMockWavBuffer(seconds = 2, sampleRate = 8000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = Math.floor(seconds * byteRate);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < dataSize / 2; i++) {
    const sample = Math.sin((i / sampleRate) * 440 * 2 * Math.PI) * 12000;
    buffer.writeInt16LE(Math.floor(sample), 44 + i * 2);
  }
  return buffer;
}

const mockAudioBuffer = createMockWavBuffer(3);

test.describe("自定义音频播放器 UI、波形频谱、单例互斥与右下角小窗播放验收", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((version) => {
      const accessToken =
        localStorage.getItem("tescord_e2e_access_token") ||
        localStorage.getItem("tescord_access_token");
      if (accessToken) {
        localStorage.setItem("tescord_access_token", accessToken);
      }
      localStorage.setItem("tescord_last_seen_changelog_version", version);
    }, CURRENT_APP_VERSION);
  });

  test("音频文件上传 -> 自定义波形播放器卡片渲染 -> 拖拽寻道 -> 单例互斥 -> 右下角迷你小窗播放", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible({ timeout: 15000 });

    // 1. 进入 general 频道
    const generalChannel = page.locator('text="general"').first();
    await expect(generalChannel).toBeVisible({ timeout: 15000 });
    await generalChannel.click();

    const audioFile1 = `track_alpha_${Date.now()}.wav`;
    const audioFile2 = `track_beta_${Date.now()}.wav`;

    // 路由拦截，返回合法 WAV 音频数据
    await page.route(`**/*${audioFile1}*`, async (route, req) => {
      if (req.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "audio/wav",
          body: mockAudioBuffer,
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/*${audioFile2}*`, async (route, req) => {
      if (req.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "audio/wav",
          body: mockAudioBuffer,
        });
      } else {
        await route.continue();
      }
    });

    // 2. 上传第一个音频文件
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: audioFile1,
      mimeType: "audio/wav",
      buffer: mockAudioBuffer,
    });

    // 等待待发送预览出现并发送
    await expect(page.locator(`text="${audioFile1}"`)).toBeVisible({ timeout: 10000 });
    const chatInput = page.locator('div[contenteditable="true"]').first();
    await chatInput.fill(`Audio_Test_1_${Date.now()}`);
    await chatInput.press("Enter");

    // 3. 验证聊天流中的自定义播放器卡片渲染（无原生 <audio controls> 暴露）
    const playerCard1 = page
      .locator('[data-testid="audio-attachment-player"]')
      .filter({ hasText: audioFile1 })
      .last();
    await expect(playerCard1).toBeVisible({ timeout: 10000 });

    // 确保卡片内部没有裸原生 <audio controls>
    const nativeAudioControls = playerCard1.locator("audio[controls]");
    await expect(nativeAudioControls).toHaveCount(0);

    // 验证波形条容器已渲染，且包含多根波形柱
    const waveform1 = playerCard1.locator('div[role="slider"]');
    await expect(waveform1).toBeVisible({ timeout: 10000 });
    const waveformBars = waveform1.locator("> div > div");
    const barsCount = await waveformBars.count();
    expect(barsCount).toBeGreaterThan(20);

    // 4. 点击播放卡片 1
    const playBtn1 = playerCard1.locator('button[title="播放"], button[title="Play"], button[aria-label="播放"], button[aria-label="Play"]').first();
    await playBtn1.click();

    // 验证卡片 1 播放中状态以及右下角迷你悬浮播放器出现
    const miniPlayer = page.locator('[data-testid="global-mini-audio-player"]');
    await expect(miniPlayer).toBeVisible({ timeout: 10000 });
    await expect(miniPlayer).toContainText(audioFile1);

    // 5. 测试波形 Seek 拖拽与点击寻道
    const waveformBox = await waveform1.boundingBox();
    if (waveformBox) {
      await page.mouse.click(
        waveformBox.x + waveformBox.width * 0.5,
        waveformBox.y + waveformBox.height * 0.5,
      );
    }

    // 6. 测试音量调节与倍速切换
    const speedBtn = playerCard1.locator("button", { hasText: "1x" }).first();
    if (await speedBtn.isVisible()) {
      await speedBtn.click();
      await expect(playerCard1.locator("button", { hasText: "1.25x" }).first()).toBeVisible();
    }

    // 7. 上传第二个音频文件，测试单例互斥
    await fileInput.setInputFiles({
      name: audioFile2,
      mimeType: "audio/wav",
      buffer: mockAudioBuffer,
    });
    await expect(page.locator(`text="${audioFile2}"`)).toBeVisible({ timeout: 10000 });
    await chatInput.fill(`Audio_Test_2_${Date.now()}`);
    await chatInput.press("Enter");

    const playerCard2 = page
      .locator('[data-testid="audio-attachment-player"]')
      .filter({ hasText: audioFile2 })
      .last();
    await expect(playerCard2).toBeVisible({ timeout: 10000 });

    // 点击播放卡片 2
    const playBtn2 = playerCard2.locator('button[title="播放"], button[title="Play"], button[aria-label="播放"], button[aria-label="Play"]').first();
    await playBtn2.click();

    // 互斥断言：卡片 2 正在播放，迷你播放器更新为 audioFile2
    await expect(miniPlayer).toContainText(audioFile2);

    // 8. 测试迷你播放器展开与收起
    const expandBtn = miniPlayer.locator('button[title="展开"], button[title="Expand"], button[aria-label="展开"], button[aria-label="Expand"]').first();
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      // 展开后应包含音量滑块或更大波形
      await expect(miniPlayer.locator('input[type="range"]')).toBeVisible({ timeout: 5000 });
    }

    // 9. 测试迷你播放器关闭
    const closeBtn = miniPlayer.locator('button[title="关闭播放器"], button[title="Close player"], button[aria-label="关闭播放器"], button[aria-label="Close player"]').first();
    await closeBtn.click();
    await expect(miniPlayer).toBeHidden({ timeout: 5000 });

    // 验证控制台无严重未捕获错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("favicon") &&
        !err.includes("Download the React DevTools") &&
        !err.includes("Failed to fetch") &&
        !err.includes("net::ERR_"),
    );
    expect(criticalErrors).toEqual([]);
  });
});
