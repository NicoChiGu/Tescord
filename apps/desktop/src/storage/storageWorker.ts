import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { Database as DatabaseInstance } from "better-sqlite3";
import type {
  Message,
  ChannelMetaRecord,
  StorageSearchMessagesQuery,
  StorageChannelSnapshot,
  StorageStats,
} from "@tescord/types";

interface WorkerInitData {
  userDataDir: string;
}

const { userDataDir } = {
  ...((workerData || {}) as Partial<WorkerInitData>),
  userDataDir:
    ((workerData || {}) as Partial<WorkerInitData>).userDataDir ||
    process.env.TESCORD_STORAGE_USER_DATA_DIR,
};
const utilityParentPort = process.parentPort;
const sendResponse = (response: unknown): void => {
  if (parentPort) parentPort.postMessage(response);
  else utilityParentPort?.postMessage(response);
};
const MAX_MESSAGES_PER_CHANNEL = 5000;

if (!userDataDir) {
  throw new Error(
    "[StorageWorker] userDataDir is required to initialize SQLite storage worker.",
  );
}

// 确保目录存在
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

// 1. 初始化全局 app.db
const appDbPath = path.join(userDataDir, "app.db");
const appDb: DatabaseInstance = new Database(appDbPath);
appDb.pragma("journal_mode = WAL");
appDb.pragma("synchronous = NORMAL");

// 初始化 app.db 表结构
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

// 2. 当前活跃用户的 cache.db
let currentUserId: string | null = null;
let currentCacheDb: DatabaseInstance | null = null;
let currentCacheDbPath: string | null = null;

function getCacheDb(userId: string | null): DatabaseInstance {
  if (
    userId !== null &&
    (typeof userId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
      userId === "guest")
  ) {
    throw new Error("Invalid storage user ID");
  }
  const effectiveId = userId || "guest";
  if (currentCacheDb && currentUserId === effectiveId) {
    return currentCacheDb;
  }

  if (currentCacheDb) {
    try {
      currentCacheDb.close();
    } catch {}
    currentCacheDb = null;
  }

  const userDir = path.join(userDataDir!, "users", effectiveId);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  currentCacheDbPath = path.join(userDir, "cache.db");
  const db = new Database(currentCacheDbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // 初始化 cache.db 表结构与 FTS5
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

    CREATE TRIGGER IF NOT EXISTS trig_messages_au AFTER UPDATE ON messages BEGIN
      DELETE FROM messages_fts WHERE id = old.id;
      INSERT INTO messages_fts(id, channel_id, content) VALUES (new.id, new.channel_id, new.content);
    END;

    CREATE TABLE IF NOT EXISTS channel_meta (
      channel_id TEXT PRIMARY KEY,
      last_read_sequence INTEGER DEFAULT 0,
      scroll_top INTEGER DEFAULT 0,
      is_near_bottom INTEGER DEFAULT 1,
      last_visited_at INTEGER DEFAULT 0
    );
  `);

  currentUserId = effectiveId;
  currentCacheDb = db;
  return db;
}

// 辅助函数：将 DB 行映射为 Message 对象
function rowToMessage(row: any): Message {
  return {
    id: row.id,
    channelId: row.channel_id,
    sequence: row.sequence,
    authorId: row.author_id,
    author: row.author_json
      ? JSON.parse(row.author_json)
      : { id: row.author_id, username: "Unknown" },
    content: row.content || "",
    isEncrypted: Boolean(row.is_encrypted),
    replyTo: row.reply_to_json ? JSON.parse(row.reply_to_json) : null,
    isPinned: Boolean(row.is_pinned),
    reactions: row.reactions_json ? JSON.parse(row.reactions_json) : [],
    attachments: row.attachments_json ? JSON.parse(row.attachments_json) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 辅助函数：单频道超额 LRU 淘汰
function pruneChannelMessages(db: DatabaseInstance, channelId: string): void {
  const countRow = db
    .prepare("SELECT COUNT(*) as count FROM messages WHERE channel_id = ?")
    .get(channelId) as { count: number };
  if (countRow && countRow.count > MAX_MESSAGES_PER_CHANNEL) {
    const overflow = countRow.count - MAX_MESSAGES_PER_CHANNEL;
    db.prepare(
      `
      DELETE FROM messages WHERE id IN (
        SELECT id FROM messages WHERE channel_id = ? ORDER BY sequence ASC, created_at ASC LIMIT ?
      )
    `,
    ).run(channelId, overflow);
  }
}

// 3. 处理主线程请求消息
const handleRequest = (req: { id: string; type: string; payload: any }) => {
  const { id, type, payload } = req;
  try {
    let result: any = null;

    switch (type) {
      // --- Preferences ---
      case "pref-get": {
        const row = appDb
          .prepare("SELECT value FROM preferences WHERE key = ?")
          .get(payload.key) as { value: string } | undefined;
        result = row ? JSON.parse(row.value) : null;
        break;
      }
      case "pref-set": {
        const stmt = appDb.prepare(`
          INSERT INTO preferences (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `);
        stmt.run(payload.key, JSON.stringify(payload.value), Date.now());
        result = true;
        break;
      }
      case "pref-remove": {
        appDb.prepare("DELETE FROM preferences WHERE key = ?").run(payload.key);
        result = true;
        break;
      }

      // --- Saved Accounts ---
      case "accounts-get": {
        const rows = appDb
          .prepare(
            `
          SELECT id, email, username, display_name, discriminator, avatar_url, last_active_at, remember_password, encrypted_refresh_token
          FROM saved_accounts
          ORDER BY last_active_at DESC
        `,
          )
          .all() as any[];
        result = rows.map((r) => ({
          id: r.id,
          email: r.email,
          username: r.username,
          displayName: r.display_name,
          discriminator: r.discriminator,
          avatarUrl: r.avatar_url,
          lastActiveAt: r.last_active_at,
          rememberPassword: Boolean(r.remember_password),
          encryptedRefreshToken: r.encrypted_refresh_token, // 待主进程 safeStorage 解密
        }));
        break;
      }
      case "accounts-save": {
        // payload: Array<{ account: SavedAccount; encryptedTokenBuffer: Buffer | null }>
        const insertStmt = appDb.prepare(`
          INSERT INTO saved_accounts (id, email, username, display_name, discriminator, avatar_url, last_active_at, remember_password, encrypted_refresh_token)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            username = excluded.username,
            display_name = excluded.display_name,
            discriminator = excluded.discriminator,
            avatar_url = excluded.avatar_url,
            last_active_at = excluded.last_active_at,
            remember_password = excluded.remember_password,
            encrypted_refresh_token = excluded.encrypted_refresh_token
        `);
        const saveAll = appDb.transaction((accounts: any[]) => {
          appDb.prepare("DELETE FROM saved_accounts").run();
          for (const item of accounts) {
            insertStmt.run(
              item.id,
              item.email || "",
              item.username,
              item.displayName || null,
              item.discriminator || null,
              item.avatarUrl || null,
              item.lastActiveAt || Date.now(),
              item.rememberPassword ? 1 : 0,
              item.encryptedRefreshToken || null,
            );
          }
        });
        saveAll(payload || []);
        result = true;
        break;
      }

      // --- Active Tokens ---
      case "tokens-get": {
        const row = appDb
          .prepare("SELECT * FROM active_tokens WHERE id = 'current'")
          .get() as any;
        if (row) {
          result = {
            encryptedAccessToken: row.encrypted_access_token,
            encryptedRefreshToken: row.encrypted_refresh_token,
            user: row.user_json ? JSON.parse(row.user_json) : null,
            remember: Boolean(row.remember),
            updatedAt: row.updated_at,
          };
        } else {
          result = null;
        }
        break;
      }
      case "tokens-set": {
        if (!payload.remember) {
          appDb.prepare("DELETE FROM active_tokens WHERE id = 'current'").run();
          result = true;
          break;
        }
        const stmt = appDb.prepare(`
          INSERT INTO active_tokens (id, encrypted_access_token, encrypted_refresh_token, user_json, remember, updated_at)
          VALUES ('current', ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            encrypted_access_token = excluded.encrypted_access_token,
            encrypted_refresh_token = excluded.encrypted_refresh_token,
            user_json = excluded.user_json,
            remember = excluded.remember,
            updated_at = excluded.updated_at
        `);
        stmt.run(
          payload.encryptedAccessToken || null,
          payload.encryptedRefreshToken || null,
          JSON.stringify(payload.user),
          payload.remember ? 1 : 0,
          Date.now(),
        );
        result = true;
        break;
      }
      case "tokens-clear": {
        appDb.prepare("DELETE FROM active_tokens WHERE id = 'current'").run();
        result = true;
        break;
      }

      // --- User Switch ---
      case "user-switch": {
        getCacheDb(payload.userId);
        result = true;
        break;
      }

      // --- Messages ---
      case "messages-save-batch": {
        const { channelId, messages } = payload as {
          channelId: string;
          messages: Message[];
        };
        if (messages && messages.length > 0) {
          const db = getCacheDb(payload.userId);
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

          const batchTx = db.transaction((msgs: Message[]) => {
            for (const msg of msgs) {
              insertStmt.run(
                msg.id,
                msg.channelId || channelId,
                msg.sequence || 0,
                msg.authorId || msg.author?.id || "unknown",
                JSON.stringify(
                  msg.author || { id: msg.authorId, username: "Unknown" },
                ),
                msg.content || "",
                msg.isEncrypted ? 1 : 0,
                msg.replyTo ? JSON.stringify(msg.replyTo) : null,
                msg.isPinned ? 1 : 0,
                msg.reactions ? JSON.stringify(msg.reactions) : null,
                msg.attachments ? JSON.stringify(msg.attachments) : null,
                msg.createdAt || new Date().toISOString(),
                msg.updatedAt || new Date().toISOString(),
              );
            }
            pruneChannelMessages(db, channelId);
          });

          batchTx(messages);
        }
        result = true;
        break;
      }

      case "message-save-single": {
        const msg = payload.message as Message;
        if (msg && msg.channelId) {
          const db = getCacheDb(payload.userId);
          db.prepare(
            `
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
          `,
          ).run(
            msg.id,
            msg.channelId,
            msg.sequence || 0,
            msg.authorId || msg.author?.id || "unknown",
            JSON.stringify(
              msg.author || { id: msg.authorId, username: "Unknown" },
            ),
            msg.content || "",
            msg.isEncrypted ? 1 : 0,
            msg.replyTo ? JSON.stringify(msg.replyTo) : null,
            msg.isPinned ? 1 : 0,
            msg.reactions ? JSON.stringify(msg.reactions) : null,
            msg.attachments ? JSON.stringify(msg.attachments) : null,
            msg.createdAt || new Date().toISOString(),
            msg.updatedAt || new Date().toISOString(),
          );
        }
        result = true;
        break;
      }

      case "messages-get-latest": {
        const { channelId, limit = 100 } = payload;
        const db = getCacheDb(payload.userId);
        const rows = db
          .prepare(
            `
          SELECT * FROM (
            SELECT * FROM messages
            WHERE channel_id = ?
            ORDER BY sequence DESC, created_at DESC, id DESC
            LIMIT ?
          ) ORDER BY sequence ASC, created_at ASC, id ASC
        `,
          )
          .all(channelId, limit);
        result = rows.map(rowToMessage);
        break;
      }

      case "channel-snapshot-get": {
        const { channelId, limit = 100 } = payload;
        const db = getCacheDb(payload.userId);

        const rows = db
          .prepare(
            `
          SELECT * FROM (
            SELECT * FROM messages
            WHERE channel_id = ?
            ORDER BY sequence DESC, created_at DESC
            LIMIT ?
          ) ORDER BY sequence ASC, created_at ASC
        `,
          )
          .all(channelId, limit);

        const metaRow = db
          .prepare("SELECT * FROM channel_meta WHERE channel_id = ?")
          .get(channelId) as any;
        const meta: ChannelMetaRecord = metaRow
          ? {
              channelId: metaRow.channel_id,
              lastReadSequence: metaRow.last_read_sequence,
              scrollTop: metaRow.scroll_top,
              isNearBottom: Boolean(metaRow.is_near_bottom),
              lastVisitedAt: metaRow.last_visited_at,
            }
          : {
              channelId,
              lastReadSequence: 0,
              scrollTop: 0,
              isNearBottom: true,
              lastVisitedAt: Date.now(),
            };

        const snapshot: StorageChannelSnapshot = {
          messages: rows.map(rowToMessage),
          meta,
        };
        result = snapshot;
        break;
      }

      case "message-delete": {
        const db = getCacheDb(payload.userId);
        db.prepare("DELETE FROM messages WHERE id = ?").run(payload.messageId);
        result = true;
        break;
      }

      case "channel-meta-save": {
        const { channelId, meta } = payload;
        const db = getCacheDb(payload.userId);
        const existing =
          (db
            .prepare("SELECT * FROM channel_meta WHERE channel_id = ?")
            .get(channelId) as any) || {};

        const updated = {
          channelId,
          lastReadSequence:
            meta.lastReadSequence ?? existing.last_read_sequence ?? 0,
          scrollTop: meta.scrollTop ?? existing.scroll_top ?? 0,
          isNearBottom:
            (meta.isNearBottom ?? Boolean(existing.is_near_bottom ?? true))
              ? 1
              : 0,
          lastVisitedAt: meta.lastVisitedAt ?? Date.now(),
        };

        db.prepare(
          `
          INSERT INTO channel_meta (channel_id, last_read_sequence, scroll_top, is_near_bottom, last_visited_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(channel_id) DO UPDATE SET
            last_read_sequence = excluded.last_read_sequence,
            scroll_top = excluded.scroll_top,
            is_near_bottom = excluded.is_near_bottom,
            last_visited_at = excluded.last_visited_at
        `,
        ).run(
          updated.channelId,
          updated.lastReadSequence,
          updated.scrollTop,
          updated.isNearBottom,
          updated.lastVisitedAt,
        );
        result = true;
        break;
      }

      case "channel-meta-get": {
        const db = getCacheDb(payload.userId);
        const row = db
          .prepare("SELECT * FROM channel_meta WHERE channel_id = ?")
          .get(payload.channelId) as any;
        if (row) {
          result = {
            channelId: row.channel_id,
            lastReadSequence: row.last_read_sequence,
            scrollTop: row.scroll_top,
            isNearBottom: Boolean(row.is_near_bottom),
            lastVisitedAt: row.last_visited_at,
          } as ChannelMetaRecord;
        } else {
          result = null;
        }
        break;
      }

      case "channel-clear": {
        const db = getCacheDb(payload.userId);
        db.prepare("DELETE FROM messages WHERE channel_id = ?").run(
          payload.channelId,
        );
        result = true;
        break;
      }

      case "messages-clear-all": {
        const db = getCacheDb(payload.userId);
        db.prepare("DELETE FROM messages").run();
        db.prepare("DELETE FROM channel_meta").run();
        result = true;
        break;
      }

      // --- FTS5 Search ---
      case "messages-search-fts": {
        const {
          keyword,
          channelId,
          limit = 50,
        } = payload as StorageSearchMessagesQuery;
        if (!keyword || !keyword.trim()) {
          result = [];
          break;
        }
        const db = getCacheDb(payload.userId);

        // 清理并转义关键词以供 FTS5 MATCH 使用
        const sanitized = keyword.replace(/['"*]/g, "").trim();
        if (!sanitized) {
          result = [];
          break;
        }
        const ftsQuery = `"${sanitized}"*`;

        let rows: any[];
        if (channelId) {
          rows = db
            .prepare(
              `
            SELECT m.*
            FROM messages m
            JOIN messages_fts f ON m.id = f.id
            WHERE messages_fts MATCH ? AND m.channel_id = ?
            ORDER BY m.created_at DESC
            LIMIT ?
          `,
            )
            .all(ftsQuery, channelId, limit);
        } else {
          rows = db
            .prepare(
              `
            SELECT m.*
            FROM messages m
            JOIN messages_fts f ON m.id = f.id
            WHERE messages_fts MATCH ?
            ORDER BY m.created_at DESC
            LIMIT ?
          `,
            )
            .all(ftsQuery, limit);
        }
        result = rows.map(rowToMessage);
        break;
      }

      // --- Stats ---
      case "stats-get": {
        const db = getCacheDb(payload.userId);
        let appDbSize = 0;
        let userDbSize = 0;
        let messageCount = 0;

        try {
          if (fs.existsSync(appDbPath)) {
            appDbSize = fs.statSync(appDbPath).size;
          }
          if (currentCacheDbPath && fs.existsSync(currentCacheDbPath)) {
            userDbSize = fs.statSync(currentCacheDbPath).size;
          }
          const countRow = db
            .prepare("SELECT COUNT(*) as c FROM messages")
            .get() as { c: number };
          messageCount = countRow ? countRow.c : 0;
        } catch {}

        const stats: StorageStats = {
          adapterType: "sqlite",
          appDbSize,
          userDbSize,
          messageCount,
        };
        result = stats;
        break;
      }

      default:
        throw new Error(`[StorageWorker] Unknown request type: ${type}`);
    }

    sendResponse({ id, result, success: true });
  } catch (err: any) {
    console.error(`[StorageWorker] Error handling ${type}:`, err);
    sendResponse({
      id,
      error: err?.message || String(err),
      success: false,
    });
  }
};

if (parentPort) parentPort.on("message", handleRequest);
else utilityParentPort?.on("message", (event) => handleRequest(event.data));
