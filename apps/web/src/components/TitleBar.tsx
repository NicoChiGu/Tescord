import React, { useState, useEffect } from "react";
import { X, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGatewayStatus } from "../hooks/useGatewayStatus.js";
import { useAuthStore } from "../stores/useAuthStore.js";
import { BrandLogo } from "./ui/BrandLogo.js";

interface TitleBarProps {
  forceMode?: "auth" | "main";
}

export const TitleBar: React.FC<TitleBarProps> = ({ forceMode }) => {
  // 智能环境检测：非 Electron 桌面客户端 (如纯 Web 浏览器访问) 彻底隐藏，不占用任何高度
  if (typeof window === "undefined" || !window.electronAPI) {
    return null;
  }

  const platform = window.electronAPI.platform || "win32";
  const isMac = platform === "darwin";

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [windowMode, setWindowMode] = useState<"auth" | "main">(
    forceMode || (isAuthenticated ? "main" : "auth"),
  );
  const [isMaximized, setIsMaximized] = useState(false);
  const { connectionState, ping } = useGatewayStatus();
  const { t } = useTranslation("common");

  useEffect(() => {
    if (forceMode) {
      setWindowMode(forceMode);
      return;
    }
    setWindowMode(isAuthenticated ? "main" : "auth");
  }, [isAuthenticated, forceMode]);

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
        <BrandLogo
          variant="symbol"
          className="w-4 h-4 text-discord-brand flex-shrink-0"
        />
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
              title={`${t("common:titleBar.gatewayConnected", "WebSocket 网关连接状态")}: ${
                connectionState === "connected"
                  ? `${t("common:gateway.connected", "已连接")} (${t("common:gateway.latency", "延迟")}: ${ping !== null ? `${ping}ms` : "..."})`
                  : connectionState === "reconnecting"
                    ? t("common:gateway.reconnecting", "正在尝试重新连接...")
                    : connectionState === "connecting"
                      ? t("common:gateway.connecting", "正在连接...")
                      : t("common:gateway.disconnected", "已断开连接")
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
                    : t("common:gateway.connected", "已连接")
                  : t("common:gateway.reconnecting", "重连中")}
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
              title={
                isMaximized ? t("titleBar.restore") : t("titleBar.maximize")
              }
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
