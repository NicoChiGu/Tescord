import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { SupportedLocale } from "@tescord/types";

// 导入 zh-CN 语言资源
import commonZh from "./locales/zh-CN/common.json";
import authZh from "./locales/zh-CN/auth.json";
import settingsZh from "./locales/zh-CN/settings.json";
import chatZh from "./locales/zh-CN/chat.json";
import voiceZh from "./locales/zh-CN/voice.json";
import serverZh from "./locales/zh-CN/server.json";
import contextMenuZh from "./locales/zh-CN/contextMenu.json";

// 导入 en-US 语言资源
import commonEn from "./locales/en-US/common.json";
import authEn from "./locales/en-US/auth.json";
import settingsEn from "./locales/en-US/settings.json";
import chatEn from "./locales/en-US/chat.json";
import voiceEn from "./locales/en-US/voice.json";
import serverEn from "./locales/en-US/server.json";
import contextMenuEn from "./locales/en-US/contextMenu.json";

// 导入 ja-JP 语言资源
import commonJa from "./locales/ja-JP/common.json";
import authJa from "./locales/ja-JP/auth.json";
import settingsJa from "./locales/ja-JP/settings.json";
import chatJa from "./locales/ja-JP/chat.json";
import voiceJa from "./locales/ja-JP/voice.json";
import serverJa from "./locales/ja-JP/server.json";
import contextMenuJa from "./locales/ja-JP/contextMenu.json";

export const defaultNS = "common";
export const resources = {
  "zh-CN": {
    common: commonZh,
    auth: authZh,
    settings: settingsZh,
    chat: chatZh,
    voice: voiceZh,
    server: serverZh,
    contextMenu: contextMenuZh,
  },
  "en-US": {
    common: commonEn,
    auth: authEn,
    settings: settingsEn,
    chat: chatEn,
    voice: voiceEn,
    server: serverEn,
    contextMenu: contextMenuEn,
  },
  "ja-JP": {
    common: commonJa,
    auth: authJa,
    settings: settingsJa,
    chat: chatJa,
    voice: voiceJa,
    server: serverJa,
    contextMenu: contextMenuJa,
  },
} as const;

/**
 * 将任意探测到的语言代码规范化为系统支持的 SupportedLocale
 */
export function normalizeLocale(rawLocale?: string | null): SupportedLocale {
  if (!rawLocale) return "zh-CN";
  const lower = rawLocale.toLowerCase();
  if (lower.startsWith("ja")) return "ja-JP";
  if (lower.startsWith("en")) return "en-US";
  if (lower.startsWith("zh")) return "zh-CN";
  return "zh-CN";
}

// 探测初始化语言
const getInitialLanguage = (): SupportedLocale => {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("tescord_locale");
    if (saved && (saved === "zh-CN" || saved === "en-US" || saved === "ja-JP")) {
      return saved as SupportedLocale;
    }
    const navLang = navigator.language || (navigator as any).userLanguage;
    return normalizeLocale(navLang);
  }
  return "zh-CN";
};

const initialLang = getInitialLanguage();

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLang,
    fallbackLng: "zh-CN",
    defaultNS,
    ns: ["common", "auth", "settings", "chat", "voice", "server", "contextMenu"],
    interpolation: {
      escapeValue: false, // React 已经自带 XSS 防护
    },
  });

// 响应语言变动：同步 html lang 属性、localStorage 并通知 Electron 主进程
i18n.on("languageChanged", (lang: string) => {
  const norm = normalizeLocale(lang);
  if (typeof document !== "undefined") {
    document.documentElement.lang = norm;
  }
  if (typeof window !== "undefined") {
    localStorage.setItem("tescord_locale", norm);
    window.electronAPI?.syncLocale?.(norm);
  }
});

// 初始化时同步一次给 Electron 主进程与 DOM
if (typeof document !== "undefined") {
  document.documentElement.lang = initialLang;
}
if (typeof window !== "undefined") {
  window.electronAPI?.syncLocale?.(initialLang);
}

/**
 * 切换系统语言全局辅助方法
 */
export async function changeLocale(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
}

export default i18n;
