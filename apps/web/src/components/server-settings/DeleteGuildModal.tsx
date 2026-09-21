import React, { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

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
  const [inputName, setInputName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isMatched = inputName.trim() === guildName.trim();

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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl bg-[#313338] p-6 shadow-2xl border border-red-500/20 text-white flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-500 font-bold text-lg">
            <AlertTriangle className="w-5 h-5" />
            <span>解散并删除服务器</span>
          </div>
          <button
            onClick={onClose}
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
          <p className="text-xs text-rose-400">
            此操作具有破坏性且<strong>无法撤销</strong>。该服务器下的所有频道、聊天记录、媒体附件和身份组都将被永久清除。
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-300">
            请输入服务器全名以确认：
          </label>
          <input
            type="text"
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
            placeholder={guildName}
            className="w-full bg-[#1e1f22] border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500 transition-colors"
            autoFocus
          />
        </div>

        {error && <div className="text-xs text-rose-400">{error}</div>}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            type="button"
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
