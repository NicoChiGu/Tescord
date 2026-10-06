import {
  app,
  ipcMain,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess,
} from "electron";
import path from "node:path";
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
  private worker: UtilityProcess | null = null;
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
  private volatileActiveTokens: StoredActiveTokens | null = null;
  private cacheUsers = new Map<
    number,
    { userId: string | null; generation: number }
  >();
  private senderValidator?: (event: IpcMainInvokeEvent) => boolean;

  private constructor() {}

  public static getInstance(): StorageManager {
    if (!this.instance) {
      this.instance = new StorageManager();
    }
    return this.instance;
  }

  public setSenderValidator(
    validator: (event: IpcMainInvokeEvent) => boolean,
  ): void {
    this.senderValidator = validator;
  }

  private ensureTrustedSender(event?: IpcMainInvokeEvent): void {
    if (this.senderValidator && event && !this.senderValidator(event)) {
      throw new Error("Forbidden: Untrusted IPC sender");
    }
  }

  public initialize(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    const userDataDir = app.getPath("userData");
    // 独立 UtilityProcess 隔离 SQLite 原生模块，避免原生崩溃终止主进程。
    const workerScript = path.join(__dirname, "storageWorker.js");

    try {
      this.worker = utilityProcess.fork(workerScript, [], {
        env: {
          ...process.env,
          TESCORD_STORAGE_USER_DATA_DIR: userDataDir,
        },
        stdio: "pipe",
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

      this.worker.on("error", (type, location, report) => {
        console.error(
          "[StorageManager] Utility process error:",
          type,
          location,
          report,
        );
      });

      this.worker.on("exit", (code) => {
        console.warn(
          `[StorageManager] Storage process exited with code ${code}`,
        );
        this.worker = null;
        this.pendingRequests.forEach(({ reject, timer }) => {
          clearTimeout(timer);
          reject(new Error("[StorageManager] Storage process exited."));
        });
        this.pendingRequests.clear();
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

  private async sendCacheRequest<T>(
    event: IpcMainInvokeEvent,
    type: string,
    payload: object = {},
  ): Promise<T> {
    this.ensureTrustedSender(event);
    const senderId = event.sender.id;
    const binding = this.cacheUsers.get(senderId);
    if (!binding) throw new Error("Storage user is not bound to this window");
    const result = await this.sendWorkerRequest<T>(type, {
      ...payload,
      userId: binding.userId,
    });
    if (this.cacheUsers.get(senderId) !== binding) {
      throw new Error("Storage user changed while request was in flight");
    }
    return result;
  }

  public async hasRememberedSession(): Promise<boolean> {
    const tokens = await this.sendWorkerRequest<{
      remember?: boolean;
      encryptedAccessToken?: string | null;
      encryptedRefreshToken?: string | null;
    } | null>("tokens-get");
    return Boolean(
      SafeStorageCipher.isAvailable() &&
      tokens?.remember &&
      (tokens.encryptedAccessToken || tokens.encryptedRefreshToken),
    );
  }

  private registerIpcHandlers(): void {
    // 1. Preferences
    ipcMain.handle(
      STORAGE_IPC_CHANNELS.PREF_GET,
      async (event, key: string) => {
        this.ensureTrustedSender(event);
        return this.sendWorkerRequest<any>("pref-get", { key });
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.PREF_SET,
      async (event, { key, value }: { key: string; value: any }) => {
        this.ensureTrustedSender(event);
        return this.sendWorkerRequest<boolean>("pref-set", { key, value });
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.PREF_REMOVE,
      async (event, key: string) => {
        this.ensureTrustedSender(event);
        return this.sendWorkerRequest<boolean>("pref-remove", { key });
      },
    );

    // 2. Saved Accounts (配合 safeStorage 加解密)
    ipcMain.handle(STORAGE_IPC_CHANNELS.ACCOUNTS_GET, async (event) => {
      this.ensureTrustedSender(event);
      if (!SafeStorageCipher.isAvailable()) {
        throw new Error("Native credential encryption is unavailable");
      }
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
      async (event, accounts: SavedAccount[]) => {
        this.ensureTrustedSender(event);
        if (!SafeStorageCipher.isAvailable()) {
          throw new Error("Native credential encryption is unavailable");
        }
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
    ipcMain.handle(STORAGE_IPC_CHANNELS.TOKENS_GET, async (event) => {
      this.ensureTrustedSender(event);
      if (this.volatileActiveTokens) return this.volatileActiveTokens;
      const raw = await this.sendWorkerRequest<any>("tokens-get");
      if (!raw) return null;
      if (!raw.remember) {
        await this.sendWorkerRequest<boolean>("tokens-clear");
        return null;
      }
      if (!SafeStorageCipher.isAvailable()) return null;
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
        event,
        payload: {
          tokens: { accessToken: string; refreshToken: string; user: User };
          remember: boolean;
        },
      ) => {
        this.ensureTrustedSender(event);
        const { tokens, remember } = payload;
        if (!remember) {
          this.volatileActiveTokens = {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: tokens.user,
            remember: false,
            updatedAt: Date.now(),
          };
          return this.sendWorkerRequest<boolean>("tokens-clear");
        }
        this.volatileActiveTokens = null;
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

    ipcMain.handle(STORAGE_IPC_CHANNELS.TOKENS_CLEAR, async (event) => {
      this.ensureTrustedSender(event);
      this.volatileActiveTokens = null;
      return this.sendWorkerRequest<boolean>("tokens-clear");
    });

    // 4. User Switch
    ipcMain.handle(
      STORAGE_IPC_CHANNELS.USER_SWITCH,
      async (event, userId: string | null) => {
        this.ensureTrustedSender(event);
        if (
          userId !== null &&
          (typeof userId !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
            userId === "guest")
        ) {
          throw new Error("Invalid storage user ID");
        }
        const senderId = event.sender.id;
        const previous = this.cacheUsers.get(senderId);
        if (!previous) {
          event.sender.once("destroyed", () =>
            this.cacheUsers.delete(senderId),
          );
        }
        this.cacheUsers.set(senderId, {
          userId,
          generation: (previous?.generation ?? 0) + 1,
        });
        return true;
      },
    );

    // 5. Messages
    ipcMain.handle(
      STORAGE_IPC_CHANNELS.MESSAGES_SAVE_BATCH,
      async (event, payload: { channelId: string; messages: Message[] }) => {
        return this.sendCacheRequest<boolean>(
          event,
          "messages-save-batch",
          payload,
        );
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.MESSAGE_SAVE_SINGLE,
      async (event, message: Message) => {
        return this.sendCacheRequest<boolean>(event, "message-save-single", {
          message,
        });
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.MESSAGES_GET_LATEST,
      async (event, payload: { channelId: string; limit?: number }) => {
        return this.sendCacheRequest<Message[]>(
          event,
          "messages-get-latest",
          payload,
        );
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.CHANNEL_SNAPSHOT_GET,
      async (event, payload: { channelId: string; limit?: number }) => {
        return this.sendCacheRequest<any>(
          event,
          "channel-snapshot-get",
          payload,
        );
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.MESSAGE_DELETE,
      async (event, messageId: string) => {
        return this.sendCacheRequest<boolean>(event, "message-delete", {
          messageId,
        });
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.CHANNEL_META_SAVE,
      async (
        event,
        payload: { channelId: string; meta: Partial<ChannelMetaRecord> },
      ) => {
        return this.sendCacheRequest<boolean>(
          event,
          "channel-meta-save",
          payload,
        );
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.CHANNEL_META_GET,
      async (event, channelId: string) => {
        return this.sendCacheRequest<ChannelMetaRecord | null>(
          event,
          "channel-meta-get",
          { channelId },
        );
      },
    );

    ipcMain.handle(
      STORAGE_IPC_CHANNELS.CHANNEL_CLEAR,
      async (event, channelId: string) => {
        return this.sendCacheRequest<boolean>(event, "channel-clear", {
          channelId,
        });
      },
    );

    ipcMain.handle(STORAGE_IPC_CHANNELS.MESSAGES_CLEAR_ALL, async (event) => {
      return this.sendCacheRequest<boolean>(event, "messages-clear-all");
    });

    // 6. FTS5 Search
    ipcMain.handle(
      STORAGE_IPC_CHANNELS.MESSAGES_SEARCH_FTS,
      async (event, query: StorageSearchMessagesQuery) => {
        return this.sendCacheRequest<Message[]>(
          event,
          "messages-search-fts",
          query,
        );
      },
    );

    // 7. Stats
    ipcMain.handle(STORAGE_IPC_CHANNELS.STATS_GET, async (event) => {
      const stats = await this.sendCacheRequest<StorageStats>(
        event,
        "stats-get",
      );
      return {
        ...stats,
        isEncryptionAvailable: SafeStorageCipher.isAvailable(),
      };
    });
  }

  public destroy(): void {
    if (this.worker) {
      this.worker.kill();
      this.worker = null;
    }
    this.pendingRequests.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error("[StorageManager] Destroyed while request pending."));
    });
    this.pendingRequests.clear();
  }
}
