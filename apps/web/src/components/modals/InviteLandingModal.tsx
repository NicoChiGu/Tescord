import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { InvitePreviewDTO } from "@tescord/types";
import { API_BASE, resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { toast } from "../../stores/useToastStore.js";
import {
  Loader2,
  Users,
  AlertCircle,
  Check,
  X,
  ArrowRight,
  LogIn,
  UserPlus,
} from "lucide-react";

interface InviteLandingModalProps {
  code: string;
  onClose: () => void;
  onJoinedServer: (guildId: string) => void;
  onRequireAuth?: (initialMode?: "login" | "register") => void;
}

export const InviteLandingModal: React.FC<InviteLandingModalProps> = ({
  code,
  onClose,
  onJoinedServer,
  onRequireAuth,
}) => {
  const { t } = useTranslation(["chat", "modals", "common", "auth"]);
  const { isAuthenticated, getAuthHeaders } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InvitePreviewDTO | null>(null);
  const [isInvalid, setIsInvalid] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    const fetchInvite = async () => {
      try {
        setLoading(true);
        setIsInvalid(false);
        setErrorMessage(null);
        const res = await fetch(`${API_BASE}/api/invites/${code}`, {
          headers: {
            ...getAuthHeaders(),
          },
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          if (!isCancelled) {
            setIsInvalid(true);
            setErrorMessage(
              errData.error ||
                t("chat:invite.invalidTitle", { defaultValue: "邀请已失效" }),
            );
          }
          return;
        }
        const data: InvitePreviewDTO = await res.json();
        if (!isCancelled) {
          setInvite(data);
          setIsInvalid(false);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setIsInvalid(true);
          setErrorMessage(
            err.message ||
              t("chat:invite.invalidTitle", { defaultValue: "邀请已失效" }),
          );
        }
      } finally {
        if (!isCancelled) setLoading(false);
      }
    };

    if (code) {
      fetchInvite();
    }
    return () => {
      isCancelled = true;
    };
  }, [code, isAuthenticated]);

  // 已登录用户接受邀请加入
  const handleAcceptInvite = async () => {
    if (!invite || isSubmitting) return;

    // 如果已经是成员，直接进入
    if (invite.isMember) {
      onJoinedServer(invite.guild.id);
      onClose();
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch(`${API_BASE}/api/invites/${code}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.error ||
            t("chat:invite.joinFailed", { defaultValue: "加入服务器失败" }),
        );
      }

      const result = await res.json();
      const targetGuildId =
        result.guildId || result.guild?.id || invite.guild.id;

      toast.success(
        t("chat:invite.joinSuccess", {
          name: invite.guild.name,
          defaultValue: `成功加入服务器 ${invite.guild.name}！`,
        }),
      );

      onJoinedServer(targetGuildId);
      onClose();
    } catch (err: any) {
      toast.error(
        err.message ||
          t("chat:invite.joinFailed", { defaultValue: "加入服务器失败" }),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 未登录用户引导前往登录/注册
  const handleAuthRedirect = (mode: "login" | "register") => {
    try {
      sessionStorage.setItem("tescord_pending_invite", code);
    } catch {
      // 忽略存储失败
    }
    if (onRequireAuth) {
      onRequireAuth(mode);
    }
    onClose();
  };

  return (
    <div
      data-testid="invite-landing-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="invite-landing-card"
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-[#313338] p-8 shadow-2xl border border-white/10 text-center select-none animate-in zoom-in-95 duration-150"
      >
        {/* 右上角关闭按钮 */}
        <button
          type="button"
          data-testid="close-invite-landing-btn"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          title={t("common:close", "关闭 (ESC)")}
          aria-label="关闭邀请卡片"
        >
          <X className="w-5 h-5" />
        </button>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-[#5865f2]" />
            <p className="text-sm font-medium text-gray-300">
              {t("chat:invite.resolving", {
                defaultValue: "正在解析服务器邀请...",
              })}
            </p>
          </div>
        ) : isInvalid || !invite ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">
                {t("chat:invite.invalidTitle", { defaultValue: "邀请已失效" })}
              </h3>
              <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
                {errorMessage ||
                  t("chat:invite.invalidDesc", {
                    defaultValue:
                      "此邀请链接可能已过期，或者您没有加入此服务器的权限。",
                  })}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 px-6 py-2.5 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white font-medium text-sm transition cursor-pointer"
            >
              {t("common:back", { defaultValue: "返回" })}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            {/* 服务器大图标 */}
            <div className="relative mb-4 group">
              {invite.guild.iconUrl ? (
                <img
                  src={resolveServerUrl(invite.guild.iconUrl)}
                  alt={invite.guild.name}
                  className="w-20 h-20 rounded-3xl object-cover shadow-xl border-2 border-white/10 bg-[#1e1f22]"
                />
              ) : (
                <div className="w-20 h-20 rounded-3xl bg-[#5865f2] text-white font-black text-2xl flex items-center justify-center shadow-xl border-2 border-white/10">
                  {invite.guild.name.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            {/* 邀请者信息 */}
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
              {invite.inviter
                ? t("chat:invite.invitedByUser", {
                    user: invite.inviter.username,
                    defaultValue: `${invite.inviter.username} 邀请你加入服务器`,
                  })
                : t("chat:invite.invitedPrompt", {
                    defaultValue: "你受邀加入服务器",
                  })}
            </p>

            {/* 服务器名称 */}
            <h2 className="text-2xl font-bold text-white tracking-tight mb-2 max-w-sm truncate">
              {invite.guild.name}
            </h2>

            {/* 服务器简介 (若有) */}
            {invite.guild.description && (
              <p className="text-xs text-gray-300 max-w-sm line-clamp-2 mb-4">
                {invite.guild.description}
              </p>
            )}

            {/* 成员状态信息 (在线/总成员) */}
            <div className="flex items-center gap-4 text-xs font-medium text-gray-300 bg-[#2b2d31] px-4 py-2 rounded-xl border border-white/5 mb-6">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#23a55a] inline-block shadow-sm shadow-[#23a55a]/50" />
                <span>
                  {t("chat:invite.onlineCount", {
                    count: invite.guild.approximatePresenceCount ?? 0,
                    defaultValue: `${invite.guild.approximatePresenceCount ?? 0} 在线`,
                  })}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-500 inline-block" />
                <span>
                  {t("chat:invite.memberCount", {
                    count: invite.guild.approximateMemberCount ?? 0,
                    defaultValue: `${invite.guild.approximateMemberCount ?? 0} 成员`,
                  })}
                </span>
              </span>
            </div>

            {/* 交互按钮区域 */}
            {isAuthenticated ? (
              <div className="w-full space-y-2">
                <button
                  type="button"
                  data-testid="invite-landing-accept-btn"
                  disabled={isSubmitting}
                  onClick={handleAcceptInvite}
                  className="w-full py-3 rounded-xl bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#5865f2]/25 transition disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : invite.isMember ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>
                        {t("modals:joinGuild.alreadyMember", {
                          defaultValue: "已是该服务器成员，进入服务器",
                        })}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>
                        {t("chat:invite.accept", {
                          defaultValue: "接受邀请并加入",
                        })}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="w-full space-y-2.5">
                <button
                  type="button"
                  data-testid="invite-landing-register-btn"
                  onClick={() => handleAuthRedirect("register")}
                  className="w-full py-3 rounded-xl bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#5865f2]/25 transition cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>
                    {t("auth:registerAndJoin", {
                      defaultValue: "注册账号并加入",
                    })}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="invite-landing-login-btn"
                  onClick={() => handleAuthRedirect("login")}
                  className="w-full py-2.5 rounded-xl bg-[#2b2d31] hover:bg-[#35373c] text-gray-200 font-medium text-xs flex items-center justify-center gap-2 border border-white/5 transition cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 text-gray-400" />
                  <span>
                    {t("auth:alreadyHaveAccount", {
                      defaultValue: "已有账号？直接登录",
                    })}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
