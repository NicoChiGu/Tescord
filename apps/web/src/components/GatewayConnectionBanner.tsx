import React from "react";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGatewayStatus } from "../hooks/useGatewayStatus.js";
import { gatewayClient } from "../services/gateway.js";
import { useAuthStore } from "../stores/useAuthStore.js";

/**
 * Discord 风格的网关长连接状态指示条
 * 仅在连接中 (connecting)、断线重连 (reconnecting) 或已断开 (disconnected) 时滑出
 */
export const GatewayConnectionBanner: React.FC = () => {
  const { t } = useTranslation(["common"]);
  const { connectionState } = useGatewayStatus();
  const token = useAuthStore((state) => state.token);

  if (connectionState === "connected") {
    return null;
  }

  const handleManualReconnect = () => {
    if (token) {
      gatewayClient.connect(token);
    }
  };

  const isReconnecting = connectionState === "reconnecting";
  const isConnecting = connectionState === "connecting";

  return (
    <div
      data-testid="gateway-connection-banner"
      className={`w-full py-1 px-3 flex items-center justify-between text-xs font-medium z-50 select-none shadow-md transition-all duration-200 ${
        isReconnecting || connectionState === "disconnected"
          ? "bg-[#da373c] text-white"
          : "bg-[#faa61a] text-[#111214]"
      }`}
    >
      <div className="flex items-center space-x-2 mx-auto sm:mx-0">
        {isConnecting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        ) : (
          <AlertCircle className="w-3.5 h-3.5 animate-pulse flex-shrink-0" />
        )}
        <span>
          {isConnecting
            ? t("common:gateway.connecting")
            : isReconnecting
              ? t("common:gateway.reconnecting")
              : t("common:gateway.disconnected")}
        </span>
      </div>

      {(connectionState === "disconnected" || isReconnecting) && (
        <button
          type="button"
          onClick={handleManualReconnect}
          className="hidden sm:flex items-center space-x-1 px-2 py-0.5 rounded bg-black/20 hover:bg-black/30 transition text-[11px] font-semibold cursor-pointer"
          title={t("common:gateway.reconnectTooltip")}
        >
          <RefreshCw className="w-3 h-3" />
          <span>{t("common:gateway.reconnect")}</span>
        </button>
      )}
    </div>
  );
};
