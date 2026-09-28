import type { IStorageAdapter } from "@tescord/types";
import { ElectronSqliteStorageAdapter } from "./ElectronSqliteStorageAdapter.js";
import { IndexedDBStorageAdapter } from "./IndexedDBStorageAdapter.js";
import { StorageMigrator } from "./StorageMigrator.js";

let storageAdapterInstance: IStorageAdapter | null = null;
let migrationResult: Promise<boolean> | null = null;

export function getStorageAdapter(): IStorageAdapter {
  if (!storageAdapterInstance) {
    if (typeof window !== "undefined" && window.electronAPI?.storage) {
      const nativeAdapter = new ElectronSqliteStorageAdapter();
      // 迁移使用独立实例。正常调用等迁移完成后才进入 worker，避免
      // IndexedDB 多用户导入切换 worker 当前用户时污染正在使用的缓存。
      migrationResult = StorageMigrator.runMigrationIfNeeded(nativeAdapter)
        .then(() => true)
        .catch((err) => {
          console.warn(
            "[StorageAdapter] Migration will retry on next start:",
            err,
          );
          return false;
        });
      storageAdapterInstance = new Proxy(nativeAdapter, {
        get(target, property, receiver) {
          const member = Reflect.get(target, property, receiver);
          if (typeof member !== "function") return member;
          return (...args: unknown[]) =>
            migrationResult!.then(() => member.apply(target, args));
        },
      });
    } else {
      storageAdapterInstance = new IndexedDBStorageAdapter();
    }
  }
  return storageAdapterInstance;
}

export function waitForStorageMigration(): Promise<boolean> {
  getStorageAdapter();
  return migrationResult || Promise.resolve(true);
}

export * from "./IndexedDBStorageAdapter.js";
export * from "./ElectronSqliteStorageAdapter.js";
export * from "./StorageMigrator.js";
