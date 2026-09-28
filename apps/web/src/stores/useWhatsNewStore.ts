import { create } from "zustand";
import { WhatsNewModalMode, WhatsNewModalOptions } from "@tescord/types";
import { CURRENT_APP_VERSION } from "../data/changelogs.js";

export const WHATS_NEW_LAST_SEEN_KEY = "tescord_last_seen_changelog_version";

interface WhatsNewStoreState {
  isOpen: boolean;
  version: string;
  mode: WhatsNewModalMode;
  changelogOverride?: string;
  onRestartApply?: () => void | Promise<void>;

  openWhatsNew: (options?: WhatsNewModalOptions) => void;
  closeWhatsNew: () => void;
  markCurrentAsRead: (versionOverride?: string) => void;
}

export const useWhatsNewStore = create<WhatsNewStoreState>((set, get) => ({
  isOpen: false,
  version: CURRENT_APP_VERSION,
  mode: "view",
  changelogOverride: undefined,
  onRestartApply: undefined,

  openWhatsNew: (options?: WhatsNewModalOptions) => {
    set({
      isOpen: true,
      version: options?.version || CURRENT_APP_VERSION,
      mode: options?.mode || "view",
      changelogOverride: options?.changelogOverride,
      onRestartApply: options?.onRestartApply,
    });
  },

  closeWhatsNew: () => {
    const current = get();
    // 默认关闭或确认时均标记当前版本已读
    if (current.mode === "view") {
      try {
        localStorage.setItem(WHATS_NEW_LAST_SEEN_KEY, current.version);
      } catch {
        // 忽略私密模式 localStorage 异常
      }
    }
    set({ isOpen: false, onRestartApply: undefined });
  },

  markCurrentAsRead: (versionOverride?: string) => {
    try {
      const v = versionOverride || get().version || CURRENT_APP_VERSION;
      localStorage.setItem(WHATS_NEW_LAST_SEEN_KEY, v);
    } catch {
      // 忽略
    }
  },
}));
