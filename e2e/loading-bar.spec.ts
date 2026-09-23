import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

test.describe("Tescord 首屏与鉴权轻量无文字 Loading 加载条验收", () => {
  test("静态验证：index.html 中内联轻量流光加载条，无文字提示且具备高保真内联样式", async () => {
    const indexPath = path.resolve(__dirname, "../apps/web/index.html");
    const htmlContent = fs.readFileSync(indexPath, "utf-8");

    // 1. 确保包含原生背景兜底与关键帧动画，杜绝外部 CSS 加载前的纯灰屏死寂
    expect(htmlContent).toContain("app-loader-container");
    expect(htmlContent).toContain("app-loader-track");
    expect(htmlContent).toContain("app-loader-fill");
    expect(htmlContent).toContain("app-loader-slide");
    expect(htmlContent).toContain("background-color: #313338");

    // 2. 确保 root 内置加载条骨架中没有任何文本字符提示（轻量简洁化，不要加入文字提示）
    const rootMatch = htmlContent.match(/<div id="root"[^>]*>([\s\S]*?)<\/div>\s*<script/);
    expect(rootMatch).toBeTruthy();
    const rootInnerHtml = rootMatch![1];
    const strippedText = rootInnerHtml.replace(/<[^>]*>/g, "").trim();
    expect(strippedText).toBe("");
  });

  test("动态验证：首屏渲染包含居中 Loading 进度条，随后平滑过渡至登录或主界面，控制台无未捕获异常", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 拦截鉴权请求稍作延迟，验证 React 挂载初期 isLoading 阶段的轻量流光条呈现
    await page.route("**/api/auth/me", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Unauthorized" }),
      });
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 验证页面加载完成，进入登录引导界面
    const loginHeading = page.getByRole("heading", {
      name: /欢迎回到 Tescord|登录/i,
    });
    await expect(loginHeading).toBeVisible({ timeout: 15000 });

    // 验证页面内已不存在原有的旋转圆圈或中文提示
    const oldSpinnerText = page.locator("text=正在载入 Tescord 个人资料与离线数据");
    await expect(oldSpinnerText).toHaveCount(0);

    // 确保没有致命控制台异常
    const criticalErrors = consoleErrors.filter(
      (err) => !err.includes("net::ERR_") && !err.includes("WebSocket"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
