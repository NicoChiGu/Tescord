import type { IStorageAdapter } from "@tescord/types";
import { ElectronSqliteStorageAdapter } from "./ElectronSqliteStorageAdapter.js";
import { IndexedDBStorageAdapter } from "./IndexedDBStorageAdapter.js";
import { StorageMigrator } from "./StorageMigrator.js";

let storageAdapterInstance: IStorageAdapter | null = null;
let migrationTriggered = false;

export function getStorageAdapter(): IStorageAdapter {
  if (!storageAdapterInstance) {
    if (typeof window !== "undefined" && window.electronAPI?.storage) {
      storageAdapterInstance = new ElectronSqliteStorageAdapter();
      if (!migrationTriggered) {
        migrationTriggered = true;
        // 异步后台静默触发迁移，不阻塞 UI 渲染
        setTimeout(() => {
          StorageMigrator.runMigrationIfNeeded(storageAdapterInstance!).catch(
            (err) =>
              console.warn(
                "[StorageAdapter] Silent background migration warning:",
                err,
              ),
          );
        }, 100);
      }
    } else {
      storageAdapterInstance = new IndexedDBStorageAdapter();
    }
  }
  return storageAdapterInstance;
}

export * from "./IndexedDBStorageAdapter.js";
export * from "./ElectronSqliteStorageAdapter.js";
export * from "./StorageMigrator.js";
