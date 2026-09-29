/**
 * Tescord 全平台品牌 ICON 自动化工程构建脚本
 * Single Source of Truth: 纯数学矢量定义生成多端高保真资产
 * 输出：
 *   - apps/web/public/favicon.svg (网页矢量 Favicon)
 *   - apps/web/public/favicon.ico (Windows/浏览器多图层 ICO)
 *   - apps/desktop/resources/icon.png (512x512 桌面端高清图标)
 *   - apps/desktop/resources/icon.ico (Windows 完整尺寸 16/24/32/48/64/128/256 ICO)
 *   - apps/desktop/resources/tray-white.png (系统托盘高清 32x32 剪影)
 *   - apps/desktop/resources/tray-badge.png (系统托盘高清 32x32 带红点未读剪影)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const webPublicDir = path.join(rootDir, "apps/web/public");
const desktopResourcesDir = path.join(rootDir, "apps/desktop/resources");
const assetsDir = path.join(rootDir, "packages/assets");

// 确保目标目录存在
[webPublicDir, desktopResourcesDir, assetsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/**
 * 吉祥物矢量母版生成函数
 */
export function getMascotSvg({
  withBackground = true,
  bgColor = "#5865F2",
  symbolColor = "#FFFFFF",
  badgeRadius = 28,
  eyeColor = null,
  size = 128,
  badge = false,
} = {}) {
  const helmetPath = `
    M 36 99
    C 28 95, 21 87, 19 77
    C 17 67, 20 57, 24 49
    C 25.5 44, 27 36, 28 29
    C 28.8 24.5, 33 22, 37.5 24.5
    C 43 27.5, 48.5 36, 52 43.5
    C 56 42, 72 42, 76 43.5
    C 79.5 36, 85 27.5, 90.5 24.5
    C 95 22, 99.2 24.5, 100 29
    C 101 36, 102.5 44, 104 49
    C 108 57, 111 67, 109 77
    C 107 87, 100 95, 92 99
    C 84 103, 76 105.5, 64 105.5
    C 52 105.5, 44 103, 36 99
    Z
  `
    .replace(/\s+/g, " ")
    .trim();

  const leftEarCutout = `
    M 36 33
    C 38 38, 42 44, 45 47
    C 42.5 47, 39 45, 36.5 41.5
    C 34.5 38.5, 34.5 35, 36 33
    Z
  `
    .replace(/\s+/g, " ")
    .trim();

  const rightEarCutout = `
    M 92 33
    C 93.5 35, 93.5 38.5, 91.5 41.5
    C 89 45, 85.5 47, 83 47
    C 86 44, 90 38, 92 33
    Z
  `
    .replace(/\s+/g, " ")
    .trim();

  const eyeFill = eyeColor || (withBackground ? bgColor : "#1e1f22");
  const leftEye = `<rect x="39" y="63" width="14" height="20" rx="7" fill="${eyeFill}" />`;
  const rightEye = `<rect x="75" y="63" width="14" height="20" rx="7" fill="${eyeFill}" />`;
  const mouth = `<path d="M 58 88 Q 64 92 70 88" stroke="${eyeFill}" stroke-width="3.5" stroke-linecap="round" fill="none" />`;

  const earInnerFills = `
    <path d="${leftEarCutout}" fill="${eyeFill}" opacity="0.9" />
    <path d="${rightEarCutout}" fill="${eyeFill}" opacity="0.9" />
  `;

  const redBadge = badge
    ? `
    <circle cx="106" cy="22" r="18" fill="#f23f43" stroke="${withBackground ? bgColor : "#1e1f22"}" stroke-width="5" />
  `
    : "";

  if (withBackground) {
    return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">
  <rect width="128" height="128" rx="${badgeRadius}" fill="${bgColor}"/>
  <path d="${helmetPath}" fill="${symbolColor}"/>
  ${earInnerFills}
  ${leftEye}
  ${rightEye}
  ${mouth}
  ${redBadge}
</svg>`.replace(/^[ \t]+$/gm, "").trim();
  } else {
    const badgeOnTransparent = badge
      ? `
      <circle cx="106" cy="22" r="16" fill="#f23f43" />
    `
      : "";

    return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">
  <mask id="mascot-mask-${size}-${badge ? "b" : "n"}">
    <rect width="128" height="128" fill="white" />
    <path d="${leftEarCutout}" fill="black" />
    <path d="${rightEarCutout}" fill="black" />
    <rect x="39" y="63" width="14" height="20" rx="7" fill="black" />
    <rect x="75" y="63" width="14" height="20" rx="7" fill="black" />
    <path d="M 58 88 Q 64 92 70 88" stroke="black" stroke-width="3.5" stroke-linecap="round" fill="none" />
    ${badge ? '<circle cx="106" cy="22" r="21" fill="black" />' : ""}
  </mask>
  <path d="${helmetPath}" fill="${symbolColor}" mask="url(#mascot-mask-${size}-${badge ? "b" : "n"})"/>
  ${badgeOnTransparent}
</svg>`.replace(/^[ \t]+$/gm, "").trim();
  }
}

/**
 * 纯 Node 打包微软 Windows 官方标准多图层 ICO 文件 (基于内嵌 PNG 格式)
 */
function packIco(images) {
  const count = images.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;

  const entries = [];
  for (const img of images) {
    entries.push({
      width: img.width >= 256 ? 0 : img.width,
      height: img.height >= 256 ? 0 : img.height,
      colorCount: 0,
      reserved: 0,
      planes: 1,
      bitCount: 32,
      bytesInRes: img.data.length,
      imageOffset: offset,
      data: img.data,
    });
    offset += img.data.length;
  }

  const buf = Buffer.alloc(offset);
  // ICONDIR Header
  buf.writeUInt16LE(0, 0); // Reserved. Must always be 0.
  buf.writeUInt16LE(1, 2); // Specifies image type: 1 for icon (.ICO) image
  buf.writeUInt16LE(count, 4); // Specifies number of images in the file

  let entryPos = 6;
  for (const e of entries) {
    buf.writeUInt8(e.width, entryPos);
    buf.writeUInt8(e.height, entryPos + 1);
    buf.writeUInt8(e.colorCount, entryPos + 2);
    buf.writeUInt8(e.reserved, entryPos + 3);
    buf.writeUInt16LE(e.planes, entryPos + 4);
    buf.writeUInt16LE(e.bitCount, entryPos + 6);
    buf.writeUInt32LE(e.bytesInRes, entryPos + 8);
    buf.writeUInt32LE(e.imageOffset, entryPos + 12);
    entryPos += 16;

    e.data.copy(buf, e.imageOffset);
  }

  return buf;
}

async function buildAllIcons() {
  console.log("🎨 [Tescord Icon Pipeline] 正在启动 Playwright 无头渲染引擎...");
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. 生成并保存标准矢量母版
  const standardBadgeSvg = getMascotSvg({
    withBackground: true,
    size: 128,
    badgeRadius: 28,
  });
  const standardSymbolSvg = getMascotSvg({
    withBackground: false,
    size: 128,
    symbolColor: "#5865F2",
  });

  fs.writeFileSync(path.join(assetsDir, "logo.svg"), standardBadgeSvg, "utf8");
  fs.writeFileSync(
    path.join(assetsDir, "symbol.svg"),
    standardSymbolSvg,
    "utf8",
  );
  fs.writeFileSync(
    path.join(webPublicDir, "favicon.svg"),
    standardBadgeSvg,
    "utf8",
  );
  console.log(
    "✅ 矢量母版已写入 packages/assets 与 apps/web/public/favicon.svg",
  );

  /**
   * 辅助函数：通过 Headless Chromium 以像素级精度将 SVG 渲染为 PNG Buffer
   */
  async function renderSvgToPng(svgString, size) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            * { margin: 0; padding: 0; }
            html, body { width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
            svg { display: block; width: 100%; height: 100%; }
          </style>
        </head>
        <body>${svgString}</body>
      </html>
    `;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(html);
    return await page.screenshot({ omitBackground: true, type: "png" });
  }

  // 2. 导出桌面端 512x512 高清主图标 icon.png
  console.log("📦 正在生成 512x512 高清应用图标...");
  const icon512Png = await renderSvgToPng(
    getMascotSvg({ withBackground: true, size: 512, badgeRadius: 112 }),
    512,
  );
  fs.writeFileSync(path.join(desktopResourcesDir, "icon.png"), icon512Png);

  // 3. 导出 Windows 标准多图层 icon.ico (16, 24, 32, 48, 64, 128, 256)
  console.log("📦 正在构建 Windows 完整多图层 icon.ico...");
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoImages = [];
  for (const s of icoSizes) {
    const radius = Math.max(3, Math.round(s * (28 / 128)));
    const pngBuf = await renderSvgToPng(
      getMascotSvg({ withBackground: true, size: s, badgeRadius: radius }),
      s,
    );
    icoImages.push({ width: s, height: s, data: pngBuf });
  }
  const desktopIcoBuf = packIco(icoImages);
  fs.writeFileSync(path.join(desktopResourcesDir, "icon.ico"), desktopIcoBuf);

  // 4. 导出 Web 端 favicon.ico (16, 32, 48)
  console.log("📦 正在构建 Web 端 favicon.ico...");
  const faviconSizes = [16, 32, 48];
  const faviconImages = icoImages.filter((img) =>
    faviconSizes.includes(img.width),
  );
  const faviconIcoBuf = packIco(faviconImages);
  fs.writeFileSync(path.join(webPublicDir, "favicon.ico"), faviconIcoBuf);

  // 5. 导出系统托盘高清图 tray-white.png 与 tray-badge.png (32x32 @2x 高分屏支持)
  console.log("📦 正在生成桌面托盘图标 (单色纯白 & 未读红点)...");
  const trayWhitePng = await renderSvgToPng(
    getMascotSvg({ withBackground: false, size: 32, symbolColor: "#FFFFFF" }),
    32,
  );
  fs.writeFileSync(
    path.join(desktopResourcesDir, "tray-white.png"),
    trayWhitePng,
  );

  const trayColorPng = await renderSvgToPng(
    getMascotSvg({ withBackground: false, size: 32, symbolColor: "#5865F2" }),
    32,
  );
  fs.writeFileSync(path.join(desktopResourcesDir, "tray.png"), trayColorPng);

  const trayBadgePng = await renderSvgToPng(
    getMascotSvg({
      withBackground: false,
      size: 32,
      symbolColor: "#5865F2",
      badge: true,
    }),
    32,
  );
  fs.writeFileSync(
    path.join(desktopResourcesDir, "tray-badge.png"),
    trayBadgePng,
  );

  await browser.close();
  console.log("✨ [Tescord Icon Pipeline] 全部多端图标资产生成完毕！");
}

buildAllIcons().catch((err) => {
  console.error("❌ 图标构建失败:", err);
  process.exit(1);
});
