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
  splashStarting: string;
  splashCheckingUpdates: string;
  splashFoundUpdate: string;
  splashDownloading: string;
  splashExtracting: string;
  splashComplete: string;
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
    muteMic: "闭麦 (Ctrl+Shift+M)",
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
    splashStarting: "正在启动 Tescord...",
    splashCheckingUpdates: "正在检查更新...",
    splashFoundUpdate: "发现新版本，正在下载...",
    splashDownloading: "正在下载更新...",
    splashExtracting: "正在解压安装增量包...",
    splashComplete: "更新已完成，正在载入...",
  },
  "zh-TW": {
    trayTooltip: "Tescord 本地私有化即時通訊用戶端",
    openApp: "開啟 Tescord",
    statusMenu: "線上狀態",
    statusOnline: "🟢 線上 (Online)",
    statusIdle: "🟡 閒置 (Idle)",
    statusDnd: "🔴 請勿打擾 (Do Not Disturb)",
    statusInvisible: "⚪ 隱身 (Invisible)",
    muteMic: "閉麥 (Ctrl+Shift+M)",
    autoLaunch: "開機自動啟動",
    quit: "結束 Tescord",
    undo: "復原",
    redo: "重做",
    cut: "剪下",
    copy: "複製",
    paste: "貼上",
    selectAll: "全選",
    copyLink: "複製連結位址",
    openInBrowser: "在外部瀏覽器中開啟",
    copyImageLink: "複製圖片連結",
    inspectElement: "檢查元素 (Inspect Element)",
    reload: "重新載入頁面",
    splashStarting: "正在啟動 Tescord...",
    splashCheckingUpdates: "正在檢查更新...",
    splashFoundUpdate: "發現新版本，正在下載...",
    splashDownloading: "正在下載更新...",
    splashExtracting: "正在解壓縮安裝更新檔...",
    splashComplete: "更新已完成，正在載入...",
  },
  "zh-HK": {
    trayTooltip: "Tescord 本地私有化即時通訊客戶端",
    openApp: "開啟 Tescord",
    statusMenu: "在線狀態",
    statusOnline: "🟢 在線 (Online)",
    statusIdle: "🟡 閒置 (Idle)",
    statusDnd: "🔴 請勿打擾 (Do Not Disturb)",
    statusInvisible: "⚪ 隱身 (Invisible)",
    muteMic: "閉咪 (Ctrl+Shift+M)",
    autoLaunch: "開機自動啟動",
    quit: "結束 Tescord",
    undo: "復原",
    redo: "重做",
    cut: "剪下",
    copy: "複製",
    paste: "貼上",
    selectAll: "全選",
    copyLink: "複製連結網址",
    openInBrowser: "在外部瀏覽器中開啟",
    copyImageLink: "複製圖片連結",
    inspectElement: "檢查元素 (Inspect Element)",
    reload: "重新載入頁面",
    splashStarting: "正在啟動 Tescord...",
    splashCheckingUpdates: "正在檢查更新...",
    splashFoundUpdate: "發現新版本，正在下載...",
    splashDownloading: "正在下載更新...",
    splashExtracting: "正在解壓縮安裝更新檔...",
    splashComplete: "更新已完成，正在載入...",
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
    splashStarting: "Starting Tescord...",
    splashCheckingUpdates: "Checking for updates...",
    splashFoundUpdate: "Found new version, downloading...",
    splashDownloading: "Downloading update...",
    splashExtracting: "Extracting and installing update...",
    splashComplete: "Update complete. Loading...",
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
    splashStarting: "Tescord を起動中...",
    splashCheckingUpdates: "アップデートを確認中...",
    splashFoundUpdate: "新しいバージョンが見つかりました。ダウンロード中...",
    splashDownloading: "アップデートをダウンロード中...",
    splashExtracting: "差分パッケージを展開中...",
    splashComplete: "アップデートが完了しました。読み込み中...",
  },
};

export function getDesktopLocale(
  locale: SupportedLocale = "zh-CN",
): DesktopLocaleStrings {
  return desktopLocales[locale] || desktopLocales["zh-CN"];
}

export interface ScreenshotLocaleStrings {
  rect: string;
  arrow: string;
  pen: string;
  mosaic: string;
  text: string;
  undo: string;
  copy: string;
  send: string;
  save: string;
  close: string;
}

export const screenshotLocales: Record<
  SupportedLocale,
  ScreenshotLocaleStrings
> = {
  "zh-CN": {
    rect: "矩形框",
    arrow: "箭头",
    pen: "画笔",
    mosaic: "马赛克",
    text: "文字",
    undo: "撤销 (Ctrl+Z)",
    copy: "复制 (Enter / 双击)",
    send: "发送到聊天",
    save: "保存图片",
    close: "退出截图 (ESC)",
  },
  "zh-TW": {
    rect: "矩形框",
    arrow: "箭頭",
    pen: "畫筆",
    mosaic: "馬賽克",
    text: "文字",
    undo: "復原 (Ctrl+Z)",
    copy: "複製 (Enter / 點兩下)",
    send: "發送到聊天",
    save: "儲存圖片",
    close: "結束截圖 (ESC)",
  },
  "zh-HK": {
    rect: "矩形框",
    arrow: "箭頭",
    pen: "畫筆",
    mosaic: "馬賽克",
    text: "文字",
    undo: "復原 (Ctrl+Z)",
    copy: "複製 (Enter / 雙擊)",
    send: "發送到聊天",
    save: "儲存圖片",
    close: "結束截圖 (ESC)",
  },
  "en-US": {
    rect: "Rectangle",
    arrow: "Arrow",
    pen: "Pen",
    mosaic: "Mosaic",
    text: "Text",
    undo: "Undo (Ctrl+Z)",
    copy: "Copy (Enter / Double Click)",
    send: "Send to Chat",
    save: "Save Image",
    close: "Cancel (ESC)",
  },
  "ja-JP": {
    rect: "四角形",
    arrow: "矢印",
    pen: "ペン",
    mosaic: "モザイク",
    text: "テキスト",
    undo: "元に戻す (Ctrl+Z)",
    copy: "コピー (Enter / ダブルクリック)",
    send: "チャットに送信",
    save: "画像を保存",
    close: "終了 (ESC)",
  },
};

export function getScreenshotLocale(
  locale: SupportedLocale = "zh-CN",
): ScreenshotLocaleStrings {
  return screenshotLocales[locale] || screenshotLocales["zh-CN"];
}
