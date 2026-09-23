import React, { useState, useEffect } from "react";
import { useAuthStore } from "../../stores/useAuthStore.js";
import {
  Lock,
  Mail,
  User as UserIcon,
  AlertCircle,
  ArrowRight,
  Globe,
  ChevronDown,
  KeyRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LOCALES,
  RegistrationStatusResponse,
} from "@tescord/types";
import { normalizeLocale } from "../../i18n/index.js";
import { API_BASE } from "../../config.js";
import { AuthBackground } from "./AuthBackground.js";

export const AuthModal: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);

  // 全站公开注册策略状态 (默认允许且免邀请码，随后异步自愈同步)
  const [registrationPolicy, setRegistrationPolicy] = useState<RegistrationStatusResponse>({
    allowRegistration: true,
    requireInviteCode: false,
  });

  const { t, i18n } = useTranslation(["auth", "common"]);
  const currentLocale = normalizeLocale(i18n.language);
  const isElectron =
    typeof window !== "undefined" && Boolean(window.electronAPI);

  const { login, register } = useAuthStore();

  // 组件挂载时获取系统注册状态，并解析 URL ?invite= 参数
  useEffect(() => {
    let isMounted = true;
    fetch(`${API_BASE}/api/auth/registration-status`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RegistrationStatusResponse | null) => {
        if (isMounted && data) {
          setRegistrationPolicy(data);
        }
      })
      .catch(() => {});

    try {
      const search = typeof window !== "undefined" ? window.location.search : "";
      if (search) {
        const params = new URLSearchParams(search);
        const code = params.get("invite");
        if (code && isMounted) {
          setIsLogin(false);
          setInviteCode(code.trim().toUpperCase());
        }
      }
    } catch {}

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setIsSubmitting(true);

    try {
      if (isLogin) {
        if (!email.trim() || !password) {
          throw new Error(t("auth:error.requiredFieldsLogin"));
        }
        await login({
          emailOrUsername: email.trim(),
          password,
        });
      } else {
        if (!registrationPolicy.allowRegistration) {
          throw new Error("当前系统已暂停新用户注册，请联系管理员");
        }
        if (!username.trim() || !email.trim() || !password) {
          throw new Error(t("auth:error.requiredFieldsRegister"));
        }
        if (password.length < 6) {
          throw new Error(t("auth:error.passwordMinLength"));
        }
        if (registrationPolicy.requireInviteCode && !inviteCode.trim()) {
          throw new Error("系统已开启邀请码准入，请填写注册邀请码");
        }

        await register({
          username: username.trim(),
          email: email.trim(),
          password,
          inviteCode: inviteCode.trim().toUpperCase() || undefined,
        });
      }
    } catch (err: any) {
      setLocalError(err.message || t("auth:error.generalFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const content = (
    <div
      className={
        isElectron
          ? "relative w-full h-full bg-[#313338] px-6 py-5 flex flex-col justify-between overflow-y-auto select-none"
          : "relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-[#313338]/95 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.65)] border border-white/10 backdrop-blur-md"
      }
    >
      <div>
        {/* 顶部语言切换器 */}
        <div className="flex justify-end mb-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors border border-white/5"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>
                {SUPPORTED_LOCALES.find((l) => l.code === currentLocale)?.nativeName ||
                  "Language"}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>

            {isLangMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 py-1 bg-[#2b2d31] rounded-lg shadow-xl border border-white/10 z-50 animate-in fade-in zoom-in-95 duration-100">
                {SUPPORTED_LOCALES.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    onClick={async () => {
                      await i18n.changeLanguage(option.code);
                      setIsLangMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-white/5 ${
                      currentLocale === option.code
                        ? "text-[#5865f2] font-semibold"
                        : "text-gray-300"
                    }`}
                  >
                    <span>{option.nativeName}</span>
                    {currentLocale === option.code && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#5865f2]" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 顶部 Logo 与标语 */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-[#5865f2] flex items-center justify-center shadow-lg shadow-[#5865f2]/30 mb-3 transform hover:rotate-6 transition-transform">
            <span className="text-3xl font-black text-white">T</span>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            {isLogin ? t("auth:welcomeBack") : t("auth:createAccount")}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {isLogin ? t("auth:welcomeBackDesc") : t("auth:createAccountDesc")}
          </p>
        </div>

        {/* 注册暂停提示横幅 */}
        {!isLogin && !registrationPolicy.allowRegistration && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-400" />
            <span>当前系统已暂停新用户注册，请联系超级管理员</span>
          </div>
        )}

        {/* 错误提示框 */}
        {localError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-sm text-rose-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{localError}</span>
          </div>
        )}

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                {t("auth:username")} <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  data-testid="auth-username-input"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("auth:usernamePlaceholder")}
                  className="w-full rounded-lg bg-[#1e1f22] pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2] transition-all"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
              {isLogin ? t("auth:emailOrUsername") : t("auth:email")}{" "}
              <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type={isLogin ? "text" : "email"}
                data-testid="auth-email-input"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={
                  isLogin
                    ? t("auth:emailOrUsernamePlaceholder")
                    : t("auth:emailPlaceholder")
                }
                className="w-full rounded-lg bg-[#1e1f22] pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2] transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
              {t("auth:password")} <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                data-testid="auth-password-input"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth:passwordPlaceholder")}
                className="w-full rounded-lg bg-[#1e1f22] pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2] transition-all"
              />
            </div>
          </div>

          {/* 注册模式下的邀请码输入项 */}
          {!isLogin && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-300">
                  邀请码{" "}
                  {registrationPolicy.requireInviteCode && (
                    <span className="text-rose-400">*</span>
                  )}
                </label>
                <span className="text-[11px] text-gray-400">
                  {registrationPolicy.requireInviteCode ? "必填准入" : "选填"}
                </span>
              </div>
              <div className="relative">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  data-testid="auth-invite-code-input"
                  required={registrationPolicy.requireInviteCode}
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder={
                    registrationPolicy.requireInviteCode
                      ? "请输入注册邀请码"
                      : "如有邀请码可在此填写 (选填)"
                  }
                  className="w-full rounded-lg bg-[#1e1f22] pl-10 pr-4 py-2.5 text-sm text-white uppercase placeholder-gray-500 font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-[#5865f2] transition-all"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            data-testid="auth-submit-btn"
            disabled={
              isSubmitting ||
              (!isLogin && !registrationPolicy.allowRegistration)
            }
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] active:scale-[0.98] py-2.5 text-sm font-semibold text-white shadow-md shadow-[#5865f2]/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>
                  {isLogin ? t("auth:login") : t("auth:registerAndLogin")}
                </span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* 底部模式切换 */}
        <div className="mt-6 pt-4 border-t border-white/5 flex flex-col gap-3.5">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>
              {isLogin ? t("auth:needAccount") : t("auth:alreadyHaveAccount")}
            </span>
            <button
              type="button"
              data-testid="auth-switch-mode-btn"
              onClick={() => {
                setIsLogin(!isLogin);
                setLocalError(null);
              }}
              className="text-[#5865f2] hover:underline font-medium"
            >
              {isLogin ? t("auth:registerNow") : t("auth:backToLogin")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (isElectron) {
    return (
      <div className="w-full h-full bg-[#313338] overflow-hidden select-none">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden animate-in fade-in duration-200">
      <AuthBackground />
      {content}
    </div>
  );
};
