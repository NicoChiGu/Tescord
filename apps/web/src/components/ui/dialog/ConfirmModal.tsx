import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, AlertCircle, Info, ShieldAlert } from "lucide-react";
import { BaseModal } from "./BaseModal";
import { ConfirmDialogOptions } from "../../../stores/useDialogStore";

interface ConfirmModalProps {
  options: ConfirmDialogOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  options,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation("common");
  const {
    title,
    description,
    confirmText = t("common:dialog.confirm", "确定"),
    cancelText = t("common:dialog.cancel", "取消"),
    variant = "info",
    requireSecurityCode = false,
    dangerWarning,
  } = options;

  // 随机生成 4 位数字安全验证码 (1000 - 9999)
  const securityCode = useMemo(() => {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }, []);

  const [inputCode, setInputCode] = useState("");

  const isMatched = !requireSecurityCode || inputCode.trim() === securityCode;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && isMatched) {
      e.preventDefault();
      onConfirm();
    }
  };

  const getIcon = () => {
    switch (variant) {
      case "danger":
        return <AlertTriangle className="w-5 h-5 text-rose-500" />;
      case "warning":
        return <AlertCircle className="w-5 h-5 text-amber-500" />;
      case "info":
      default:
        return <Info className="w-5 h-5 text-discord-brand" />;
    }
  };

  const getConfirmButtonClasses = () => {
    if (!isMatched) {
      return "bg-gray-700/60 text-gray-500 cursor-not-allowed border border-white/5";
    }
    switch (variant) {
      case "danger":
        return "bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-900/30 transition-all font-semibold";
      case "warning":
        return "bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-900/30 transition-all font-semibold";
      case "info":
      default:
        return "bg-discord-brand hover:bg-discord-brand-hover text-white transition-all font-semibold";
    }
  };

  return (
    <BaseModal isOpen={true} onClose={onCancel} title={title} icon={getIcon()}>
      <div className="space-y-4" onKeyDown={handleKeyDown}>
        {/* 说明内容 */}
        {description && (
          <div className="text-sm text-gray-300 leading-relaxed">
            {typeof description === "string" ? (
              <p>{description}</p>
            ) : (
              description
            )}
          </div>
        )}

        {/* 危险警告条 */}
        {(dangerWarning || variant === "danger") && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs px-3.5 py-2.5 rounded-xl flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
            <div className="leading-relaxed">
              {dangerWarning ||
                t(
                  "common:dialog.dangerWarning",
                  "此操作具有破坏性且无法撤销！",
                )}
            </div>
          </div>
        )}

        {/* 4 位数字安全验证码输入区 */}
        {requireSecurityCode && (
          <div className="space-y-3 pt-1">
            <div className="flex flex-col items-center justify-center p-3.5 bg-[#1e1f22] rounded-xl border border-white/5 space-y-2">
              <span className="text-xs text-gray-400 font-medium">
                {t("common:dialog.securityCode", "安全验证码")}
              </span>
              <div className="text-2xl font-mono font-extrabold tracking-[0.35em] text-amber-400 select-all bg-black/40 px-5 py-1.5 rounded-lg border border-amber-500/30 shadow-inner">
                {securityCode}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center justify-between">
                <span>
                  {t(
                    "common:dialog.securityCodePrompt",
                    "请输入上方显示的 4 位安全验证码以继续：",
                  )}
                </span>
                <span className="text-gray-500 font-normal">
                  {inputCode.length}/4
                </span>
              </label>
              <input
                type="text"
                data-testid="dialog-security-code-input"
                inputMode="numeric"
                maxLength={4}
                value={inputCode}
                onChange={(e) =>
                  setInputCode(e.target.value.replace(/\D/g, ""))
                }
                placeholder="4 位验证码"
                className="w-full bg-[#1e1f22] border border-white/10 rounded-lg px-3.5 py-2.5 text-center text-lg font-mono font-bold tracking-widest text-white placeholder-gray-500 focus:outline-none focus:border-red-500 transition-colors"
                autoFocus
              />
            </div>
          </div>
        )}

        {/* 操作按钮组 */}
        <div className="flex items-center justify-end gap-3 pt-3">
          <button
            type="button"
            data-testid="dialog-cancel-btn"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            data-testid="dialog-confirm-btn"
            disabled={!isMatched}
            onClick={() => {
              if (isMatched) onConfirm();
            }}
            className={`px-5 py-2 rounded-lg text-sm transition-all ${getConfirmButtonClasses()}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
