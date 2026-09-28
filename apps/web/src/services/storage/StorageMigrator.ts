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
  private static migrationPromise: Promise<void> | null = null;

  public static async runMigrationIfNeeded(
    targetAdapter: IStorageAdapter,
  ): Promise<void> {
    if (this.migrationPromise) return this.migrationPromise;
    this.migrationPromise = this.migrate(targetAdapter);
    try {
      await this.migrationPromise;
    } finally {
      this.migrationPromise = null;
    }
  }

  private static async migrate(targetAdapter: IStorageAdapter): Promise<void> {
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
      const rawAccounts = localStorage.getItem("tescord_saved_accounts");
      if (rawAccounts) {
        const accounts = JSON.parse(rawAccounts) as SavedAccount[];
        if (!Array.isArray(accounts)) throw new Error("Invalid saved accounts");
        if (accounts.length > 0) {
          const existing = await targetAdapter.getSavedAccounts();
          const merged = new Map(
            existing.map((account) => [account.id, account]),
          );
          for (const account of accounts) {
            const stored = merged.get(account.id);
            merged.set(account.id, {
              ...account,
              ...stored,
              refreshToken: stored?.refreshToken || account.refreshToken,
            });
          }
          await targetAdapter.saveSavedAccounts([...merged.values()]);
          console.info(
            `[StorageMigrator] Migrated ${accounts.length} saved accounts to SQLite.`,
          );
        }
      }

      // 3. 迁移活跃 Token 与会话
      {
        const accessToken =
          sessionStorage.getItem("tescord_access_token") ||
          localStorage.getItem("tescord_access_token");
        const refreshToken =
          sessionStorage.getItem("tescord_refresh_token") ||
          localStorage.getItem("tescord_refresh_token");
        const userRaw = localStorage.getItem("tescord_last_user");

        if (
          accessToken &&
          refreshToken &&
          userRaw &&
          !(await targetAdapter.getActiveTokens())
        ) {
          const user = JSON.parse(userRaw) as User;
          const remember = Boolean(
            localStorage.getItem("tescord_refresh_token"),
          );
          await targetAdapter.setActiveTokens(
            { accessToken, refreshToken, user },
            remember,
          );
          console.info(
            "[StorageMigrator] Migrated active session tokens to SQLite.",
          );
        }
      }

      // 4. 迁移用户偏好与设置
      const settingsRaw = localStorage.getItem("tescord_user_settings");
      if (
        settingsRaw &&
        (await targetAdapter.getPreference("tescord_user_settings")) === null
      ) {
        await targetAdapter.setPreference(
          "tescord_user_settings",
          JSON.parse(settingsRaw),
        );
        console.info("[StorageMigrator] Migrated user settings to SQLite.");
      }

      // 5. 迁移 IndexedDB 历史消息与元数据仓库
      await this.migrateIndexedDatabases(targetAdapter);

      // 6. 标记迁移完成
      await targetAdapter.setPreference(MIGRATION_FLAG_KEY, true);
      console.info("[StorageMigrator] Migration successfully completed!");
    } catch (err) {
      console.error("[StorageMigrator] Migration encountered an error:", err);
      throw err;
    }
  }

  private static async migrateIndexedDatabases(
    targetAdapter: IStorageAdapter,
  ): Promise<void> {
    const candidateDbs: string[] = [];

    // 检测当前环境中的 IndexedDB 数据库
    if (
      typeof indexedDB === "undefined" ||
      typeof (indexedDB as any).databases !== "function"
    ) {
      throw new Error("IndexedDB database enumeration is unavailable");
    }
    const dbs = await (indexedDB as any).databases();
    for (const dbInfo of dbs) {
      if (dbInfo.name && dbInfo.name.startsWith("tescord-client-db-")) {
        candidateDbs.push(dbInfo.name);
      }
    }

    const activeUserId =
      (await targetAdapter.getActiveTokens())?.user?.id || null;
    try {
      for (const dbName of candidateDbs) {
        try {
          const userId = dbName.replace("tescord-client-db-", "");
          if (userId !== "guest" && !/^[A-Za-z0-9_-]{1,128}$/.test(userId)) {
            throw new Error("Invalid legacy storage user ID");
          }
          const oldDb = await openDB(dbName, 1);
          try {
            await targetAdapter.switchUser(userId === "guest" ? null : userId);

            // 迁移消息
            if (oldDb.objectStoreNames.contains("messages")) {
              const messages = (await oldDb.getAll("messages")) as Message[];
              if (messages && messages.length > 0) {
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
          } finally {
            oldDb.close();
          }
        } catch (err) {
          console.warn(
            `[StorageMigrator] Could not migrate database ${dbName}:`,
            err,
          );
          throw err;
        }
      }
    } finally {
      await targetAdapter.switchUser(activeUserId);
    }
  }
}
