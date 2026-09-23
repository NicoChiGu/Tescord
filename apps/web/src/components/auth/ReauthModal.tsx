import React, { useState, useEffect, useRef } from "react";
import { useAuthStore } from "../../stores/useAuthStore.js";
import {
  Lock,
  AlertCircle,
  ArrowRight,
  LogOut,
  ShieldAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { flushPendingRequests } from "../../services/apiClient.js";
import { gatewayClient } from "../../services/gateway.js";

export const ReauthModal: React.FC = () => {
  const {
    isReauthModalOpen,
    reauthReason,
    user,
    lastActiveUser,
    reauth,
    switchAccount,
  } = useAuthStore();

  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const { t } = useTranslation(["auth", "common"]);

  const currentUser = user || lastActiveUser;

  // 模态阻断：阻止按下 ESC 键退出
  useEffect(() => {
    if (!isReauthModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    // 自动聚焦密码框
    const timer = setTimeout(() => {
      passwordInputRef.current?.focus();
    }, 100);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      clearTimeout(timer);
    };
  }, [isReauthModalOpen]);

  if (!isReauthModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setLocalError(
        t("auth:error.passwordRequired", {
          defaultValue: "请输入密码以验证身份",
        }),
      );
      return;
    }

    setLocalError(null);
    setIsSubmitting(true);

    try {
      await reauth(password);
      const latestToken = useAuthStore.getState().accessToken;

      // 1. 批量重放挂起的 HTTP 业务请求
      if (latestToken) {
        flushPendingRequests(latestToken);
      }

      // 2. 重新恢复 WebSocket 长连接网关
      if (latestToken) {
        gatewayClient.connect(latestToken);
      }

      setPassword("");
    } catch (err: any) {
      setLocalError(
        err.message ||
          t("auth:error.generalFailed", {
            defaultValue: "验证失败，请确认密码是否正确",
          }),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSwitchAccount = () => {
    switchAccount();
  };

  const displayName = currentUser?.username || "用户";
  const emailOrAccount = currentUser?.email || currentUser?.username || "";
  const avatarUrl = currentUser?.avatarUrl;

  return (
    <div
      data-testid="reauth-modal-backdrop"
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-300"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        data-testid="reauth-modal-content"
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-[#313338] p-8 shadow-2xl border border-white/10 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部警示图标与用户卡片 */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="relative mb-3">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-20 h-20 rounded-full object-cover border-2 border-[#5865f2] shadow-lg shadow-[#5865f2]/20"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-[#5865f2] flex items-center justify-center text-3xl font-black text-white shadow-lg shadow-[#5865f2]/20">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-amber-500 border-2 border-[#313338] flex items-center justify-center text-white"
              title="会话已过期"
            >
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>

          <h2 className="text-xl font-bold text-white tracking-tight">
            {displayName}
          </h2>
          {emailOrAccount && (
            <p className="text-xs text-gray-400 mt-0.5">{emailOrAccount}</p>
          )}

          <div className="mt-3 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              {reauthReason || "登录会话已过期，请输入密码解锁以继续当前操作"}
            </span>
          </div>
        </div>

        {/* 错误提示框 */}
        {localError && (
          <div
            data-testid="reauth-error-alert"
            className="mb-4 flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-sm text-rose-400"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{localError}</span>
          </div>
        )}

        {/* 密码验证表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
              {t("auth:password", { defaultValue: "密码" })}{" "}
              <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={passwordInputRef}
                type="password"
                data-testid="reauth-password-input"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码重新激活会话"
                disabled={isSubmitting}
                className="w-full rounded-lg bg-[#1e1f22] pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2] transition-all disabled:opacity-50"
              />
            </div>
          </div>

          <button
            type="submit"
            data-testid="reauth-submit-btn"
            disabled={isSubmitting}
            className="w-full py-2.5 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#5865f2]/20 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>解锁并恢复会话</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* 底部：切换账号 */}
        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
          <span>不是您的账号？</span>
          <button
            type="button"
            data-testid="reauth-switch-account-btn"
            onClick={handleSwitchAccount}
            className="text-gray-300 hover:text-white hover:underline flex items-center gap-1 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>切换其他账号</span>
          </button>
        </div>
      </div>
    </div>
  );
};
