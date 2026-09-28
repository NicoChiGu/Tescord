import { test, expect } from "@playwright/test";

test.describe("iOS & 移动端 Web 音频中断恢复与生命周期唤醒（方案1）端到端验收", () => {
  test("1. 模拟系统中断时正确弹出横幅，点击恢复后横幅隐藏且状态自愈", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 初始状态下横幅不应展示
    const banner = page.locator("aside[role='alert']");
    await expect(banner).toHaveCount(0);

    // 1.1 模拟 iOS / 系统音频抢占触发中断
    await page.evaluate(() => {
      (window as any).__livekitService?.simulateInterruption(true);
    });

    // 验证横幅展示
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toContainText("音频播放已被系统打断");
    await expect(banner).toContainText("点击恢复音频");

    // 1.2 点击恢复按钮
    const resumeBtn = banner.getByRole("button", { name: /点击恢复音频/i });
    await expect(resumeBtn).toBeVisible();
    await resumeBtn.click();

    // 验证横幅成功消失自愈
    await expect(banner).toHaveCount(0, { timeout: 5000 });

    // 确认控制台无严重异常
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("Failed to load resource"),
    );
    expect(criticalErrors).toEqual([]);
  });

  test("2. 全屏轻触任意手势能够自动兜底触发音频唤醒", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator("aside[role='alert']");

    // 模拟中断
    await page.evaluate(() => {
      (window as any).__livekitService?.simulateInterruption(true);
    });
    await expect(banner).toBeVisible({ timeout: 5000 });

    // 用户在屏幕空白区域点击任意处
    await page.mouse.click(200, 200);

    // 验证横幅自动解冻并隐藏
    await expect(banner).toHaveCount(0, { timeout: 5000 });
  });

  test("3. Cloudflare Realtime 回放中断使用同一横幅恢复", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator("aside[role='alert']");
    await page.evaluate(() => {
      (window as any).cloudflareRealtimeService?.simulateInterruption(true);
    });
    await expect(banner).toBeVisible({ timeout: 5000 });
    const resumeButton = banner.getByRole("button", { name: /点击恢复音频/i });
    const buttonBox = await resumeButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    await page.mouse.click(
      buttonBox!.x + buttonBox!.width / 2,
      buttonBox!.y + buttonBox!.height / 2,
    );
    await expect(banner).toHaveCount(0, { timeout: 5000 });
    const status = await page.evaluate(() =>
      (window as any).cloudflareRealtimeService?.getAudioPlaybackStatus(),
    );
    expect(status).toMatchObject({ canPlay: true, isInterrupted: false });
  });

  test("4. 多语言环境下 (zh-CN / zh-TW / zh-HK / en-US / ja-JP) 文案 100% 完整与无硬编码", async ({
    page,
  }) => {
    const locales = [
      {
        locale: "en-US",
        title: "Audio Playback Interrupted",
        button: "Resume Audio",
      },
      {
        locale: "ja-JP",
        title: "音声再生がシステムにより中断されました",
        button: "音声を再開",
      },
      {
        locale: "zh-TW",
        title: "音訊播放已被系統中斷",
        button: "點擊恢復音訊",
      },
      {
        locale: "zh-HK",
        title: "音訊播放已被系統打斷",
        button: "點擊恢復音訊",
      },
      {
        locale: "zh-CN",
        title: "音频播放已被系统打断",
        button: "点击恢复音频",
      },
    ];

    for (const item of locales) {
      await page.addInitScript((loc) => {
        localStorage.setItem("tescord_locale", loc);
      }, item.locale);

      await page.goto("/");
      await page.evaluate(() => {
        (window as any).__livekitService?.simulateInterruption(true);
      });

      const banner = page.locator("aside[role='alert']");
      await expect(banner).toBeVisible({ timeout: 5000 });
      await expect(banner).toContainText(item.title);
      await expect(banner).toContainText(item.button);

      // 点击恢复后重置
      await page.evaluate(() => {
        (window as any).__livekitService?.simulateInterruption(false);
      });
      await expect(banner).toHaveCount(0, { timeout: 3000 });
    }
  });
});
