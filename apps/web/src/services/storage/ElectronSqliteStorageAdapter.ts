import {
  IStorageAdapter,
  Message,
  ChannelMetaRecord,
  SavedAccount,
  StoredActiveTokens,
  StorageChannelSnapshot,
  StorageSearchMessagesQuery,
  StorageStats,
  User,
} from "@tescord/types";

export class ElectronSqliteStorageAdapter implements IStorageAdapter {
  private metaCache = new Map<string, ChannelMetaRecord>();
  private pendingSwitch: Promise<void> = Promise.resolve();

  private get nativeStorage(): IStorageAdapter {
    const s = window.electronAPI?.storage;
    if (!s) {
      throw new Error(
        "[ElectronSqliteStorageAdapter] window.electronAPI.storage is not available.",
      );
    }
    return s;
  }

  async getPreference<T = any>(key: string): Promise<T | null> {
    return this.nativeStorage.getPreference(key);
  }

  async setPreference<T = any>(key: string, value: T): Promise<void> {
    await this.nativeStorage.setPreference(key, value);
  }

  async removePreference(key: string): Promise<void> {
    await this.nativeStorage.removePreference(key);
  }

  async getSavedAccounts(): Promise<SavedAccount[]> {
    return this.nativeStorage.getSavedAccounts();
  }

  async saveSavedAccounts(accounts: SavedAccount[]): Promise<void> {
    await this.nativeStorage.saveSavedAccounts(accounts);
  }

  async getActiveTokens(): Promise<StoredActiveTokens | null> {
    return this.nativeStorage.getActiveTokens();
  }

  async setActiveTokens(
    tokens: { accessToken: string; refreshToken: string; user: User },
    remember: boolean,
  ): Promise<void> {
    await this.nativeStorage.setActiveTokens(tokens, remember);
  }

  async clearActiveTokens(): Promise<void> {
    await this.nativeStorage.clearActiveTokens();
  }

  async switchUser(userId: string | null): Promise<void> {
    if (
      userId !== null &&
      (typeof userId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
        userId === "guest")
    ) {
      throw new Error("Invalid storage user ID");
    }
    this.metaCache.clear();
    this.pendingSwitch = this.pendingSwitch
      .catch(() => {})
      .then(() => this.nativeStorage.switchUser(userId));
    await this.pendingSwitch;
  }

  async saveMessages(channelId: string, messages: Message[]): Promise<void> {
    await this.pendingSwitch;
    await this.nativeStorage.saveMessages(channelId, messages);
  }

  async saveMessage(msg: Message): Promise<void> {
    await this.pendingSwitch;
    await this.nativeStorage.saveMessage(msg);
  }

  async reconcileChannelMessages(
    channelId: string,
    authoritativeMessages: Message[],
    range: { minSequence: number; maxSequence: number },
  ): Promise<void> {
    await this.pendingSwitch;
    await this.nativeStorage.reconcileChannelMessages(
      channelId,
      authoritativeMessages,
      range,
    );
  }

  async getLatestMessages(channelId: string, limit = 100): Promise<Message[]> {
    await this.pendingSwitch;
    return this.nativeStorage.getLatestMessages(channelId, limit);
  }

  async getChannelSnapshot(
    channelId: string,
    limit = 100,
  ): Promise<StorageChannelSnapshot> {
    await this.pendingSwitch;
    return this.nativeStorage.getChannelSnapshot(channelId, limit);
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.pendingSwitch;
    await this.nativeStorage.deleteMessage(messageId);
  }

  async saveChannelMeta(
    channelId: string,
    meta: Partial<ChannelMetaRecord>,
  ): Promise<void> {
    await this.pendingSwitch;
    const cached = this.metaCache.get(channelId) || {
      channelId,
      lastReadSequence: 0,
      scrollTop: 0,
      isNearBottom: true,
      lastVisitedAt: Date.now(),
    };
    const updated: ChannelMetaRecord = {
      ...cached,
      ...meta,
      channelId,
      lastVisitedAt: Date.now(),
    };
    this.metaCache.set(channelId, updated);
    await this.nativeStorage.saveChannelMeta(channelId, meta);
  }

  async getChannelMeta(channelId: string): Promise<ChannelMetaRecord | null> {
    await this.pendingSwitch;
    if (this.metaCache.has(channelId)) {
      return this.metaCache.get(channelId)!;
    }
    const meta = await this.nativeStorage.getChannelMeta(channelId);
    if (meta) {
      this.metaCache.set(channelId, meta);
    }
    return meta;
  }

  async clearChannel(channelId: string): Promise<void> {
    await this.pendingSwitch;
    this.metaCache.delete(channelId);
    await this.nativeStorage.clearChannel(channelId);
  }

  async clearAllMessages(): Promise<void> {
    await this.pendingSwitch;
    this.metaCache.clear();
    await this.nativeStorage.clearAllMessages();
  }

  async searchMessages(query: StorageSearchMessagesQuery): Promise<Message[]> {
    await this.pendingSwitch;
    return this.nativeStorage.searchMessages(query);
  }

  async getStorageStats(): Promise<StorageStats> {
    if (this.nativeStorage.getStorageStats) {
      return this.nativeStorage.getStorageStats();
    }
    return {
      adapterType: "sqlite",
      isEncryptionAvailable: true,
    };
  }
}
