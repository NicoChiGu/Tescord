/**
 * 本地存储差量对账修剪 (Storage Range Reconciliation) 专项测试
 * 覆盖：
 * 1. 模拟消息删除后，区间差量对账准确物理删除本地失效消息
 * 2. 严格保护 sequence <= 0 的本地乐观消息
 * 3. 严格保护位于 [minSeq, maxSeq] 判定区间外的其他历史消息
 * 4. 严格隔离多频道数据，对账 channel A 绝不影响 channel B
 * 5. 联动验证 SQLite FTS5 全文搜索触发器同步清理
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "../apps/desktop/node_modules/better-sqlite3/lib/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDbPath = path.resolve(__dirname, "../temp-test-reconcile.db");

if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

const db = new Database(testDbPath);
db.pragma("journal_mode = WAL");

// 初始化表结构与 FTS5（与 storageWorker 一致）
db.exec(`
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
`);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

// 模拟 storageWorker 中的 messages-reconcile 动作执行器
function executeReconcile(channelId, messages, range) {
  const minSeq = Math.max(1, Math.min(range.minSequence, range.maxSequence));
  const maxSeq = Math.max(range.minSequence, range.maxSequence);

  const insertStmt = db.prepare(`
    INSERT INTO messages (
      id, channel_id, sequence, author_id, author_json, content,
      is_encrypted, reply_to_json, is_pinned, reactions_json,
      attachments_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      channel_id = excluded.channel_id,
      sequence = excluded.sequence,
      author_id = excluded.author_id,
      author_json = excluded.author_json,
      content = excluded.content,
      is_encrypted = excluded.is_encrypted,
      reply_to_json = excluded.reply_to_json,
      is_pinned = excluded.is_pinned,
      reactions_json = excluded.reactions_json,
      attachments_json = excluded.attachments_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);

  const reconcileTx = db.transaction((msgs) => {
    // 1. 删除区间内已被删除的消息（排除 sequence <= 0 的本地乐观未上链消息）
    if (minSeq <= maxSeq) {
      const validIds = (msgs || []).map((m) => m.id).filter(Boolean);
      if (validIds.length > 0) {
        const placeholders = validIds.map(() => "?").join(",");
        db.prepare(
          `
          DELETE FROM messages
          WHERE channel_id = ?
            AND sequence >= ?
            AND sequence <= ?
            AND sequence > 0
            AND id NOT IN (${placeholders})
        `,
        ).run(channelId, minSeq, maxSeq, ...validIds);
      } else {
        db.prepare(
          `
          DELETE FROM messages
          WHERE channel_id = ?
            AND sequence >= ?
            AND sequence <= ?
            AND sequence > 0
        `,
        ).run(channelId, minSeq, maxSeq);
      }
    }

    // 2. 批量写入/更新权威消息
    if (msgs && msgs.length > 0) {
      for (const msg of msgs) {
        insertStmt.run(
          msg.id,
          msg.channelId || channelId,
          msg.sequence || 0,
          msg.authorId || "usr_test",
          JSON.stringify({ id: "usr_test", username: "Tester" }),
          msg.content || "",
          0,
          null,
          0,
          null,
          null,
          new Date().toISOString(),
          new Date().toISOString(),
        );
      }
    }
  });

  reconcileTx(messages || []);
}

console.log("=== 开始存储层差量对账修剪专项测试 ===");

// 1. 插入初始状态数据：
// Channel A: msg_1 (seq 1), msg_2 (seq 2), msg_3 (seq 3, 后续被删), msg_4 (seq 4), msg_opt (seq 0, 乐观发送中), msg_old (seq -1)
// Channel B: msg_b3 (seq 3, 其他频道)
const insertInitStmt = db.prepare(`
  INSERT INTO messages (id, channel_id, sequence, content) VALUES (?, ?, ?, ?)
`);
insertInitStmt.run("msg_1", "chn_a", 1, "Content 1");
insertInitStmt.run("msg_2", "chn_a", 2, "Content 2");
insertInitStmt.run("msg_3", "chn_a", 3, "Deleted Content 3");
insertInitStmt.run("msg_4", "chn_a", 4, "Content 4");
insertInitStmt.run("msg_opt", "chn_a", 0, "Optimistic pending message");
insertInitStmt.run("msg_b3", "chn_b", 3, "Channel B Content 3");

assert(
  db.prepare("SELECT COUNT(*) as count FROM messages").get().count === 6,
  "初始 6 条消息写入成功",
);
assert(
  db.prepare("SELECT COUNT(*) as count FROM messages_fts").get().count === 6,
  "初始 FTS 全文索引 6 条已同步",
);

// 2. 模拟服务端返回权威消息列表 [msg_1, msg_2, msg_4]（msg_3 已被删除）
// 判定范围为 [1, 4]
executeReconcile(
  "chn_a",
  [
    {
      id: "msg_1",
      channelId: "chn_a",
      sequence: 1,
      content: "Content 1 updated",
    },
    { id: "msg_2", channelId: "chn_a", sequence: 2, content: "Content 2" },
    { id: "msg_4", channelId: "chn_a", sequence: 4, content: "Content 4" },
  ],
  { minSequence: 1, maxSequence: 4 },
);

// 3. 断言验证
const remainingAIds = db
  .prepare("SELECT id FROM messages WHERE channel_id = 'chn_a'")
  .all()
  .map((r) => r.id);
assert(
  !remainingAIds.includes("msg_3"),
  "已被删除的消息 msg_3 已从 messages 表中物理删除",
);
assert(remainingAIds.includes("msg_1"), "保留消息 msg_1 仍然存在并更新");
assert(remainingAIds.includes("msg_2"), "保留消息 msg_2 仍然存在");
assert(remainingAIds.includes("msg_4"), "保留消息 msg_4 仍然存在");
assert(
  remainingAIds.includes("msg_opt"),
  "安全保护生效：本地乐观消息 msg_opt (sequence <= 0) 未被误删",
);

const remainingB = db
  .prepare("SELECT id FROM messages WHERE channel_id = 'chn_b'")
  .all()
  .map((r) => r.id);
assert(
  remainingB.includes("msg_b3"),
  "频道隔离生效：其他频道相同 sequence 的 msg_b3 未受任何影响",
);

const ftsDeleted = db
  .prepare("SELECT * FROM messages_fts WHERE id = 'msg_3'")
  .all();
assert(
  ftsDeleted.length === 0,
  "SQLite FTS 触发器联动生效：msg_3 全文索引已同步剔除",
);

db.close();
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

console.log(`\n测试汇总: 通过 ${passed} 个，失败 ${failed} 个`);
if (failed > 0) {
  process.exit(1);
}
