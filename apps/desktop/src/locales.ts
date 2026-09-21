import { SupportedLocale } from "@tescord/types";

export interface DesktopLocaleStrings {
  trayTooltip: string;
  openApp: string;
  statusMenu: string;
  statusOnline: string;
  statusIdle: string;
  statusDnd: string;
  statusInvisible: string;
  muteMic: string;
  autoLaunch: string;
  quit: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
  copyLink: string;
  openInBrowser: string;
  copyImageLink: string;
  inspectElement: string;
  reload: string;
}

export const desktopLocales: Record<SupportedLocale, DesktopLocaleStrings> = {
  "zh-CN": {
    trayTooltip: "Tescord 本地私有化实时通讯客户端",
    openApp: "打开 Tescord",
    statusMenu: "在线状态",
    statusOnline: "🟢 在线 (Online)",
    statusIdle: "🟡 闲置 (Idle)",
    statusDnd: "🔴 请勿打扰 (Do Not Disturb)",
    statusInvisible: "⚪ 隐身 (Invisible)",
    muteMic: "静音麦克风 (Ctrl+Shift+M)",
    autoLaunch: "开机自启动",
    quit: "退出 Tescord",
    undo: "撤销",
    redo: "重做",
    cut: "剪切",
    copy: "复制",
    paste: "粘贴",
    selectAll: "全选",
    copyLink: "复制链接地址",
    openInBrowser: "在外部浏览器中打开",
    copyImageLink: "复制图片链接",
    inspectElement: "检查元素 (Inspect Element)",
    reload: "重新加载页面",
  },
  "en-US": {
    trayTooltip: "Tescord - Private Real-Time Communication Client",
    openApp: "Open Tescord",
    statusMenu: "Online Status",
    statusOnline: "🟢 Online",
    statusIdle: "🟡 Idle",
    statusDnd: "🔴 Do Not Disturb",
    statusInvisible: "⚪ Invisible",
    muteMic: "Mute Microphone (Ctrl+Shift+M)",
    autoLaunch: "Launch on Startup",
    quit: "Quit Tescord",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    selectAll: "Select All",
    copyLink: "Copy Link Address",
    openInBrowser: "Open in External Browser",
    copyImageLink: "Copy Image Address",
    inspectElement: "Inspect Element",
    reload: "Reload Page",
  },
  "ja-JP": {
    trayTooltip: "Tescord プライベートリアルタイム通信クライアント",
    openApp: "Tescord を開く",
    statusMenu: "オンライン状態",
    statusOnline: "🟢 オンライン (Online)",
    statusIdle: "🟡 退席中 (Idle)",
    statusDnd: "🔴 取り込み中 (Do Not Disturb)",
    statusInvisible: "⚪ オンライン状態を隠す (Invisible)",
    muteMic: "マイクをミュート (Ctrl+Shift+M)",
    autoLaunch: "システム起動時に実行",
    quit: "Tescord を終了",
    undo: "元に戻す",
    redo: "やり直し",
    cut: "切り取り",
    copy: "コピー",
    paste: "貼り付け",
    selectAll: "すべて選択",
    copyLink: "リンクのアドレスをコピー",
    openInBrowser: "ブラウザで開く",
    copyImageLink: "画像のアドレスをコピー",
    inspectElement: "要素の検証",
    reload: "ページの再読み込み",
  },
};

export function getDesktopLocale(locale: SupportedLocale = "zh-CN"): DesktopLocaleStrings {
  return desktopLocales[locale] || desktopLocales["zh-CN"];
}
