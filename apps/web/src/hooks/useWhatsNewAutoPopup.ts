import { useEffect, useRef } from "react";
import {
  useWhatsNewStore,
  WHATS_NEW_LAST_SEEN_KEY,
} from "../stores/useWhatsNewStore.js";
import { CURRENT_APP_VERSION } from "../data/changelogs.js";

/**
 * 比较两个语义化版本号 v1 是否大于 v2
 */
export function isVersionGreater(v1: string, v2: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(".")
      .map((part) => parseInt(part, 10) || 0);

  const p1 = parse(v1);
  const p2 = parse(v2);
  const len = Math.max(p1.length, p2.length);

  for (let i = 0; i < len; i++) {
    const num1 = p1[i] ?? 0;
    const num2 = p2[i] ?? 0;
    if (num1 > num2) return true;
    if (num1 < num2) return false;
  }
  return false;
}

export function useWhatsNewAutoPopup(
  isAuthenticated: boolean,
  isLoading: boolean = false,
) {
  const hasCheckedRef = useRef(false);
  const openWhatsNew = useWhatsNewStore((s) => s.openWhatsNew);

  useEffect(() => {
    // 监听全局 CustomEvent 供任意页面快捷唤起
    const handleGlobalTrigger = (e: Event) => {
      const customEvent = e as CustomEvent<{
        version?: string;
        mode?: "view" | "ready_to_restart";
        changelogOverride?: string;
      }>;
      openWhatsNew(customEvent.detail);
    };

    window.addEventListener("tescord:open-whats-new", handleGlobalTrigger);
    return () => {
      window.removeEventListener("tescord:open-whats-new", handleGlobalTrigger);
    };
  }, [openWhatsNew]);

  useEffect(() => {
    if (!isAuthenticated || isLoading || hasCheckedRef.current) {
      return;
    }

    hasCheckedRef.current = true;

    try {
      const lastSeen = localStorage.getItem(WHATS_NEW_LAST_SEEN_KEY);
      // 若尚未记录或检测到运行版本高于已记录版本
      if (!lastSeen || isVersionGreater(CURRENT_APP_VERSION, lastSeen)) {
        // 延时 800ms 温和拉起，避免与应用启动初始动画竞争
        const timer = setTimeout(() => {
          openWhatsNew({
            version: CURRENT_APP_VERSION,
            mode: "view",
          });
        }, 800);
        return () => clearTimeout(timer);
      }
    } catch {
      // 忽略存储读取异常
    }
  }, [isAuthenticated, isLoading, openWhatsNew]);
}
