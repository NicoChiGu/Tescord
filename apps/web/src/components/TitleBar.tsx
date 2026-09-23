import React, { useState, useEffect } from "react";
import { X, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGatewayStatus } from "../hooks/useGatewayStatus.js";
import { useAuthStore } from "../stores/useAuthStore.js";

export const TitleBar: React.FC = () => {
  // 智能环境检测：非 Electron 桌面客户端 (如纯 Web 浏览器访问) 彻底隐藏，不占用任何高度
  if (typeof window === "undefined" || !window.electronAPI) {
    return null;
  }

  const platform = window.electronAPI.platform || "win32";
  const isMac = platform === "darwin";

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [windowMode, setWindowMode] = useState<"auth" | "main">(
    isAuthenticated ? "main" : "auth",
  );
  const [isMaximized, setIsMaximized] = useState(false);
  const { connectionState, ping } = useGatewayStatus();
  const { t } = useTranslation("common");

  useEffect(() => {
    setWindowMode(isAuthenticated ? "main" : "auth");
  }, [isAuthenticated]);

  useEffect(() => {
    let unsubscribeMax: (() => void) | undefined;
    let unsubscribeMode: (() => void) | undefined;

    // 获取窗口初始最大化状态
    if (window.electronAPI?.isWindowMaximized) {
      window.electronAPI.isWindowMaximized().then((max) => {
        setIsMaximized(max);
      });
    }

    // 监听窗口最大化与还原事件 (通过 IPC 单向广播驱动)
    if (window.electronAPI?.onWindowMaximizedChange) {
      unsubscribeMax = window.electronAPI.onWindowMaximizedChange((max) => {
        setIsMaximized(max);
      });
    }

    // 监听窗口模式变动 (auth / main)
    if (window.electronAPI?.getWindowMode) {
      window.electronAPI.getWindowMode().then((mode) => {
        if (mode) setWindowMode(mode);
      });
    }

    if (window.electronAPI?.onWindowModeChange) {
      unsubscribeMode = window.electronAPI.onWindowModeChange((mode) => {
        setWindowMode(mode);
      });
    }

    return () => {
      unsubscribeMax?.();
      unsubscribeMode?.();
    };
  }, []);

  const isAuthMode = windowMode === "auth" || !isAuthenticated;

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow();
  };

  const handleToggleMaximize = () => {
    if (isAuthMode) return;
    window.electronAPI?.maximizeWindow();
  };

  const handleClose = () => {
    window.electronAPI?.closeWindow();
  };

  return (
    <header
      data-testid="custom-titlebar"
      className="h-7 w-full bg-[#1e1f22] border-b border-[#111214] flex items-center justify-between select-none flex-shrink-0 relative z-[9999] text-[#949ba4]"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* 左侧：Logo 与品牌标题标识 */}
      <div
        className={`flex items-center gap-2 h-full ${
          isMac ? "pl-20" : "pl-3"
        } pointer-events-none`}
      >
        <svg
          className="w-4 h-4 text-discord-brand flex-shrink-0"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
        <span className="text-[11px] font-bold tracking-wider text-[#949ba4] font-sans">
          TESCORD
        </span>
      </div>

      {/* 中间纯净拖拽区，支持双击最大化/还原 */}
      <div
        className="flex-1 h-full cursor-default"
        onDoubleClick={isAuthMode ? undefined : handleToggleMaximize}
      />

      {/* 右侧：Windows/Linux 原生风格窗口三键 (macOS 下隐藏，由系统交通灯接管) */}
      {!isMac && (
        <div
          className="flex items-center h-full"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* WebSocket 网关延迟指示徽标 (仅在大窗口/已登录模式下显示) */}
          {!isAuthMode && (
            <div
              data-testid="titlebar-ping-badge"
              className="flex items-center gap-1.5 px-2 text-[10px] font-mono text-[#949ba4]"
              title={`WebSocket 网关连接状态: ${
                connectionState === "connected"
                  ? `已连接 (延迟: ${ping !== null ? `${ping}ms` : "测量中..."})`
                  : connectionState === "reconnecting"
                    ? "正在尝试重新连接..."
                    : connectionState === "connecting"
                      ? "正在连接..."
                      : "已断开连接"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connectionState === "connected"
                    ? "bg-emerald-500"
                    : connectionState === "connecting" ||
                        connectionState === "reconnecting"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-rose-500"
                }`}
              />
              <span>
                {connectionState === "connected"
                  ? ping !== null
                    ? `${ping}ms`
                    : "已连接"
                  : "重连中"}
              </span>
            </div>
          )}

          {/* 最小化按钮 */}
          <button
            type="button"
            data-testid="window-minimize-btn"
            onClick={handleMinimize}
            title={t("titleBar.minimize")}
            aria-label={t("titleBar.minimize")}
            className="w-11 h-full flex items-center justify-center text-[#949ba4] hover:bg-[#35373c] hover:text-white transition-colors duration-150 focus:outline-none"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          {/* 最大化 / 还原按钮 (仅在大窗口模式下可用) */}
          {!isAuthMode && (
            <button
              type="button"
              data-testid="window-maximize-btn"
              onClick={handleToggleMaximize}
              title={isMaximized ? t("titleBar.restore") : t("titleBar.maximize")}
              aria-label={
                isMaximized ? t("titleBar.restore") : t("titleBar.maximize")
              }
              className="w-11 h-full flex items-center justify-center text-[#949ba4] hover:bg-[#35373c] hover:text-white transition-colors duration-150 focus:outline-none"
            >
              {isMaximized ? (
                // 还原图标：双层嵌套小方块
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.1"
                >
                  <path d="M2.5 7.5H1.5V1.5H7.5V2.5" />
                  <rect x="3.5" y="3.5" width="5" height="5" />
                </svg>
              ) : (
                // 最大化图标：单层方块
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.1"
                >
                  <rect x="1" y="1" width="8" height="8" />
                </svg>
              )}
            </button>
          )}

          {/* 关闭按钮 (Discord 经典悬浮亮红底白字) */}
          <button
            type="button"
            data-testid="window-close-btn"
            onClick={handleClose}
            title={t("titleBar.close")}
            aria-label={t("titleBar.close")}
            className="w-11 h-full flex items-center justify-center text-[#949ba4] hover:bg-[#ed4245] hover:text-white transition-colors duration-150 focus:outline-none"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </header>
  );
};
