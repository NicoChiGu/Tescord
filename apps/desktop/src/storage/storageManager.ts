import { app, ipcMain } from "electron";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  STORAGE_IPC_CHANNELS,
  SavedAccount,
  User,
  Message,
  ChannelMetaRecord,
  StorageSearchMessagesQuery,
  StorageStats,
  StoredActiveTokens,
} from "@tescord/types";
import { SafeStorageCipher } from "./safeStorageCipher.js";

export class StorageManager {
  private static instance: StorageManager | null = null;
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (val: any) => void;
      reject: (err: any) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private requestIdCounter = 0;
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): StorageManager {
    if (!this.instance) {
      this.instance = new StorageManager();
    }
    return this.instance;
  }

  public initialize(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    const userDataDir = app.getPath("userData");
    // 根据是打包态还是开发态获取 storageWorker 路径
    const workerScript = path.join(__dirname, "storageWorker.js");

    try {
      this.worker = new Worker(workerScript, {
        workerData: { userDataDir },
      });

      this.worker.on(
        "message",
        (msg: {
          id: string;
          result?: any;
          error?: string;
          success: boolean;
        }) => {
          const { id, result, error, success } = msg;
          const pending = this.pendingRequests.get(id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(id);
            if (success) {
              pending.resolve(result);
            } else {
              pending.reject(new Error(error || "Worker execution failed"));
            }
          }
        },
      );

      this.worker.on("error", (err) => {
        console.error("[StorageManager] Worker thread uncaught error:", err);
      });

      this.worker.on("exit", (code) => {
        console.warn(`[StorageManager] Worker thread exited with code ${code}`);
        this.worker = null;
      });
    } catch (err) {
      console.error("[StorageManager] Failed to spawn storage worker:", err);
    }

    this.registerIpcHandlers();
  }

  private sendWorkerRequest<T>(type: string, payload: any = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        return reject(
          new Error("[StorageManager] Storage worker is not running."),
        );
      }

      const id = `req_${++this.requestIdCounter}_${Date.now()}`;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(`[StorageManager] Worker request '${type}' timed out.`),
        );
      }, 10000);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, payload });
    });
  }

  private registerIpcHandlers(): void {
    // 1. Preferences
    ipcMain.handle(
      STORAGE_IPC_CHANNELS.PREF_GET,
      async (_event, key: string) => {
        return this.sendWorkerRequest<any>("pref-get", { key });
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.PREF_SET,
      async (_event, { key, value }: { key: string; value: any }) => {
        return this.sendWorkerRequest<boolean>("pref-set", { key, value });
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.PREF_REMOVE,
      async (_event, key: string) => {
        return this.sendWorkerRequest<boolean>("pref-remove", { key });
      },
    );

    // 2. Saved Accounts (配合 safeStorage 加解密)
    ipcMain.handle(STORAGE_IPC_CHANNELS.ACCOUNTS_GET, async () => {
      const rawAccounts = await this.sendWorkerRequest<any[]>("accounts-get");
      return (rawAccounts || []).map((acc) => {
        let refreshToken: string | undefined = undefined;
        if (acc.encryptedRefreshToken) {
          const decrypted = SafeStorageCipher.decrypt(
            acc.encryptedRefreshToken,
          );
          if (decrypted) refreshToken = decrypted;
        }
        return {
          id: acc.id,
          email: acc.email,
          username: acc.username,
          displayName: acc.displayName,
          discriminator: acc.discriminator,
          avatarUrl: acc.avatarUrl,
          lastActiveAt: acc.lastActiveAt,
          rememberPassword: acc.rememberPassword,
          refreshToken,
        } as SavedAccount;
      });
    });

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.ACCOUNTS_SAVE,
      async (_event, accounts: SavedAccount[]) => {
        const encryptedAccounts = (accounts || []).map((acc) => ({
          id: acc.id,
          email: acc.email,
          username: acc.username,
          displayName: acc.displayName,
          discriminator: acc.discriminator,
          avatarUrl: acc.avatarUrl,
          lastActiveAt: acc.lastActiveAt,
          rememberPassword: acc.rememberPassword,
          encryptedRefreshToken: acc.refreshToken
            ? SafeStorageCipher.encrypt(acc.refreshToken)
            : null,
        }));
        return this.sendWorkerRequest<boolean>(
          "accounts-save",
          encryptedAccounts,
        );
      },
    );

    // 3. Active Tokens
    ipcMain.handle(STORAGE_IPC_CHANNELS.TOKENS_GET, async () => {
      const raw = await this.sendWorkerRequest<any>("tokens-get");
      if (!raw) return null;
      const accessToken = raw.encryptedAccessToken
        ? SafeStorageCipher.decrypt(raw.encryptedAccessToken)
        : "";
      const refreshToken = raw.encryptedRefreshToken
        ? SafeStorageCipher.decrypt(raw.encryptedRefreshToken)
        : "";
      return {
        accessToken: accessToken || "",
        refreshToken: refreshToken || "",
        user: raw.user,
        remember: raw.remember,
        updatedAt: raw.updatedAt,
      } as StoredActiveTokens;
    });

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.TOKENS_SET,
      async (
        _event,
        payload: {
          tokens: { accessToken: string; refreshToken: string; user: User };
          remember: boolean;
        },
      ) => {
        const { tokens, remember } = payload;
        const encryptedAccessToken = tokens.accessToken
          ? SafeStorageCipher.encrypt(tokens.accessToken)
          : null;
        const encryptedRefreshToken = tokens.refreshToken
          ? SafeStorageCipher.encrypt(tokens.refreshToken)
          : null;
        return this.sendWorkerRequest<boolean>("tokens-set", {
          encryptedAccessToken,
          encryptedRefreshToken,
          user: tokens.user,
          remember,
        });
      },
    );

    ipcMain.handle(STORAGE_IPC_CHANNELS.TOKENS_CLEAR, async () => {
      return this.sendWorkerRequest<boolean>("tokens-clear");
    });

    // 4. User Switch
    ipcMain.handle(
      STORAGE_IPC_CHANNELS.USER_SWITCH,
      async (_event, userId: string | null) => {
        return this.sendWorkerRequest<boolean>("user-switch", { userId });
      },
    );

    // 5. Messages
    ipcMain.handle(
      STORAGE_IPC_CHANNELS.MESSAGES_SAVE_BATCH,
      async (_event, payload: { channelId: string; messages: Message[] }) => {
        return this.sendWorkerRequest<boolean>("messages-save-batch", payload);
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.MESSAGE_SAVE_SINGLE,
      async (_event, message: Message) => {
        return this.sendWorkerRequest<boolean>("message-save-single", {
          message,
        });
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.MESSAGES_GET_LATEST,
      async (_event, payload: { channelId: string; limit?: number }) => {
        return this.sendWorkerRequest<Message[]>(
          "messages-get-latest",
          payload,
        );
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.CHANNEL_SNAPSHOT_GET,
      async (_event, payload: { channelId: string; limit?: number }) => {
        return this.sendWorkerRequest<any>("channel-snapshot-get", payload);
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.MESSAGE_DELETE,
      async (_event, messageId: string) => {
        return this.sendWorkerRequest<boolean>("message-delete", { messageId });
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.CHANNEL_META_SAVE,
      async (
        _event,
        payload: { channelId: string; meta: Partial<ChannelMetaRecord> },
      ) => {
        return this.sendWorkerRequest<boolean>("channel-meta-save", payload);
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.CHANNEL_META_GET,
      async (_event, channelId: string) => {
        return this.sendWorkerRequest<ChannelMetaRecord | null>(
          "channel-meta-get",
          { channelId },
        );
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.CHANNEL_CLEAR,
      async (_event, channelId: string) => {
        return this.sendWorkerRequest<boolean>("channel-clear", { channelId });
      },
    );

    ipcMain.handle(STORAGE_IPC_CHANNELS.MESSAGES_CLEAR_ALL, async () => {
      return this.sendWorkerRequest<boolean>("messages-clear-all");
    });

    // 6. FTS5 Search
    ipcMain.handle(
      STORAGE_IPC_CHANNELS.MESSAGES_SEARCH_FTS,
      async (_event, query: StorageSearchMessagesQuery) => {
        return this.sendWorkerRequest<Message[]>("messages-search-fts", query);
      },
    );

    // 7. Stats
    ipcMain.handle(STORAGE_IPC_CHANNELS.STATS_GET, async () => {
      const stats = await this.sendWorkerRequest<StorageStats>("stats-get");
      return {
        ...stats,
        isEncryptionAvailable: SafeStorageCipher.isAvailable(),
      };
    });
  }

  public destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error("[StorageManager] Destroyed while request pending."));
    });
    this.pendingRequests.clear();
  }
}
