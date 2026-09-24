import assert from "node:assert/strict";
import {
  getUserDisplayName,
  formatUserTag,
} from "../apps/web/src/utils/userDisplay.js";

console.log("=== 开始测试 getUserDisplayName 与 formatUserTag 工具函数 ===");

// 1. 公会昵称优先于全局 displayName 和 username
{
  const name = getUserDisplayName(
    { username: "JackeyTERA#1234", displayName: "杰奇全局名" },
    { nickname: "公会大佬昵称" },
  );
  assert.equal(name, "公会大佬昵称", "当公会昵称存在时，应优先展示公会昵称");
}

// 2. 无公会昵称时，displayName 优先于 username
{
  const name = getUserDisplayName(
    { username: "JackeyTERA#1234", displayName: "杰奇全局名" },
    { nickname: "" },
  );
  assert.equal(name, "杰奇全局名", "当无公会昵称时，应优先展示 displayName");
}

// 3. displayName 为纯空格或 null 时，回退到 username 并剥离 #0000 鉴别码
{
  const name = getUserDisplayName(
    { username: "JackeyTERA#1234", displayName: "   " },
    null,
  );
  assert.equal(name, "JackeyTERA", "displayName 为空时，应回退并剥离 # 鉴别码");
}

// 4. 无 # 鉴别码的普通 username 回退
{
  const name = getUserDisplayName(
    { username: "Alice_Wonder", displayName: null },
    undefined,
  );
  assert.equal(name, "Alice_Wonder", "无 # 号的普通用户名正常展示");
}

// 5. 空 user 对象，走 fallback 兜底
{
  const name = getUserDisplayName(null, null, "匿名用户");
  assert.equal(name, "匿名用户", "空对象应展示指定的 fallback");
}

// 6. formatUserTag 格式化
{
  assert.equal(formatUserTag("JackeyTERA"), "@JackeyTERA");
  assert.equal(formatUserTag("@JackeyTERA"), "@JackeyTERA");
  assert.equal(formatUserTag(""), "");
  assert.equal(formatUserTag(null), "");
  assert.equal(formatUserTag(undefined), "");
}

console.log("✔ 所有 userDisplay 单元校验 100% 通过！");
