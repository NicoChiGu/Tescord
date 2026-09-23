import React, { useState, useEffect, useRef } from "react";
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
  Edit3,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LOCALES,
  RegistrationStatusResponse,
  CheckEmailResponse,
} from "@tescord/types";
import { normalizeLocale } from "../../i18n/index.js";
import { API_BASE } from "../../config.js";
import { AuthBackground } from "./AuthBackground.js";

type AuthPhase = "EMAIL" | "PASSWORD" | "REGISTER";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export const AuthModal: React.FC = () => {
  const [phase, setPhase] = useState<AuthPhase>("EMAIL");
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const nicknameInputRef = useRef<HTMLInputElement>(null);

  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    inviteCode?: string;
    nickname?: string;
    general?: string;
  }>({});

  const [shakeFields, setShakeFields] = useState<{
    email?: boolean;
    password?: boolean;
    inviteCode?: boolean;
    nickname?: boolean;
  }>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);

  // 全站公开注册策略状态
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
          setInviteCode(code.trim().toUpperCase());
          setPhase("REGISTER");
        }
      }
    } catch {}

    return () => {
      isMounted = false;
    };
  }, []);

  // 阶段切换时自动聚焦到对应输入框
  useEffect(() => {
    if (phase === "PASSWORD") {
      passwordInputRef.current?.focus();
    } else if (phase === "REGISTER") {
      nicknameInputRef.current?.focus();
    } else {
      emailInputRef.current?.focus();
    }
  }, [phase]);

  const triggerFieldError = (
    field: "email" | "password" | "inviteCode" | "nickname",
    message: string
  ) => {
    setFieldErrors((prev) => ({ ...prev, [field]: message }));
    setShakeFields((prev) => ({ ...prev, [field]: true }));
    setTimeout(() => {
      setShakeFields((prev) => ({ ...prev, [field]: false }));
    }, 500);
  };

  const handleEmailChange = (val: string) => {
    setEmail(val);
    if (fieldErrors.email) {
      setFieldErrors((prev) => ({ ...prev, email: undefined }));
    }
  };

  const handlePasswordChange = (val: string) => {
    setPassword(val);
    if (fieldErrors.password) {
      setFieldErrors((prev) => ({ ...prev, password: undefined }));
    }
  };

  const handleNicknameChange = (val: string) => {
    setNickname(val);
    if (fieldErrors.nickname) {
      setFieldErrors((prev) => ({ ...prev, nickname: undefined }));
    }
  };

  const handleInviteCodeChange = (val: string) => {
    setInviteCode(val.toUpperCase());
    if (fieldErrors.inviteCode) {
      setFieldErrors((prev) => ({ ...prev, inviteCode: undefined }));
    }
  };

  const handleReturnToEmail = () => {
    setIsEmailVerified(false);
    setPhase("EMAIL");
    setPassword("");
    setFieldErrors({});
    setTimeout(() => {
      emailInputRef.current?.focus();
    }, 50);
  };

  // 表单统一提交分发处理，彻底阻止默认刷新
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (phase === "EMAIL") {
      const trimmed = email.trim();
      if (!trimmed) {
        triggerFieldError(
          "email",
          t("auth:error.requiredEmail", "请输入邮箱地址")
        );
        return;
      }
      if (!EMAIL_REGEX.test(trimmed)) {
        triggerFieldError(
          "email",
          t(
            "auth:error.invalidEmail",
            "请输入有效的邮箱地址（例如 name@example.com）"
          )
        );
        return;
      }

      setFieldErrors({});
      setIsSubmitting(true);

      try {
        const res = await fetch(`${API_BASE}/api/auth/check-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "检测邮箱失败");
        }

        const data: CheckEmailResponse = await res.json();
        setIsEmailVerified(true);
        if (data.exists) {
          setPhase("PASSWORD");
        } else {
          setPhase("REGISTER");
        }
      } catch (err: any) {
        triggerFieldError("email", err.message || "检测邮箱失败");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (phase === "PASSWORD") {
      if (!password) {
        triggerFieldError("password", t("auth:error.requiredFieldsLogin"));
        return;
      }

      setFieldErrors({});
      setIsSubmitting(true);

      try {
        await login({
          emailOrUsername: email.trim(),
          password,
        });
      } catch (err: any) {
        triggerFieldError("password", err.message || t("auth:error.generalFailed"));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (phase === "REGISTER") {
      if (!registrationPolicy.allowRegistration) {
        setFieldErrors({ general: "当前系统已暂停新用户注册，请联系管理员" });
        return;
      }

      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        triggerFieldError(
          "email",
          t("auth:error.requiredEmail", "请输入邮箱地址")
        );
        return;
      }
      if (!EMAIL_REGEX.test(trimmedEmail)) {
        triggerFieldError(
          "email",
          t(
            "auth:error.invalidEmail",
            "请输入有效的邮箱地址（例如 name@example.com）"
          )
        );
        return;
      }

      const trimmedNickname = nickname.trim();
      if (!trimmedNickname) {
        triggerFieldError("nickname", "请输入您的昵称");
        return;
      }
      if (!password) {
        triggerFieldError("password", "请输入密码");
        return;
      }
      if (password.length < 6) {
        triggerFieldError("password", t("auth:error.passwordMinLength"));
        return;
      }
      if (registrationPolicy.requireInviteCode && !inviteCode.trim()) {
        triggerFieldError("inviteCode", "系统已开启邀请码准入，请填写注册邀请码");
        return;
      }

      setFieldErrors({});
      setIsSubmitting(true);

      try {
        await register({
          nickname: trimmedNickname,
          username: trimmedNickname,
          email: trimmedEmail,
          password,
          inviteCode: inviteCode.trim().toUpperCase() || undefined,
        });
      } catch (err: any) {
        const msg = err.message || t("auth:error.generalFailed");
        if (msg.includes("邀请码") || msg.toLowerCase().includes("invite")) {
          triggerFieldError("inviteCode", msg);
        } else if (msg.includes("密码") || msg.toLowerCase().includes("password")) {
          triggerFieldError("password", msg);
        } else {
          setFieldErrors({ general: msg });
        }
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const getTitleAndSubtitle = () => {
    if (phase === "EMAIL") {
      return {
        title: "欢迎使用 Tescord",
        subtitle: "输入邮箱以继续登录或创建新账号",
      };
    }
    if (phase === "PASSWORD") {
      return {
        title: t("auth:welcomeBack"),
        subtitle: t("auth:welcomeBackDesc"),
      };
    }
    return {
      title: t("auth:createAccount"),
      subtitle: "该邮箱尚未注册，请设置昵称与密码完成加入",
    };
  };

  const { title, subtitle } = getTitleAndSubtitle();

  const getButtonText = () => {
    if (phase === "EMAIL") return t("common:continue", "继续");
    if (phase === "PASSWORD") return t("auth:login", "登录");
    return t("auth:registerAndLogin", "注册并登录");
  };

  const content = (
    <div
      className={
        isElectron
          ? "relative w-full h-full bg-[#313338] px-6 py-5 flex flex-col justify-between overflow-y-auto select-none transition-all duration-300"
          : "relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-[#313338]/95 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.65)] border border-white/10 backdrop-blur-md transition-all duration-300"
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
              <div className="absolute right-0 top-full mt-1 w-36 py-1 bg-[#2b2d31] rounded-lg shadow-xl border border-white/10 z-50 animate-auth-step">
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

        {/* 顶部 Logo 与标语（随阶段平滑过渡） */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-[#5865f2] flex items-center justify-center shadow-lg shadow-[#5865f2]/30 mb-3 transform hover:rotate-6 transition-transform">
            <span className="text-3xl font-black text-white">T</span>
          </div>
          <div key={phase} className="animate-auth-step">
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {title}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {subtitle}
            </p>
          </div>
        </div>

        {/* 注册暂停提示横幅 */}
        {phase === "REGISTER" && !registrationPolicy.allowRegistration && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-300 animate-auth-field">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-400" />
            <span>当前系统已暂停新用户注册，请联系超级管理员</span>
          </div>
        )}

        {/* 全局错误提示框 */}
        {fieldErrors.general && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-sm text-rose-400 animate-auth-field">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{fieldErrors.general}</span>
          </div>
        )}

        {/* 连续统一表单（核心元素常驻，字段平滑流转展开） */}
        <form noValidate onSubmit={handleSubmit} className="space-y-4">
          {/* 1. 邮箱字段：全流程常驻 */}
          <div>
            <div className="flex items-center justify-between mb-1.5 min-h-[18px]">
              <label
                className={`block text-xs font-bold uppercase tracking-wider transition-colors duration-200 ${
                  fieldErrors.email ? "text-rose-400" : "text-gray-300"
                }`}
              >
                {t("auth:email")} <span className="text-rose-400">*</span>
              </label>
              {phase !== "EMAIL" && isEmailVerified && (
                <button
                  type="button"
                  data-testid="auth-edit-email-btn"
                  onClick={handleReturnToEmail}
                  className="text-xs text-[#5865f2] hover:underline font-medium flex items-center gap-1 transition-all animate-auth-field"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>修改邮箱</span>
                </button>
              )}
            </div>
            <div
              className={`relative transition-transform ${
                shakeFields.email ? "animate-shake" : ""
              }`}
            >
              <Mail
                className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-200 ${
                  fieldErrors.email
                    ? "text-rose-400"
                    : phase !== "EMAIL" && isEmailVerified
                    ? "text-gray-500"
                    : "text-gray-400"
                }`}
              />
              <input
                ref={emailInputRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                data-testid="auth-email-input"
                required
                disabled={phase !== "EMAIL" && isEmailVerified}
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                placeholder={t("auth:emailPlaceholder")}
                className={`w-full rounded-lg pl-10 pr-4 py-2.5 text-sm transition-all duration-200 ${
                  fieldErrors.email
                    ? "border border-rose-500 ring-2 ring-rose-500/20 bg-[#1e1f22] text-white"
                    : phase !== "EMAIL" && isEmailVerified
                    ? "bg-[#1e1f22]/70 text-gray-400 cursor-not-allowed border border-white/5 opacity-80 select-none"
                    : "bg-[#1e1f22] text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
                }`}
              />
            </div>
            {fieldErrors.email && (
              <p className="mt-1.5 text-xs text-rose-400 flex items-center gap-1.5 animate-auth-field">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{fieldErrors.email}</span>
              </p>
            )}
          </div>

          {/* 2. 密码阶段展开项 (Phase === PASSWORD) */}
          {phase === "PASSWORD" && (
            <div className="space-y-4 animate-auth-field">
              <div>
                <label
                  className={`block text-xs font-bold uppercase tracking-wider mb-1.5 ${
                    fieldErrors.password ? "text-rose-400" : "text-gray-300"
                  }`}
                >
                  {t("auth:password")} <span className="text-rose-400">*</span>
                </label>
                <div
                  className={`relative transition-transform ${
                    shakeFields.password ? "animate-shake" : ""
                  }`}
                >
                  <Lock
                    className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      fieldErrors.password ? "text-rose-400" : "text-gray-400"
                    }`}
                  />
                  <input
                    ref={passwordInputRef}
                    type="password"
                    data-testid="auth-password-input"
                    required
                    value={password}
                    onChange={(e) => handlePasswordChange(e.target.value)}
                    placeholder={t("auth:passwordPlaceholder")}
                    className={`w-full rounded-lg bg-[#1e1f22] pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none transition-all ${
                      fieldErrors.password
                        ? "border border-rose-500 ring-2 ring-rose-500/20"
                        : "focus:ring-2 focus:ring-[#5865f2]"
                    }`}
                  />
                </div>
                {fieldErrors.password && (
                  <p className="mt-1.5 text-xs text-rose-400 flex items-center gap-1.5 animate-auth-field">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{fieldErrors.password}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 3. 注册阶段展开项 (Phase === REGISTER) */}
          {phase === "REGISTER" && (
            <div className="space-y-4 animate-auth-field">
              {/* 昵称输入 */}
              <div>
                <label
                  className={`block text-xs font-bold uppercase tracking-wider mb-1.5 ${
                    fieldErrors.nickname ? "text-rose-400" : "text-gray-300"
                  }`}
                >
                  昵称 <span className="text-rose-400">*</span>
                </label>
                <div
                  className={`relative transition-transform ${
                    shakeFields.nickname ? "animate-shake" : ""
                  }`}
                >
                  <UserIcon
                    className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      fieldErrors.nickname ? "text-rose-400" : "text-gray-400"
                    }`}
                  />
                  <input
                    ref={nicknameInputRef}
                    type="text"
                    data-testid="auth-username-input"
                    required
                    value={nickname}
                    onChange={(e) => handleNicknameChange(e.target.value)}
                    placeholder="请输入您的昵称 (如 Nick)"
                    className={`w-full rounded-lg bg-[#1e1f22] pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none transition-all ${
                      fieldErrors.nickname
                        ? "border border-rose-500 ring-2 ring-rose-500/20"
                        : "focus:ring-2 focus:ring-[#5865f2]"
                    }`}
                  />
                </div>
                {fieldErrors.nickname && (
                  <p className="mt-1.5 text-xs text-rose-400 flex items-center gap-1.5 animate-auth-field">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{fieldErrors.nickname}</span>
                  </p>
                )}
              </div>

              {/* 密码输入 */}
              <div>
                <label
                  className={`block text-xs font-bold uppercase tracking-wider mb-1.5 ${
                    fieldErrors.password ? "text-rose-400" : "text-gray-300"
                  }`}
                >
                  {t("auth:password")} <span className="text-rose-400">*</span>
                </label>
                <div
                  className={`relative transition-transform ${
                    shakeFields.password ? "animate-shake" : ""
                  }`}
                >
                  <Lock
                    className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      fieldErrors.password ? "text-rose-400" : "text-gray-400"
                    }`}
                  />
                  <input
                    ref={passwordInputRef}
                    type="password"
                    data-testid="auth-password-input"
                    required
                    value={password}
                    onChange={(e) => handlePasswordChange(e.target.value)}
                    placeholder={t("auth:passwordPlaceholder")}
                    className={`w-full rounded-lg bg-[#1e1f22] pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none transition-all ${
                      fieldErrors.password
                        ? "border border-rose-500 ring-2 ring-rose-500/20"
                        : "focus:ring-2 focus:ring-[#5865f2]"
                    }`}
                  />
                </div>
                {fieldErrors.password && (
                  <p className="mt-1.5 text-xs text-rose-400 flex items-center gap-1.5 animate-auth-field">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{fieldErrors.password}</span>
                  </p>
                )}
              </div>

              {/* 邀请码输入 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    className={`block text-xs font-bold uppercase tracking-wider ${
                      fieldErrors.inviteCode ? "text-rose-400" : "text-gray-300"
                    }`}
                  >
                    邀请码{" "}
                    {registrationPolicy.requireInviteCode && (
                      <span className="text-rose-400">*</span>
                    )}
                  </label>
                  <span className="text-[11px] text-gray-400">
                    {registrationPolicy.requireInviteCode ? "必填准入" : "选填"}
                  </span>
                </div>
                <div
                  className={`relative transition-transform ${
                    shakeFields.inviteCode ? "animate-shake" : ""
                  }`}
                >
                  <KeyRound
                    className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      fieldErrors.inviteCode ? "text-rose-400" : "text-gray-400"
                    }`}
                  />
                  <input
                    type="text"
                    data-testid="auth-invite-code-input"
                    required={registrationPolicy.requireInviteCode}
                    value={inviteCode}
                    onChange={(e) => handleInviteCodeChange(e.target.value)}
                    placeholder={
                      registrationPolicy.requireInviteCode
                        ? "请输入注册邀请码"
                        : "如有邀请码可在此填写 (选填)"
                    }
                    className={`w-full rounded-lg bg-[#1e1f22] pl-10 pr-4 py-2.5 text-sm text-white uppercase placeholder-gray-500 font-mono tracking-wider focus:outline-none transition-all ${
                      fieldErrors.inviteCode
                        ? "border border-rose-500 ring-2 ring-rose-500/20"
                        : "focus:ring-2 focus:ring-[#5865f2]"
                    }`}
                  />
                </div>
                {fieldErrors.inviteCode && (
                  <p className="mt-1.5 text-xs text-rose-400 flex items-center gap-1.5 animate-auth-field">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{fieldErrors.inviteCode}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 统一操作按钮（文字与动效随阶段平滑过渡） */}
          <button
            type="submit"
            data-testid="auth-submit-btn"
            disabled={
              isSubmitting ||
              (phase === "REGISTER" && !registrationPolicy.allowRegistration)
            }
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] active:scale-[0.98] py-2.5 text-sm font-semibold text-white shadow-md shadow-[#5865f2]/25 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <div key={phase} className="flex items-center gap-2 animate-auth-step">
                <span>{getButtonText()}</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            )}
          </button>
        </form>

        {/* 底部导航提示 */}
        {phase !== "EMAIL" && (
          <div className="mt-6 pt-4 border-t border-white/5 flex flex-col gap-3.5 animate-auth-field">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>需要使用其他邮箱？</span>
              <button
                type="button"
                data-testid="auth-switch-mode-btn"
                onClick={handleReturnToEmail}
                className="text-[#5865f2] hover:underline font-medium transition-colors"
              >
                返回重新输入
              </button>
            </div>
          </div>
        )}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden animate-fade-in">
      <AuthBackground />
      {content}
    </div>
  );
};
