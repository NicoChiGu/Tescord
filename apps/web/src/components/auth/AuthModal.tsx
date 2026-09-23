import React, { useState } from "react";
import { useAuthStore } from "../../stores/useAuthStore.js";
import {
  Lock,
  Mail,
  User as UserIcon,
  AlertCircle,
  Sparkles,
  ArrowRight,
  Globe,
  ChevronDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LOCALES, SupportedLocale } from "@tescord/types";
import { normalizeLocale } from "../../i18n/index.js";

export const AuthModal: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);

  const { t, i18n } = useTranslation(["auth", "common"]);
  const currentLocale = normalizeLocale(i18n.language);

  const { login, register } = useAuthStore();

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
        if (!username.trim() || !email.trim() || !password) {
          throw new Error(t("auth:error.requiredFieldsRegister"));
        }
        if (password.length < 6) {
          throw new Error(t("auth:error.passwordMinLength"));
        }
        await register({
          username: username.trim(),
          email: email.trim(),
          password,
        });
      }
    } catch (err: any) {
      setLocalError(err.message || t("auth:error.generalFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  interface PresetAccount {
    name: string;
    roleLabel: string;
    email: string;
    password: string;
    dotColor: string;
    tagClass: string;
    borderHoverClass: string;
  }

  const PRESET_ACCOUNTS: PresetAccount[] = [
    {
      name: "Jackey",
      roleLabel: "系统管理员",
      email: "admin@tescord.local",
      password: "adminpassword123",
      dotColor: "bg-emerald-400",
      tagClass: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      borderHoverClass: "hover:border-emerald-500/40 hover:bg-emerald-500/5",
    },
    {
      name: "Alice",
      roleLabel: "纯净测试 A",
      email: "alice@tescord.local",
      password: "alicepassword123",
      dotColor: "bg-sky-400",
      tagClass: "text-sky-400 bg-sky-500/10 border-sky-500/20",
      borderHoverClass: "hover:border-sky-500/40 hover:bg-sky-500/5",
    },
    {
      name: "Bob",
      roleLabel: "纯净测试 B",
      email: "bob@tescord.local",
      password: "bobpassword123",
      dotColor: "bg-purple-400",
      tagClass: "text-purple-400 bg-purple-500/10 border-purple-500/20",
      borderHoverClass: "hover:border-purple-500/40 hover:bg-purple-500/5",
    },
  ];

  const handleFillAccount = (acc: PresetAccount) => {
    setIsLogin(true);
    setEmail(acc.email);
    setPassword(acc.password);
    setLocalError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-[#313338] p-8 shadow-2xl border border-white/5">
        {/* 右上角快捷语言切换下拉器 */}
        <div className="absolute top-4 right-4 z-10">
          <div className="relative">
            <button
              type="button"
              data-testid="auth-language-selector"
              onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#2b2d31]/80 hover:bg-[#2b2d31] text-gray-300 hover:text-white border border-white/5 text-xs transition-colors"
            >
              <Globe className="w-3.5 h-3.5 text-[#5865f2]" />
              <span>
                {SUPPORTED_LOCALES.find((o) => o.code === currentLocale)
                  ?.nativeName || "语言"}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {isLangMenuOpen && (
              <div
                data-testid="auth-lang-menu"
                className="absolute right-0 mt-1 w-36 rounded-xl bg-[#2b2d31] border border-white/10 shadow-xl py-1 z-20 animate-in fade-in zoom-in-95 duration-100"
              >
                {SUPPORTED_LOCALES.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    data-testid={`auth-lang-${option.code}`}
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

          <button
            type="submit"
            data-testid="auth-submit-btn"
            disabled={isSubmitting}
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

        {/* 底部切换模式与快速测试账号 */}
        <div className="mt-6 pt-4 border-t border-white/5 flex flex-col gap-3.5">
          {/* 快速填入测试账号面板 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span className="flex items-center gap-1.5 font-medium text-gray-300">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                {t("auth:quickPresetLogin")}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {PRESET_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => handleFillAccount(acc)}
                  title={`一键填入 ${acc.name} (${acc.email})`}
                  className={`flex flex-col items-center justify-center py-2 px-1.5 rounded-xl bg-[#2b2d31]/80 border border-white/5 ${acc.borderHoverClass} transition-all duration-150 active:scale-[0.97] group`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-2 h-2 rounded-full ${acc.dotColor}`} />
                    <span className="text-xs font-semibold text-white group-hover:text-white transition-colors">
                      {acc.name}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border leading-none ${acc.tagClass}`}
                  >
                    {acc.roleLabel}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 模式切换 */}
          <div className="flex items-center justify-between text-xs text-gray-400 pt-1 border-t border-white/5">
            <span>
              {isLogin ? t("auth:needAccount") : t("auth:alreadyHaveAccount")}
            </span>
            <button
              type="button"
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
};
