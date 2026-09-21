import React from "react";
import {
  AlertTriangle,
  Server,
  ArrowRight,
  X,
  ShieldAlert,
} from "lucide-react";

interface P2PFallbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFallbackToSFU: () => void;
  reason?: string;
  streamOwnerName?: string;
}

export const P2PFallbackModal: React.FC<P2PFallbackModalProps> = ({
  isOpen,
  onClose,
  onFallbackToSFU,
  reason = "P2P 点对点穿透超时，网络环境可能存在对称型 NAT 隔离或防火墙拦截",
  streamOwnerName = "主播",
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#313338] text-white rounded-lg shadow-2xl border border-gray-700/60 w-full max-w-md overflow-hidden animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-[#2b2d31]">
          <div className="flex items-center gap-2 text-amber-400 font-semibold text-base">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            <span>P2P 直连穿透提示</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-700/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-200/90 leading-relaxed">
              未能与{" "}
              <strong className="text-white font-medium">
                {streamOwnerName}
              </strong>{" "}
              建立 P2P 物理直连：
              <div className="mt-1 text-gray-300 font-mono text-[11px] bg-black/20 px-2 py-1 rounded">
                {reason}
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-300 leading-relaxed">
            为保证直播画面不中断，您可以选择切换为
            <strong className="text-discord-blurple">
              服务器中继（LiveKit SFU）
            </strong>
            模式拉流。服务器中继将提供极速自适应分发，确保画面稳定呈现。
          </p>

          <div className="bg-[#2b2d31] rounded-lg p-3 text-[11px] text-gray-400 space-y-1.5 border border-gray-800">
            <div className="flex items-center justify-between">
              <span>当前模式</span>
              <span className="text-amber-400 font-medium">
                P2P 直连 (打洞中/受阻)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>建议切换</span>
              <span className="text-emerald-400 font-medium">
                服务器中继 (LiveKit SFU)
              </span>
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-[#2b2d31] border-t border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-300 hover:text-white hover:underline transition-colors"
          >
            稍后重试
          </button>
          <button
            type="button"
            onClick={() => {
              onFallbackToSFU();
              onClose();
            }}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-discord-blurple hover:bg-discord-blurple/80 text-white rounded shadow transition-colors"
          >
            <Server className="w-4 h-4" />
            <span>切换至服务器中继观看</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
