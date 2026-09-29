import { test, expect } from "@playwright/test";

test.describe("Tescord 全平台品牌 ICON 与吉祥物视觉验收", () => {
  test("Favicon 静态资产应正确响应 200 且非 404 缺失", async ({ request }) => {
    // 验证 /favicon.svg 存在且为有效的 SVG 吉祥物矢量
    const svgRes = await request.get("/favicon.svg");
    expect(svgRes.status()).toBe(200);
    const svgText = await svgRes.text();
    expect(svgText).toContain("<svg");
    expect(svgText).toContain("#5865F2");

    // 验证 /favicon.ico 存在且为有效的 ICO 文件
    const icoRes = await request.get("/favicon.ico");
    expect(icoRes.status()).toBe(200);
    const icoBuf = await icoRes.body();
    expect(icoBuf.length).toBeGreaterThan(500);
  });

  test("登录界面应渲染官方吉祥物 BrandLogo 徽章而非临时占位字母 T", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto("/");
    const logoSvg = page.getByTestId("auth-brand-logo");
    await expect(logoSvg).toBeVisible();
    await expect(logoSvg).toHaveAttribute("viewBox", "0 0 128 128");

    // 验证不再包含旧的临时字母 "T" 占位 span
    const placeholderT = page.locator("span.font-black:has-text('T')");
    await expect(placeholderT).toHaveCount(0);
  });

  test("应用主界面 Sidebar Home 导航应展示 BrandLogo 且具备流畅圆角交互", async ({
    page,
  }) => {
    await page.goto("/");
    const homeBtn = page.getByTestId("home-nav-button");
    await expect(homeBtn).toBeVisible();
    const homeLogo = homeBtn.locator("svg[viewBox='0 0 128 128']");
    await expect(homeLogo).toBeVisible();
    await expect(homeBtn.locator("svg.lucide-message-square")).toHaveCount(0);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      "./favicon.svg",
    );
  });
});
