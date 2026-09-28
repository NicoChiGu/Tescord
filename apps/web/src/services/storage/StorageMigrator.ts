import { openDB } from "idb";
import type {
  IStorageAdapter,
  SavedAccount,
  User,
  Message,
  ChannelMetaRecord,
} from "@tescord/types";

const MIGRATION_FLAG_KEY = "tescord_storage_migrated_v1";

export class StorageMigrator {
  private static isMigrating = false;

  public static async runMigrationIfNeeded(
    targetAdapter: IStorageAdapter,
  ): Promise<void> {
    if (this.isMigrating) return;
    this.isMigrating = true;

    try {
      // 1. 检查是否已经迁移完毕
      const migrated =
        await targetAdapter.getPreference<boolean>(MIGRATION_FLAG_KEY);
      if (migrated) {
        return;
      }

      console.info(
        "[StorageMigrator] Starting silent migration from IndexedDB/localStorage to SQLite...",
      );

      // 2. 迁移 localStorage 多账号信息
      try {
        const rawAccounts = localStorage.getItem("tescord_saved_accounts");
        if (rawAccounts) {
          const accounts = JSON.parse(rawAccounts) as SavedAccount[];
          if (Array.isArray(accounts) && accounts.length > 0) {
            await targetAdapter.saveSavedAccounts(accounts);
            console.info(
              `[StorageMigrator] Migrated ${accounts.length} saved accounts to SQLite.`,
            );
          }
        }
      } catch (err) {
        console.warn("[StorageMigrator] Migrating saved accounts failed:", err);
      }

      // 3. 迁移活跃 Token 与会话
      try {
        const accessToken =
          sessionStorage.getItem("tescord_access_token") ||
          localStorage.getItem("tescord_access_token");
        const refreshToken =
          sessionStorage.getItem("tescord_refresh_token") ||
          localStorage.getItem("tescord_refresh_token");
        const userRaw = localStorage.getItem("tescord_last_user");

        if (accessToken && refreshToken && userRaw) {
          const user = JSON.parse(userRaw) as User;
          const remember = Boolean(
            localStorage.getItem("tescord_access_token"),
          );
          await targetAdapter.setActiveTokens(
            { accessToken, refreshToken, user },
            remember,
          );
          console.info(
            "[StorageMigrator] Migrated active session tokens to SQLite.",
          );
        }
      } catch (err) {
        console.warn("[StorageMigrator] Migrating tokens failed:", err);
      }

      // 4. 迁移用户偏好与设置
      try {
        const settingsRaw = localStorage.getItem("tescord_user_settings");
        if (settingsRaw) {
          await targetAdapter.setPreference(
            "tescord_user_settings",
            JSON.parse(settingsRaw),
          );
          console.info("[StorageMigrator] Migrated user settings to SQLite.");
        }
      } catch (err) {
        console.warn("[StorageMigrator] Migrating settings failed:", err);
      }

      // 5. 迁移 IndexedDB 历史消息与元数据仓库
      await this.migrateIndexedDatabases(targetAdapter);

      // 6. 标记迁移完成
      await targetAdapter.setPreference(MIGRATION_FLAG_KEY, true);
      console.info("[StorageMigrator] Migration successfully completed!");
    } catch (err) {
      console.error("[StorageMigrator] Migration encountered an error:", err);
    } finally {
      this.isMigrating = false;
    }
  }

  private static async migrateIndexedDatabases(
    targetAdapter: IStorageAdapter,
  ): Promise<void> {
    const candidateDbs: string[] = [];

    // 检测当前环境中的 IndexedDB 数据库
    if (
      typeof indexedDB !== "undefined" &&
      typeof (indexedDB as any).databases === "function"
    ) {
      try {
        const dbs = await (indexedDB as any).databases();
        for (const dbInfo of dbs) {
          if (dbInfo.name && dbInfo.name.startsWith("tescord-client-db-")) {
            candidateDbs.push(dbInfo.name);
          }
        }
      } catch (err) {
        console.warn("[StorageMigrator] indexedDB.databases() failed:", err);
      }
    }

    // 兜底候选：包含 guest 库以及当前可能存储的 lastUser 库
    if (candidateDbs.length === 0) {
      candidateDbs.push("tescord-client-db-guest");
      try {
        const userRaw = localStorage.getItem("tescord_last_user");
        if (userRaw) {
          const u = JSON.parse(userRaw);
          if (u.id) {
            candidateDbs.push(`tescord-client-db-${u.id}`);
          }
        }
      } catch {}
    }

    for (const dbName of candidateDbs) {
      try {
        const userId = dbName.replace("tescord-client-db-", "");
        const oldDb = await openDB(dbName, 1);

        // 迁移消息
        if (oldDb.objectStoreNames.contains("messages")) {
          const messages = (await oldDb.getAll("messages")) as Message[];
          if (messages && messages.length > 0) {
            await targetAdapter.switchUser(userId === "guest" ? null : userId);
            // 按频道分组
            const channelGroups = new Map<string, Message[]>();
            for (const msg of messages) {
              const cid = msg.channelId || "default";
              const group = channelGroups.get(cid) || [];
              group.push(msg);
              channelGroups.set(cid, group);
            }

            for (const [channelId, msgs] of channelGroups.entries()) {
              await targetAdapter.saveMessages(channelId, msgs);
            }
            console.info(
              `[StorageMigrator] Migrated ${messages.length} messages from ${dbName} to SQLite.`,
            );
          }
        }

        // 迁移频道元数据
        if (oldDb.objectStoreNames.contains("channel_meta")) {
          const metas = (await oldDb.getAll(
            "channel_meta",
          )) as ChannelMetaRecord[];
          if (metas && metas.length > 0) {
            for (const meta of metas) {
              await targetAdapter.saveChannelMeta(meta.channelId, meta);
            }
            console.info(
              `[StorageMigrator] Migrated ${metas.length} channel meta records from ${dbName} to SQLite.`,
            );
          }
        }

        oldDb.close();

        // 迁移成功后安全移除旧 IndexedDB 释放磁盘
        try {
          indexedDB.deleteDatabase(dbName);
          console.info(
            `[StorageMigrator] Cleaned up legacy IndexedDB: ${dbName}`,
          );
        } catch {}
      } catch (err) {
        // 单个库迁移失败不影响整体流程
        console.warn(
          `[StorageMigrator] Could not migrate database ${dbName}:`,
          err,
        );
      }
    }
  }
}
