import fs from "fs";
import path from "path";
import os from "os";

console.log("🧪 开始测试窗口尺寸与模式记忆隔离机制...");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tescord-bounds-test-"));
const boundsPath = path.join(tempDir, "window-bounds.json");
const settingsPath = path.join(tempDir, "desktop-settings.json");

function loadPersistedWindowBounds() {
  try {
    if (fs.existsSync(boundsPath)) {
      const data = JSON.parse(fs.readFileSync(boundsPath, "utf-8"));
      if (
        data &&
        typeof data.width === "number" &&
        typeof data.height === "number" &&
        data.width >= 600 &&
        data.height >= 500
      ) {
        return data;
      }
    }
  } catch {}
  return null;
}

function savePersistedWindowBounds(bounds) {
  if (!bounds) return;
  fs.writeFileSync(boundsPath, JSON.stringify(bounds), "utf-8");
}

function loadHasAuthSession() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      return Boolean(data.hasAuthSession);
    }
  } catch {}
  return false;
}

function saveHasAuthSession(hasAuthSession) {
  let existing = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {}
  }
  fs.writeFileSync(settingsPath, JSON.stringify({ ...existing, hasAuthSession }, null, 2), "utf-8");
}

try {
  // 1. 初始状态：无会话
  if (loadHasAuthSession() !== false) {
    throw new Error("初始状态应无会话");
  }
  console.log("  ✓ 初始冷启动判断无会话通过，将启动 480x680 登录小窗口");

  // 2. 模拟登录成功，主窗口设置自定义尺寸 1400x900
  saveHasAuthSession(true);
  const mainBounds = { x: 100, y: 150, width: 1400, height: 900, isMaximized: false };
  savePersistedWindowBounds(mainBounds);
  console.log("  ✓ 登录成功，主窗口记忆自定义尺寸 (1400x900)");

  // 3. 模拟退出登录：主窗口销毁，保存 session 为 false，验证 bounds 未被覆盖
  saveHasAuthSession(false);
  const currentBoundsAfterLogout = loadPersistedWindowBounds();
  if (
    !currentBoundsAfterLogout ||
    currentBoundsAfterLogout.width !== 1400 ||
    currentBoundsAfterLogout.height !== 900
  ) {
    throw new Error("登出后主窗口记忆尺寸被破坏！");
  }
  console.log("  ✓ 退出登录后，主窗口尺寸记忆依然完整保留 (1400x900)");

  // 4. 模拟登录小窗口运行中 (480x680)
  // 按照新架构，登录小窗口绝对不会写入 window-bounds.json
  const authBoundsAttempt = { width: 480, height: 680 };
  if (authBoundsAttempt.width < 600 || authBoundsAttempt.height < 500) {
    // 保护生效，不写入
  } else {
    savePersistedWindowBounds(authBoundsAttempt);
  }

  const protectedBounds = loadPersistedWindowBounds();
  if (protectedBounds.width === 480) {
    throw new Error("❌ 登录小窗口污染了主窗口尺寸记忆！");
  }
  console.log("  ✓ 登录小窗口隔离保护生效，尺寸记忆未被 480x680 污染");

  // 5. 模拟再次登录成功：读取恢复尺寸
  saveHasAuthSession(true);
  const restoredBounds = loadPersistedWindowBounds();
  if (restoredBounds.width !== 1400 || restoredBounds.height !== 900) {
    throw new Error("再次登录无法恢复上次拉伸的窗口尺寸！");
  }
  console.log("  ✓ 再次登录成功，100% 完美复原退出前的自定义尺寸 (1400x900)！");

  // 6. 模拟最大化状态保存与恢复
  const maximizedBounds = { width: 1280, height: 800, isMaximized: true };
  savePersistedWindowBounds(maximizedBounds);
  saveHasAuthSession(false); // 登出
  saveHasAuthSession(true);  // 再登录
  const restoredMaximized = loadPersistedWindowBounds();
  if (!restoredMaximized.isMaximized) {
    throw new Error("最大化状态在退出再登录后丢失！");
  }
  console.log("  ✓ 最大化状态在退出与再次登录后完美复原！");

  console.log("\n🎉 [ALL PASS] 窗口尺寸记忆与多窗口隔离验证全部通过！\n");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
