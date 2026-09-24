import { BrowserWindow, screen, ipcMain } from "electron";
import { DesktopNotificationPayload } from "@tescord/types";

interface ToastItem {
  id: string;
  payload: DesktopNotificationPayload;
  timer?: NodeJS.Timeout;
}

export class ToastManager {
  private window: BrowserWindow | null = null;
  private toasts: ToastItem[] = [];
  private onToastClickCallback?: (channelId?: string, guildId?: string) => void;

  constructor(onToastClick: (channelId?: string, guildId?: string) => void) {
    this.onToastClickCallback = onToastClick;
    this.initIpc();
  }

  private initIpc() {
    ipcMain.on(
      "desktop-toast-clicked",
      (_event, data: { id: string; channelId?: string; guildId?: string }) => {
        this.removeToast(data.id);
        this.onToastClickCallback?.(data.channelId, data.guildId);
      },
    );

    ipcMain.on("desktop-toast-closed", (_event, data: { id: string }) => {
      this.removeToast(data.id);
    });

    ipcMain.on("desktop-toast-mouseenter", () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.setIgnoreMouseEvents(false);
      }
    });

    ipcMain.on("desktop-toast-mouseleave", () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.setIgnoreMouseEvents(true, { forward: true });
      }
    });
  }

  private ensureWindow() {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { workArea } = primaryDisplay;

    const width = 380;
    const height = 480;
    const x = workArea.x + workArea.width - width - 16;
    const y = workArea.y + workArea.height - height - 16;

    this.window = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: undefined,
      },
    });

    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setIgnoreMouseEvents(true, { forward: true });

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
      -webkit-user-drag: none;
    }
    body {
      background: transparent;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column-reverse;
      justify-content: flex-start;
      height: 100vh;
      width: 100vw;
      padding: 12px;
      gap: 10px;
    }
    .toast-card {
      pointer-events: auto;
      background: #1e1f22;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 12px 14px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      position: relative;
      animation: slideIn 0.25s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards;
      transition: transform 0.15s ease, background 0.15s ease, opacity 0.2s ease;
      color: #f2f3f5;
    }
    .toast-card:hover {
      background: #2b2d31;
      transform: translateY(-2px);
    }
    .toast-card.closing {
      animation: slideOut 0.2s cubic-bezier(0.6, -0.28, 0.735, 0.045) forwards;
    }
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(100%) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
    }
    @keyframes slideOut {
      from {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
      to {
        opacity: 0;
        transform: translateX(80%) scale(0.9);
      }
    }
    .avatar-box {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      overflow: hidden;
      flex-shrink: 0;
      background: #5865f2;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 16px;
      color: #fff;
    }
    .avatar-img {
      width: 100%;
      height: 100%;
      object-cover: cover;
    }
    .content-box {
      flex: 1;
      min-width: 0;
    }
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2px;
    }
    .sender-title {
      font-weight: 600;
      font-size: 14px;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 210px;
    }
    .close-btn {
      background: transparent;
      border: none;
      color: #949ba4;
      cursor: pointer;
      font-size: 16px;
      padding: 0 4px;
      line-height: 1;
      border-radius: 4px;
      transition: color 0.15s, background 0.15s;
    }
    .close-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
    }
    .body-text {
      font-size: 13px;
      color: #dbdee1;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }
  </style>
</head>
<body id="container">
  <script>
    const container = document.getElementById("container");

    document.addEventListener("mouseenter", (e) => {
      if (e.target.closest && e.target.closest(".toast-card")) {
        window.postMessage({ type: "mouseenter" }, "*");
      }
    }, true);

    document.addEventListener("mouseleave", (e) => {
      window.postMessage({ type: "mouseleave" }, "*");
    }, true);

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === "ADD_TOAST") {
        const item = msg.toast;
        const card = document.createElement("div");
        card.className = "toast-card";
        card.id = "toast-" + item.id;
        
        const avatarHtml = item.avatarUrl
          ? '<img class="avatar-img" src="' + escapeHtml(item.avatarUrl) + '" />'
          : '<div class="avatar-box">' + escapeHtml((item.senderName || item.title || "T").slice(0, 1).toUpperCase()) + '</div>';

        card.innerHTML = 
          avatarHtml +
          '<div class="content-box">' +
            '<div class="header-row">' +
              '<span class="sender-title">' + escapeHtml(item.senderName || item.title || "Tescord") + '</span>' +
              '<button class="close-btn" data-id="' + item.id + '">&times;</button>' +
            '</div>' +
            '<p class="body-text">' + escapeHtml(item.body) + '</p>' +
          '</div>';

        card.addEventListener("click", (e) => {
          if (e.target.classList.contains("close-btn")) return;
          window.electronAPIBridge?.click(item.id, item.channelId, item.guildId);
        });

        const closeBtn = card.querySelector(".close-btn");
        closeBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          card.classList.add("closing");
          setTimeout(() => {
            card.remove();
            window.electronAPIBridge?.close(item.id);
          }, 200);
        });

        container.appendChild(card);
      } else if (msg.type === "REMOVE_TOAST") {
        const card = document.getElementById("toast-" + msg.id);
        if (card) {
          card.classList.add("closing");
          setTimeout(() => card.remove(), 200);
        }
      }
    });

    function escapeHtml(str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
  </script>
</body>
</html>
    `;

    this.window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`,
    );
    return this.window;
  }

  public showToast(payload: DesktopNotificationPayload) {
    const id =
      "toast_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const win = this.ensureWindow();

    if (!win.isVisible()) {
      win.showInactive();
    }

    const toastItem: ToastItem = {
      id,
      payload,
    };

    // 最多显示 3 条，超过时移除最早的
    if (this.toasts.length >= 3) {
      const oldest = this.toasts.shift();
      if (oldest) {
        if (oldest.timer) clearTimeout(oldest.timer);
        this.sendToRenderer({ type: "REMOVE_TOAST", id: oldest.id });
      }
    }

    // 4.5秒自动滑出关闭
    toastItem.timer = setTimeout(() => {
      this.removeToast(id);
    }, 4500);

    this.toasts.push(toastItem);

    // 向 Toast 渲染进程注入该通知数据
    this.sendToRenderer({
      type: "ADD_TOAST",
      toast: {
        id,
        title: payload.title,
        body: payload.body,
        avatarUrl: payload.avatarUrl,
        senderName: payload.senderName,
        channelId: payload.channelId,
        guildId: payload.guildId,
      },
    });
  }

  private sendToRenderer(data: any) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents
        .executeJavaScript(
          `
        window.postMessage(${JSON.stringify(data)}, "*");
      `,
        )
        .catch(() => {});
    }
  }

  public removeToast(id: string) {
    const index = this.toasts.findIndex((t) => t.id === id);
    if (index !== -1) {
      const [item] = this.toasts.splice(index, 1);
      if (item.timer) clearTimeout(item.timer);
    }
    this.sendToRenderer({ type: "REMOVE_TOAST", id });

    // 若全部关闭，延时隐藏窗口
    if (this.toasts.length === 0) {
      setTimeout(() => {
        if (
          this.toasts.length === 0 &&
          this.window &&
          !this.window.isDestroyed()
        ) {
          this.window.hide();
        }
      }, 300);
    }
  }
}
