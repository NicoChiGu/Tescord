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
  Fingerprint,
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
import { AccountPicker } from "./AccountPicker.js";
import { SavedAccount } from "@tescord/types";
import { isWebAuthnSupported } from "../../utils/webauthn.js";

type AuthPhase = "ACCOUNT_PICKER" | "EMAIL" | "PASSWORD" | "REGISTER";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export const AuthModal: React.FC = () => {
  const {
    login,
    loginWithPasskey,
    register,
    savedAccounts,
    removeSavedAccount,
    loginWithSavedAccount,
  } = useAuthStore();

  const [selectedAccount, setSelectedAccount] = useState<SavedAccount | null>(
    () => {
      return savedAccounts && savedAccounts.length > 0
        ? savedAccounts[0]
        : null;
    },
  );
  const [rememberPassword, setRememberPassword] = useState(true);
  const [phase, setPhase] = useState<AuthPhase>(() => {
    return savedAccounts && savedAccounts.length > 0
      ? "ACCOUNT_PICKER"
      : "EMAIL";
  });

  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [email, setEmail] = useState(() => {
    return savedAccounts && savedAccounts.length > 0
      ? savedAccounts[0].email
      : "";
  });
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
  const isPasskeySupported = isWebAuthnSupported();
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);

  const handlePasskeyLogin = async () => {
    setIsPasskeyLoading(true);
    setFieldErrors({});
    try {
      const targetIdentifier =
        phase === "PASSWORD" ? selectedAccount?.email || email : undefined;
      await loginWithPasskey(targetIdentifier);
    } catch (err: any) {
      if (err.name !== "NotAllowedError") {
        setFieldErrors((prev) => ({
          ...prev,
          general:
            err.message ||
            t("auth:passkeyLoginFailed", { defaultValue: "通行密钥验证失败" }),
        }));
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  // 当账号列表被清空且当前处于 ACCOUNT_PICKER 阶段时，自动回退到常规邮箱输入
  useEffect(() => {
    if (
      phase === "ACCOUNT_PICKER" &&
      (!savedAccounts || savedAccounts.length === 0)
    ) {
      setPhase("EMAIL");
      setSelectedAccount(null);
    }
  }, [savedAccounts, phase]);

  // 全站公开注册策略状态
  const [registrationPolicy, setRegistrationPolicy] =
    useState<RegistrationStatusResponse>({
      allowRegistration: true,
      requireInviteCode: false,
    });

  const { t, i18n } = useTranslation(["auth", "common"]);
  const currentLocale = normalizeLocale(i18n.language);
  const isElectron =
    typeof window !== "undefined" && Boolean(window.electronAPI);

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
      const search =
        typeof window !== "undefined" ? window.location.search : "";
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
    } else if (phase === "EMAIL") {
      emailInputRef.current?.focus();
    }
  }, [phase]);

  const triggerFieldError = (
    field: "email" | "password" | "inviteCode" | "nickname",
    message: string,
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

  const handleSelectAccount = async (account: SavedAccount) => {
    setSelectedAccount(account);
    setEmail(account.email);
    setPassword("");
    setFieldErrors({});

    // 若开启免密且具备长效 RefreshToken，执行静默快捷登录
    if (account.rememberPassword && account.refreshToken) {
      setIsSubmitting(true);
      try {
        const ok = await loginWithSavedAccount(account);
        if (ok) {
          return;
        }
      } catch {
        // 静默换票失败，降级为就地输入密码
      } finally {
        setIsSubmitting(false);
      }
    }

    setPhase("PASSWORD");
  };

  const handleUseAnotherAccount = () => {
    setSelectedAccount(null);
    setEmail("");
    setPassword("");
    setFieldErrors({});
    setIsEmailVerified(false);
    setPhase("EMAIL");
    setTimeout(() => {
      emailInputRef.current?.focus();
    }, 50);
  };

  const handleReturnFromPassword = () => {
    setIsEmailVerified(false);
    setPassword("");
    setFieldErrors({});
    if (savedAccounts && savedAccounts.length > 0) {
      setPhase("ACCOUNT_PICKER");
    } else {
      setPhase("EMAIL");
      setTimeout(() => {
        emailInputRef.current?.focus();
      }, 50);
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
          t("auth:error.requiredEmail", { defaultValue: "请输入邮箱地址" }),
        );
        return;
      }
      if (!EMAIL_REGEX.test(trimmed)) {
        triggerFieldError(
          "email",
          t("auth:error.invalidEmail", {
            defaultValue: "请输入有效的邮箱地址（例如 name@example.com）",
          }),
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
          throw new Error(
            data.error ||
              t("auth:error.checkEmailFailed", {
                defaultValue: "检测邮箱失败",
              }),
          );
        }

        const data: CheckEmailResponse = await res.json();
        setIsEmailVerified(true);
        if (data.exists) {
          const matched = savedAccounts.find(
            (a) => a.email.toLowerCase() === trimmed.toLowerCase(),
          );
          if (matched) {
            setSelectedAccount(matched);
          } else {
            setSelectedAccount(null);
          }
          setPhase("PASSWORD");
        } else {
          setPhase("REGISTER");
        }
      } catch (err: any) {
        triggerFieldError(
          "email",
          err.message ||
            t("auth:error.checkEmailFailed", {
              defaultValue: "检测邮箱失败",
            }),
        );
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (phase === "PASSWORD") {
      if (!password) {
        triggerFieldError(
          "password",
          t("auth:error.requiredFieldsLogin", {
            defaultValue: "请输入邮箱/用户名以及密码",
          }),
        );
        return;
      }

      setFieldErrors({});
      setIsSubmitting(true);

      try {
        await login({
          emailOrUsername: email.trim(),
          password,
          rememberMe: rememberPassword,
        });
      } catch (err: any) {
        triggerFieldError(
          "password",
          err.message ||
            t("auth:error.generalFailed", {
              defaultValue: "操作失败，请重试",
            }),
        );
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (phase === "REGISTER") {
      if (!registrationPolicy.allowRegistration) {
        setFieldErrors({
          general: t("auth:registrationDisabled", {
            defaultValue: "当前系统已暂停新用户注册，请联系超级管理员",
          }),
        });
        return;
      }

      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        triggerFieldError(
          "email",
          t("auth:error.requiredEmail", { defaultValue: "请输入邮箱地址" }),
        );
        return;
      }
      if (!EMAIL_REGEX.test(trimmedEmail)) {
        triggerFieldError(
          "email",
          t("auth:error.invalidEmail", {
            defaultValue: "请输入有效的邮箱地址（例如 name@example.com）",
          }),
        );
        return;
      }

      const trimmedNickname = nickname.trim();
      if (!trimmedNickname) {
        triggerFieldError(
          "nickname",
          t("auth:error.requiredNickname", { defaultValue: "请输入您的昵称" }),
        );
        return;
      }
      if (!password) {
        triggerFieldError(
          "password",
          t("auth:error.requiredPassword", { defaultValue: "请输入密码" }),
        );
        return;
      }
      if (password.length < 6) {
        triggerFieldError(
          "password",
          t("auth:error.passwordMinLength", {
            defaultValue: "密码长度至少需要 6 个字符",
          }),
        );
        return;
      }
      if (registrationPolicy.requireInviteCode && !inviteCode.trim()) {
        triggerFieldError(
          "inviteCode",
          t("auth:error.inviteCodeRequired", {
            defaultValue: "系统已开启邀请码准入，请填写注册邀请码",
          }),
        );
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
        const msg =
          err.message ||
          t("auth:error.generalFailed", {
            defaultValue: "操作失败，请重试",
          });
        if (msg.includes("邀请码") || msg.toLowerCase().includes("invite")) {
          triggerFieldError("inviteCode", msg);
        } else if (
          msg.includes("密码") ||
          msg.toLowerCase().includes("password")
        ) {
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
        title: t("auth:welcomeTitle", { defaultValue: "欢迎使用 Tescord" }),
        subtitle: t("auth:welcomeSubtitle", {
          defaultValue: "输入邮箱以继续登录或创建新账号",
        }),
      };
    }
    if (phase === "PASSWORD") {
      return {
        title: t("auth:welcomeBack", { defaultValue: "欢迎回到 Tescord！" }),
        subtitle: t("auth:welcomeBackDesc", {
          defaultValue: "很高兴再次见到你，立刻加入语音与聊天。",
        }),
      };
    }
    return {
      title: t("auth:createAccount", { defaultValue: "创建你的 Tescord 账号" }),
      subtitle: t("auth:registerSubtitle", {
        defaultValue: "该邮箱尚未注册，请设置昵称与密码完成加入",
      }),
    };
  };

  const { title, subtitle } = getTitleAndSubtitle();

  const getButtonText = () => {
    if (phase === "EMAIL")
      return t("common:continue", { defaultValue: "继续" });
    if (phase === "PASSWORD") return t("auth:login", { defaultValue: "登录" });
    return t("auth:registerAndLogin", { defaultValue: "注册并登录" });
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
              data-testid="auth-language-selector"
              onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors border border-white/5"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>
                {SUPPORTED_LOCALES.find((l) => l.code === currentLocale)
                  ?.nativeName || "Language"}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>

            {isLangMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 py-1 bg-[#2b2d31] rounded-lg shadow-xl border border-white/10 z-50 animate-auth-step">
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

        {/* 当处于账号选择器阶段时，直接呈现 AccountPicker */}
        {phase === "ACCOUNT_PICKER" ? (
          <AccountPicker
            savedAccounts={savedAccounts}
            onSelectAccount={handleSelectAccount}
            onUseAnotherAccount={handleUseAnotherAccount}
            onRemoveAccount={removeSavedAccount}
            onPasskeyLogin={handlePasskeyLogin}
            isPasskeySupported={isPasskeySupported}
            isLoading={isSubmitting || isPasskeyLoading}
          />
        ) : (
          <>
            {/* 顶部 Logo 与标语 / 选定账号大卡片（平滑过渡） */}
            {phase === "PASSWORD" && selectedAccount ? (
              <div className="flex flex-col items-center text-center mb-6 animate-auth-step">
                <div className="relative mb-3">
                  {selectedAccount.avatarUrl ? (
                    <img
                      src={selectedAccount.avatarUrl}
                      alt={
                        selectedAccount.displayName || selectedAccount.username
                      }
                      className="w-20 h-20 rounded-full object-cover border-2 border-[#5865f2] shadow-lg shadow-[#5865f2]/25"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-[#5865f2] flex items-center justify-center text-3xl font-black text-white shadow-lg shadow-[#5865f2]/25">
                      {(selectedAccount.displayName || selectedAccount.username)
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}
                </div>
                <h2 className="text-xl font-bold text-white tracking-tight">
                  {selectedAccount.displayName || selectedAccount.username}
                </h2>
                <p className="text-xs text-discord-textMuted mt-0.5">
                  {selectedAccount.discriminator
                    ? `@${selectedAccount.username.split("#")[0]}#${selectedAccount.discriminator}`
                    : `@${selectedAccount.username}`}
                </p>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">
                  {selectedAccount.email}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-16 h-16 rounded-2xl bg-[#5865f2] flex items-center justify-center shadow-lg shadow-[#5865f2]/30 mb-3 transform hover:rotate-6 transition-transform">
                  <span className="text-3xl font-black text-white">T</span>
                </div>
                <div key={phase} className="animate-auth-step">
                  <h2 className="text-2xl font-bold text-white tracking-tight">
                    {title}
                  </h2>
                  <p className="text-sm text-gray-400 mt-1">{subtitle}</p>
                </div>
              </div>
            )}

            {/* 注册暂停提示横幅 */}
            {phase === "REGISTER" && !registrationPolicy.allowRegistration && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-300 animate-auth-field">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-400" />
                <span>
                  {t("auth:registrationDisabled", {
                    defaultValue: "当前系统已暂停新用户注册，请联系超级管理员",
                  })}
                </span>
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
              {/* 1. 邮箱字段：在非快捷账号密码阶段常驻 */}
              {!(phase === "PASSWORD" && selectedAccount) && (
                <div>
                  <div className="flex items-center justify-between mb-1.5 min-h-[18px]">
                    <label
                      className={`block text-xs font-bold uppercase tracking-wider transition-colors duration-200 ${
                        fieldErrors.email ? "text-rose-400" : "text-gray-300"
                      }`}
                    >
                      {t("auth:email", { defaultValue: "电子邮箱" })}{" "}
                      <span className="text-rose-400">*</span>
                    </label>
                    {phase !== "EMAIL" && isEmailVerified && (
                      <button
                        type="button"
                        data-testid="auth-edit-email-btn"
                        onClick={handleReturnToEmail}
                        className="text-xs text-[#5865f2] hover:underline font-medium flex items-center gap-1 transition-all animate-auth-field cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>
                          {t("auth:editEmail", { defaultValue: "修改邮箱" })}
                        </span>
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
                      placeholder={t("auth:emailPlaceholder", {
                        defaultValue: "yourname@example.com",
                      })}
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
              )}

              {/* 2. 密码阶段展开项 (Phase === PASSWORD) */}
              {phase === "PASSWORD" && (
                <div className="space-y-4 animate-auth-field">
                  <div>
                    <label
                      className={`block text-xs font-bold uppercase tracking-wider mb-1.5 ${
                        fieldErrors.password ? "text-rose-400" : "text-gray-300"
                      }`}
                    >
                      {t("auth:password", { defaultValue: "密码" })}{" "}
                      <span className="text-rose-400">*</span>
                    </label>
                    <div
                      className={`relative transition-transform ${
                        shakeFields.password ? "animate-shake" : ""
                      }`}
                    >
                      <Lock
                        className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                          fieldErrors.password
                            ? "text-rose-400"
                            : "text-gray-400"
                        }`}
                      />
                      <input
                        ref={passwordInputRef}
                        type="password"
                        data-testid="auth-password-input"
                        required
                        value={password}
                        onChange={(e) => handlePasswordChange(e.target.value)}
                        placeholder={t("auth:passwordPlaceholder", {
                          defaultValue: "••••••••",
                        })}
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

                  {/* 记住登录复选框 */}
                  <label className="flex items-center space-x-2.5 pt-1 select-none cursor-pointer group">
                    <input
                      type="checkbox"
                      data-testid="auth-remember-me-checkbox"
                      checked={rememberPassword}
                      onChange={(e) => setRememberPassword(e.target.checked)}
                      className="w-4 h-4 rounded border-[#4e5058] bg-[#1e1f22] text-[#5865f2] focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#5865f2]"
                    />
                    <span className="text-xs text-discord-textMuted group-hover:text-white transition">
                      {t("auth:rememberMe", {
                        defaultValue: "30天内保持登录状态",
                      })}
                    </span>
                  </label>
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
                      {t("auth:nickname", { defaultValue: "昵称" })}{" "}
                      <span className="text-rose-400">*</span>
                    </label>
                    <div
                      className={`relative transition-transform ${
                        shakeFields.nickname ? "animate-shake" : ""
                      }`}
                    >
                      <UserIcon
                        className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                          fieldErrors.nickname
                            ? "text-rose-400"
                            : "text-gray-400"
                        }`}
                      />
                      <input
                        ref={nicknameInputRef}
                        type="text"
                        data-testid="auth-username-input"
                        required
                        value={nickname}
                        onChange={(e) => handleNicknameChange(e.target.value)}
                        placeholder={t("auth:nicknamePlaceholder", {
                          defaultValue: "请输入您的昵称 (如 Nick)",
                        })}
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
                      {t("auth:password", { defaultValue: "密码" })}{" "}
                      <span className="text-rose-400">*</span>
                    </label>
                    <div
                      className={`relative transition-transform ${
                        shakeFields.password ? "animate-shake" : ""
                      }`}
                    >
                      <Lock
                        className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                          fieldErrors.password
                            ? "text-rose-400"
                            : "text-gray-400"
                        }`}
                      />
                      <input
                        ref={passwordInputRef}
                        type="password"
                        data-testid="auth-password-input"
                        required
                        value={password}
                        onChange={(e) => handlePasswordChange(e.target.value)}
                        placeholder={t("auth:passwordPlaceholder", {
                          defaultValue: "••••••••",
                        })}
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
                          fieldErrors.inviteCode
                            ? "text-rose-400"
                            : "text-gray-300"
                        }`}
                      >
                        {t("auth:inviteCodeLabel", { defaultValue: "邀请码" })}{" "}
                        {registrationPolicy.requireInviteCode && (
                          <span className="text-rose-400">*</span>
                        )}
                      </label>
                      <span className="text-[11px] text-gray-400">
                        {registrationPolicy.requireInviteCode
                          ? t("auth:inviteCodeRequiredBadge", {
                              defaultValue: "必填准入",
                            })
                          : t("auth:inviteCodeOptionalBadge", {
                              defaultValue: "选填",
                            })}
                      </span>
                    </div>
                    <div
                      className={`relative transition-transform ${
                        shakeFields.inviteCode ? "animate-shake" : ""
                      }`}
                    >
                      <KeyRound
                        className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                          fieldErrors.inviteCode
                            ? "text-rose-400"
                            : "text-gray-400"
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
                            ? t("auth:inviteCodeRequiredPlaceholder", {
                                defaultValue: "请输入注册邀请码",
                              })
                            : t("auth:inviteCodeOptionalPlaceholder", {
                                defaultValue: "如有邀请码可在此填写 (选填)",
                              })
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
                  (phase === "REGISTER" &&
                    !registrationPolicy.allowRegistration)
                }
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] active:scale-[0.98] py-2.5 text-sm font-semibold text-white shadow-md shadow-[#5865f2]/25 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mt-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <div
                    key={phase}
                    className="flex items-center gap-2 animate-auth-step"
                  >
                    <span>{getButtonText()}</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                )}
              </button>

              {/* WebAuthn / Passkey 显式登录入口 */}
              {isPasskeySupported && phase !== "REGISTER" && (
                <div className="mt-3.5">
                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-white/10" />
                    <span className="flex-shrink mx-3 text-[11px] font-semibold tracking-wider text-gray-500 uppercase">
                      {t("common:or", { defaultValue: "或者" })}
                    </span>
                    <div className="flex-grow border-t border-white/10" />
                  </div>
                  <button
                    type="button"
                    data-testid="auth-passkey-login-btn"
                    disabled={isSubmitting || isPasskeyLoading}
                    onClick={handlePasskeyLogin}
                    className="w-full flex items-center justify-center gap-2.5 rounded-lg bg-[#2b2d31] hover:bg-[#35373c] border border-white/10 active:scale-[0.98] py-2.5 text-sm font-medium text-white transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                  >
                    {isPasskeyLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Fingerprint className="w-4 h-4 text-[#5865f2]" />
                    )}
                    <span>
                      {t("auth:loginWithPasskey", {
                        defaultValue: "使用通行密钥登录",
                      })}
                    </span>
                  </button>
                </div>
              )}
            </form>

            {/* 底部导航提示 */}
            {phase === "PASSWORD" && (
              <div className="mt-6 pt-4 border-t border-white/5 flex flex-col gap-3.5 animate-auth-field">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>
                    {t("auth:useOtherEmail", {
                      defaultValue: "需要使用其他账号？",
                    })}
                  </span>
                  <button
                    type="button"
                    data-testid="auth-switch-mode-btn"
                    onClick={handleReturnFromPassword}
                    className="text-[#5865f2] hover:underline font-medium transition-colors cursor-pointer"
                  >
                    {savedAccounts && savedAccounts.length > 0
                      ? t("auth:switchToOtherAccount", {
                          defaultValue: "切换其他账号",
                        })
                      : t("auth:backToEdit", { defaultValue: "返回重新输入" })}
                  </button>
                </div>
              </div>
            )}

            {phase === "REGISTER" && (
              <div className="mt-6 pt-4 border-t border-white/5 flex flex-col gap-3.5 animate-auth-field">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>
                    {t("auth:useOtherEmail", {
                      defaultValue: "需要使用其他邮箱？",
                    })}
                  </span>
                  <button
                    type="button"
                    data-testid="auth-switch-mode-btn"
                    onClick={handleReturnToEmail}
                    className="text-[#5865f2] hover:underline font-medium transition-colors cursor-pointer"
                  >
                    {t("auth:backToEdit", { defaultValue: "返回重新输入" })}
                  </button>
                </div>
              </div>
            )}

            {phase === "EMAIL" && savedAccounts && savedAccounts.length > 0 && (
              <div className="mt-6 pt-4 border-t border-white/5 flex flex-col gap-3.5 animate-auth-field">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>
                    {t("auth:alreadyHaveAccount", {
                      defaultValue: "已有已保存账号？",
                    })}
                  </span>
                  <button
                    type="button"
                    data-testid="auth-back-to-picker-btn"
                    onClick={() => setPhase("ACCOUNT_PICKER")}
                    className="text-[#5865f2] hover:underline font-medium transition-colors cursor-pointer"
                  >
                    {t("auth:backToLogin", { defaultValue: "返回账号列表" })}
                  </button>
                </div>
              </div>
            )}
          </>
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
