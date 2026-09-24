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
import modalsZh from "./locales/zh-CN/modals.json";
import adminZh from "./locales/zh-CN/admin.json";
import errorsZh from "./locales/zh-CN/errors.json";

// 导入 en-US 语言资源
import commonEn from "./locales/en-US/common.json";
import authEn from "./locales/en-US/auth.json";
import settingsEn from "./locales/en-US/settings.json";
import chatEn from "./locales/en-US/chat.json";
import voiceEn from "./locales/en-US/voice.json";
import serverEn from "./locales/en-US/server.json";
import contextMenuEn from "./locales/en-US/contextMenu.json";
import modalsEn from "./locales/en-US/modals.json";
import adminEn from "./locales/en-US/admin.json";
import errorsEn from "./locales/en-US/errors.json";

// 导入 ja-JP 语言资源
import commonJa from "./locales/ja-JP/common.json";
import authJa from "./locales/ja-JP/auth.json";
import settingsJa from "./locales/ja-JP/settings.json";
import chatJa from "./locales/ja-JP/chat.json";
import voiceJa from "./locales/ja-JP/voice.json";
import serverJa from "./locales/ja-JP/server.json";
import contextMenuJa from "./locales/ja-JP/contextMenu.json";
import modalsJa from "./locales/ja-JP/modals.json";
import adminJa from "./locales/ja-JP/admin.json";
import errorsJa from "./locales/ja-JP/errors.json";

// 导入 zh-TW (繁體中文 - 台灣) 语言资源
import commonZhTW from "./locales/zh-TW/common.json";
import authZhTW from "./locales/zh-TW/auth.json";
import settingsZhTW from "./locales/zh-TW/settings.json";
import chatZhTW from "./locales/zh-TW/chat.json";
import voiceZhTW from "./locales/zh-TW/voice.json";
import serverZhTW from "./locales/zh-TW/server.json";
import contextMenuZhTW from "./locales/zh-TW/contextMenu.json";
import modalsZhTW from "./locales/zh-TW/modals.json";
import adminZhTW from "./locales/zh-TW/admin.json";
import errorsZhTW from "./locales/zh-TW/errors.json";

// 导入 zh-HK (繁體中文 - 香港) 语言资源
import commonZhHK from "./locales/zh-HK/common.json";
import authZhHK from "./locales/zh-HK/auth.json";
import settingsZhHK from "./locales/zh-HK/settings.json";
import chatZhHK from "./locales/zh-HK/chat.json";
import voiceZhHK from "./locales/zh-HK/voice.json";
import serverZhHK from "./locales/zh-HK/server.json";
import contextMenuZhHK from "./locales/zh-HK/contextMenu.json";
import modalsZhHK from "./locales/zh-HK/modals.json";
import adminZhHK from "./locales/zh-HK/admin.json";
import errorsZhHK from "./locales/zh-HK/errors.json";

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
    modals: modalsZh,
    admin: adminZh,
    errors: errorsZh,
  },
  "zh-TW": {
    common: commonZhTW,
    auth: authZhTW,
    settings: settingsZhTW,
    chat: chatZhTW,
    voice: voiceZhTW,
    server: serverZhTW,
    contextMenu: contextMenuZhTW,
    modals: modalsZhTW,
    admin: adminZhTW,
    errors: errorsZhTW,
  },
  "zh-HK": {
    common: commonZhHK,
    auth: authZhHK,
    settings: settingsZhHK,
    chat: chatZhHK,
    voice: voiceZhHK,
    server: serverZhHK,
    contextMenu: contextMenuZhHK,
    modals: modalsZhHK,
    admin: adminZhHK,
    errors: errorsZhHK,
  },
  "en-US": {
    common: commonEn,
    auth: authEn,
    settings: settingsEn,
    chat: chatEn,
    voice: voiceEn,
    server: serverEn,
    contextMenu: contextMenuEn,
    modals: modalsEn,
    admin: adminEn,
    errors: errorsEn,
  },
  "ja-JP": {
    common: commonJa,
    auth: authJa,
    settings: settingsJa,
    chat: chatJa,
    voice: voiceJa,
    server: serverJa,
    contextMenu: contextMenuJa,
    modals: modalsJa,
    admin: adminJa,
    errors: errorsJa,
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
  if (
    lower.startsWith("zh-hk") ||
    lower.startsWith("zh-mo") ||
    lower.includes("hk") ||
    lower.includes("mo")
  ) {
    return "zh-HK";
  }
  if (
    lower.startsWith("zh-tw") ||
    lower.includes("tw") ||
    lower.includes("hant")
  ) {
    return "zh-TW";
  }
  if (lower.startsWith("zh")) return "zh-CN";
  return "zh-CN";
}

// 探测初始化语言
const getInitialLanguage = (): SupportedLocale => {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("tescord_locale");
    if (
      saved &&
      (saved === "zh-CN" ||
        saved === "zh-TW" ||
        saved === "zh-HK" ||
        saved === "en-US" ||
        saved === "ja-JP")
    ) {
      return saved as SupportedLocale;
    }
    const navLang = navigator.language || (navigator as any).userLanguage;
    return normalizeLocale(navLang);
  }
  return "zh-CN";
};

const initialLang = getInitialLanguage();

i18n.use(initReactI18next).init({
  resources,
  lng: initialLang,
  fallbackLng: "zh-CN",
  defaultNS,
  ns: [
    "common",
    "auth",
    "settings",
    "chat",
    "voice",
    "server",
    "contextMenu",
    "modals",
    "admin",
    "errors",
  ],
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

/**
 * 非 React 组件上下文中快捷调用翻译函数
 */
export function tGlobal(key: string, options?: Record<string, any>): string {
  return i18n.t(key, options);
}

/**
 * 解析错误对象或标准 ErrorCode 获得当前语言下的友好提示
 */
export function getErrorMessage(err: any): string {
  if (!err) return i18n.t("errors:UNKNOWN_ERROR");

  // 1. 如果包含标准 code (如 ErrorCode.GUILD_NAME_REQUIRED)
  const code =
    err.code ||
    (typeof err === "string" && err.startsWith("ERR_") ? err : null);
  if (code && i18n.exists(`errors:${code}`)) {
    return i18n.t(`errors:${code}`);
  }

  // 2. 如果 err 本身就是字符串且命中了 errors 字典
  if (typeof err === "string" && i18n.exists(`errors:${err}`)) {
    return i18n.t(`errors:${err}`);
  }

  // 3. 如果 message 命中了字典
  const msg = err.message || err.error;
  if (msg && typeof msg === "string") {
    if (i18n.exists(`errors:${msg}`)) {
      return i18n.t(`errors:${msg}`);
    }
    return msg;
  }

  return i18n.t("errors:UNKNOWN_ERROR");
}

export default i18n;
