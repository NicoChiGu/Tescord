import React, { useState, useMemo } from "react";
import { AlertTriangle, X, ShieldAlert } from "lucide-react";

interface DeleteGuildModalProps {
  isOpen: boolean;
  guildName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export const DeleteGuildModal: React.FC<DeleteGuildModalProps> = ({
  isOpen,
  guildName,
  onClose,
  onConfirm,
}) => {
  // 生成 4 位随机数字安全验证码
  const securityCode = useMemo(() => {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }, [isOpen]);

  const [inputCode, setInputCode] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isMatched = inputCode.trim() === securityCode;

  const handleDelete = async () => {
    if (!isMatched || isDeleting) return;
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err: any) {
      setError(err?.message || "解散服务器失败，请重试");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && isMatched && !isDeleting) {
      e.preventDefault();
      handleDelete();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#313338] p-6 shadow-2xl border border-red-500/20 text-white flex flex-col space-y-4"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-500 font-bold text-lg">
            <AlertTriangle className="w-5 h-5" />
            <span>解散并删除服务器</span>
          </div>
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-sm text-gray-300 space-y-2">
          <p>
            您确定要彻底删除{" "}
            <span className="font-bold text-white bg-black/30 px-1.5 py-0.5 rounded">
              {guildName}
            </span>{" "}
            吗？
          </p>
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs px-3.5 py-2.5 rounded-xl flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
            <span>
              此操作具有破坏性且<strong>无法撤销</strong>
              。该服务器下的所有频道、聊天记录、媒体附件和身份组都将被永久清除。
            </span>
          </div>
        </div>

        {/* 4 位随机安全验证码区域 */}
        <div className="space-y-3 pt-1">
          <div className="flex flex-col items-center justify-center p-3.5 bg-[#1e1f22] rounded-xl border border-white/5 space-y-1.5">
            <span className="text-xs text-gray-400 font-medium">安全验证码</span>
            <div className="text-2xl font-mono font-extrabold tracking-[0.35em] text-amber-400 select-all bg-black/40 px-5 py-1.5 rounded-lg border border-amber-500/30 shadow-inner">
              {securityCode}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center justify-between">
              <span>请输入上方 4 位验证码以确认解散：</span>
              <span className="text-gray-500 font-normal">{inputCode.length}/4</span>
            </label>
            <input
              type="text"
              data-testid="delete-guild-code-input"
              inputMode="numeric"
              maxLength={4}
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.replace(/\D/g, ""))}
              placeholder="4 位验证码"
              className="w-full bg-[#1e1f22] border border-white/10 rounded-lg px-3.5 py-2.5 text-center text-lg font-mono font-bold tracking-widest text-white placeholder-gray-500 focus:outline-none focus:border-red-500 transition-colors"
              autoFocus
            />
          </div>
        </div>

        {error && <div className="text-xs text-rose-400">{error}</div>}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="delete-guild-confirm-btn"
            disabled={!isMatched || isDeleting}
            onClick={handleDelete}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              isMatched && !isDeleting
                ? "bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-900/30"
                : "bg-rose-900/40 text-gray-400 cursor-not-allowed"
            }`}
          >
            {isDeleting ? "正在删除..." : "删除服务器"}
          </button>
        </div>
      </div>
    </div>
  );
};
