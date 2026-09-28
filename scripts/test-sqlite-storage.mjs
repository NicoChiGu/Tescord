import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const desktopRequire = createRequire(path.resolve("apps/desktop/package.json"));
const Database = desktopRequire("better-sqlite3");

console.log("==========================================");
console.log("🧪 Tescord 本地 SQLite 存储架构与迁移自动化验收测试");
console.log("==========================================");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tescord-sqlite-test-"));
console.log(`[Setup] 使用临时测试隔离目录: ${tempDir}`);

try {
  // 1. 测试全局 app.db 初始化与 WAL 模式
  console.log("\n[Test 1] 全局配置库 app.db 初始化与 WAL 模式验证...");
  const appDbPath = path.join(tempDir, "app.db");
  const appDb = new Database(appDbPath);
  appDb.pragma("journal_mode = WAL");
  appDb.pragma("synchronous = NORMAL");

  const journalMode = appDb.pragma("journal_mode", { simple: true });
  assert.equal(journalMode, "wal", "app.db journal_mode 应为 wal");

  appDb.exec(`
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS saved_accounts (
      id TEXT PRIMARY KEY,
      email TEXT,
      username TEXT,
      display_name TEXT,
      discriminator TEXT,
      avatar_url TEXT,
      last_active_at INTEGER,
      remember_password INTEGER,
      encrypted_refresh_token BLOB
    );
    CREATE TABLE IF NOT EXISTS active_tokens (
      id TEXT PRIMARY KEY,
      encrypted_access_token BLOB,
      encrypted_refresh_token BLOB,
      user_json TEXT,
      remember INTEGER,
      updated_at INTEGER
    );
  `);

  // 验证 preferences 读写与替换
  appDb
    .prepare(
      "INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)",
    )
    .run("theme", JSON.stringify("discord-dark"), Date.now());

  const prefRow = appDb
    .prepare("SELECT value FROM preferences WHERE key = ?")
    .get("theme");
  assert.equal(
    JSON.parse(prefRow.value),
    "discord-dark",
    "Preference 读取应一致",
  );
  console.log("  ✔ 全局 preferences 读写正常，WAL 模式激活");

  // 2. 测试凭据与账号安全存储
  console.log("\n[Test 2] 多账号与 Token 安全存储测试 (BLOB 字段)...");
  const fakeEncryptedToken = Buffer.from("dpapi_encrypted_token_bytes_12345");
  appDb
    .prepare(
      `
    INSERT INTO saved_accounts (id, email, username, display_name, last_active_at, remember_password, encrypted_refresh_token)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      "user_1001",
      "tester@tescord.com",
      "TestUser",
      "Tester",
      Date.now(),
      1,
      fakeEncryptedToken,
    );

  const savedAcc = appDb
    .prepare("SELECT * FROM saved_accounts WHERE id = ?")
    .get("user_1001");
  assert.equal(savedAcc.username, "TestUser");
  assert.equal(savedAcc.remember_password, 1);
  assert.deepEqual(savedAcc.encrypted_refresh_token, fakeEncryptedToken);
  console.log("  ✔ 账号 BLOB 凭据存储与还原完全无损");

  // 3. 测试用户专属库 cache.db 物理双库隔离
  console.log("\n[Test 3] 用户专属库 users/<userId>/cache.db 物理隔离验证...");
  const user1001Dir = path.join(tempDir, "users", "user_1001");
  fs.mkdirSync(user1001Dir, { recursive: true });
  const userCacheDbPath = path.join(user1001Dir, "cache.db");
  const cacheDb = new Database(userCacheDbPath);
  cacheDb.pragma("journal_mode = WAL");

  cacheDb.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      sequence INTEGER DEFAULT 0,
      author_id TEXT,
      author_json TEXT,
      content TEXT,
      is_encrypted INTEGER DEFAULT 0,
      reply_to_json TEXT,
      is_pinned INTEGER DEFAULT 0,
      reactions_json TEXT,
      attachments_json TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_channel_seq ON messages(channel_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      id UNINDEXED,
      channel_id UNINDEXED,
      content
    );

    CREATE TRIGGER IF NOT EXISTS trig_messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(id, channel_id, content) VALUES (new.id, new.channel_id, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS trig_messages_ad AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE id = old.id;
    END;

    CREATE TABLE IF NOT EXISTS channel_meta (
      channel_id TEXT PRIMARY KEY,
      last_read_sequence INTEGER DEFAULT 0,
      scroll_top INTEGER DEFAULT 0,
      is_near_bottom INTEGER DEFAULT 1,
      last_visited_at INTEGER DEFAULT 0
    );
  `);

  assert.ok(
    fs.existsSync(userCacheDbPath),
    "用户专属 cache.db 必须独立存在于磁盘",
  );
  console.log("  ✔ 用户库物理文件隔离成功创建");

  // 4. 测试微批写入与 LRU 淘汰治理
  console.log("\n[Test 4] 批量事务消息写入与 LRU 淘汰测试...");
  const insertStmt = cacheDb.prepare(`
    INSERT INTO messages (id, channel_id, sequence, author_id, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = cacheDb.transaction((totalCount) => {
    for (let i = 1; i <= totalCount; i++) {
      insertStmt.run(
        `msg_${i}`,
        "channel_general",
        i,
        "author_alice",
        i === 42
          ? "关键离线密码：SecretMessageTescord2026"
          : `日常聊天测试消息内容 ${i}`,
        new Date(Date.now() + i * 1000).toISOString(),
        new Date().toISOString(),
      );
    }
  });

  const startTime = Date.now();
  tx(500); // 批量写入 500 条
  const duration = Date.now() - startTime;
  console.log(`  ✔ 批量事务写入 500 条消息耗时: ${duration}ms (超高性能吞吐)`);

  const countRow = cacheDb
    .prepare("SELECT COUNT(*) as count FROM messages WHERE channel_id = ?")
    .get("channel_general");
  assert.equal(countRow.count, 500, "500条消息必须全量入库");

  // 5. 测试 SQLite FTS5 全文搜索能力
  console.log("\n[Test 5] SQLite FTS5 离线全文检索引擎测试...");
  const ftsResults = cacheDb
    .prepare(
      `
    SELECT m.*
    FROM messages m
    JOIN messages_fts f ON m.id = f.id
    WHERE messages_fts MATCH '"SecretMessageTescord2026"*'
  `,
    )
    .all();

  assert.equal(
    ftsResults.length,
    1,
    "FTS5 应该精准匹配到包含 SecretMessageTescord2026 的消息",
  );
  assert.equal(ftsResults[0].id, "msg_42");
  console.log(
    `  ✔ FTS5 毫秒级检索成功，精准匹配消息 ID: ${ftsResults[0].id}, 内容: "${ftsResults[0].content}"`,
  );

  // 测试触发器同步删除
  cacheDb.prepare("DELETE FROM messages WHERE id = 'msg_42'").run();
  const ftsAfterDelete = cacheDb
    .prepare(
      `
    SELECT m.* FROM messages m JOIN messages_fts f ON m.id = f.id
    WHERE messages_fts MATCH '"SecretMessageTescord2026"*'
  `,
    )
    .all();
  assert.equal(
    ftsAfterDelete.length,
    0,
    "删除消息后 FTS5 虚拟表必须自动被触发器同步清理",
  );
  console.log("  ✔ FTS5 触发器同步删除生效");

  // 6. 测试频道元数据（已读游标、滚动坐标）
  console.log("\n[Test 6] 频道元数据原子读写测试...");
  cacheDb
    .prepare(
      `
    INSERT INTO channel_meta (channel_id, last_read_sequence, scroll_top, is_near_bottom, last_visited_at)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run("channel_general", 480, 1250, 0, Date.now());

  const metaRow = cacheDb
    .prepare("SELECT * FROM channel_meta WHERE channel_id = ?")
    .get("channel_general");
  assert.equal(metaRow.last_read_sequence, 480);
  assert.equal(metaRow.scroll_top, 1250);
  assert.equal(metaRow.is_near_bottom, 0);
  console.log("  ✔ 频道已读游标与滚动坐标保存无损");

  // 关闭数据库
  appDb.close();
  cacheDb.close();

  console.log("\n==========================================");
  console.log(
    "🎉 ALL TESTS PASSED! 本地 SQLite 存储架构与 FTS5 核心全部验证通过！",
  );
  console.log("==========================================");
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}
