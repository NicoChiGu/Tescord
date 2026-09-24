import { test, expect } from "@playwright/test";

test.describe("个人设置中心与全新“音频”菜单交互验收", () => {
  test("点击左下角齿轮默认激活音频菜单，体验设备调节、降噪卡片切换与双栏导航", async ({
    page,
  }) => {
    // 注入 Mock Token
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 用户信息接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_audio_test",
          username: "audio_tester",
          displayName: "音频体验官",
          email: "audio@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
          customStatus: "正在调试降噪 🎧",
          bio: "追求极致音频体验",
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto("/");

    // 1. 点击进入首个可用服务器
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 2. 定位左下角齿轮按钮并点击进入设置中心
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible();
    await gearBtn.click();

    // 3. 验证全屏设置中心弹窗挂载
    const settingsModal = page.getByTestId("user-settings-modal");
    await expect(settingsModal).toBeVisible();

    // 验证左侧分类导航
    const profileTabBtn = page.getByTestId("tab-profile-btn");
    const audioTabBtn = page.getByTestId("tab-audio-btn");
    await expect(profileTabBtn).toBeVisible();
    await expect(audioTabBtn).toBeVisible();

    // 验证默认高亮激活的是【音频与降噪】Tab
    await expect(audioTabBtn).toHaveClass(/bg-white\/10/);

    // 4. 验证音频主配置画布 (分层递进布局)
    // 4.1 顶部设备设置
    await expect(page.getByText(/设备设置/i)).toBeVisible();
    await expect(page.getByText(/输入设备 \(麦克风\)/i)).toBeVisible();
    await expect(page.getByText(/输出设备 \(耳机\/扬声器\)/i)).toBeVisible();

    // 4.2 输入模式与麦克风测试
    await expect(page.getByText(/输入模式与麦克风测试/i)).toBeVisible();
    const vadCard = page.getByRole("button", { name: /语音感应 \(VAD\)/i });
    const pttCard = page.getByRole("button", { name: /按键说话 \(PTT\)/i });
    await expect(vadCard).toBeVisible();
    await expect(pttCard).toBeVisible();

    // 4.3 智能降噪卡片
    await expect(page.getByText(/AI 智能降噪/i)).toBeVisible();
    const rnnoiseCard = page.getByRole("button", { name: /RNNoise 标准轻量/i });
    const dtlnCard = page.getByRole("button", { name: /DTLN 深度净化/i });
    const offCard = page.getByRole("button", { name: /直通原声/i });

    await expect(rnnoiseCard).toBeVisible();
    await expect(dtlnCard).toBeVisible();
    await expect(offCard).toBeVisible();

    // 测试点击切换降噪模式
    await dtlnCard.click();
    await expect(page.getByText(/消键盘音/i)).toBeVisible();

    await offCard.click();
    await expect(page.getByText(/直通模式 \(未降噪\)/i)).toBeVisible();

    await rnnoiseCard.click();
    await expect(page.getByText(/推荐/i)).toBeVisible();

    // 4.4 高级音频设置折叠面板
    const advancedToggleBtn = page.getByRole("button", {
      name: /高级音频设置与降噪实验室/i,
    });
    await expect(advancedToggleBtn).toBeVisible();
    await advancedToggleBtn.click();

    // 展开后应能看到 Opus 码率和三轨录音实验室
    await expect(page.getByText(/Opus 音频推流码率/i)).toBeVisible();
    await expect(page.getByText(/AI 降噪前后效果三轨录音/i)).toBeVisible();

    // 5. 验证导航栏无缝切换至【个人资料】
    await profileTabBtn.click();
    await expect(profileTabBtn).toHaveClass(/bg-white\/10/);
    await expect(
      page.getByText(/展示卡与个人资料|个人资料/i).first(),
    ).toBeVisible();
    await expect(page.getByText("在线状态 (Presence)")).toBeVisible();
    await expect(
      page.getByText("自定义个性签名 (Custom Status)"),
    ).toBeVisible();

    // 6. 验证右上角 ESC 按钮关闭设置中心
    const closeBtn = page.getByTestId("close-user-settings-btn");
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(settingsModal).not.toBeVisible();

    // 7. 验证通过左下角用户面板右键快捷菜单打开【个人资料】设置
    const userPanelBtn = page
      .getByTestId("current-user-panel-btn")
      .or(page.getByTitle(/点击打开个人卡片|点击打开设置/i));
    await expect(userPanelBtn).toBeVisible();
    await userPanelBtn.click({ button: "right" });
    const contextSettingsItem = page.getByRole("menuitem", {
      name: /个人设置/i,
    });
    await expect(contextSettingsItem).toBeVisible();
    await contextSettingsItem.click();

    await expect(settingsModal).toBeVisible();
    await expect(profileTabBtn).toHaveClass(/bg-white\/10/);
    await expect(
      page.getByText(/展示卡与个人资料|个人资料/i).first(),
    ).toBeVisible();

    // 8. 验证按键盘 ESC 键也能正常关闭
    await page.keyboard.press("Escape");
    await expect(settingsModal).not.toBeVisible();
  });
});
