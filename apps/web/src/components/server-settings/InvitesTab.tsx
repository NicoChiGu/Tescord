import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Guild, Invite } from "@tescord/types";
import { Link, Copy, Check, Trash2, Plus, Clock, Users } from "lucide-react";
import { API_BASE, resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { dialog } from "../../stores/useDialogStore.js";
import { toast } from "../../stores/useToastStore.js";

interface InvitesTabProps {
  guild: Guild;
}

export const InvitesTab: React.FC<InvitesTabProps> = ({ guild }) => {
  const { t } = useTranslation(["server", "common", "errors"]);
  const { token } = useAuthStore();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newMaxUses, setNewMaxUses] = useState(0);
  const [newExpireHours, setNewExpireHours] = useState(24);

  const fetchInvites = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/guilds/${guild.id}/invites`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setInvites(data);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInvites();
  }, [guild.id]);

  const handleCopyLink = (code: string) => {
    const inviteLink = `${window.location.origin}/invite/${code}`;
    navigator.clipboard.writeText(inviteLink);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleDeleteInvite = async (code: string) => {
    const confirmed = await dialog.confirm({
      title: t("server:invites.revoke"),
      description:
        "确定要作废该邀请码吗？作废后使用该链接的新用户将无法加入服务器。",
      variant: "warning",
      confirmText: t("server:invites.revoke"),
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${API_BASE}/api/invites/${code}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        setInvites((prev) => prev.filter((i) => i.code !== code));
        toast.success(t("server:invites.revoke"));
      } else {
        toast.error("作废邀请码失败");
      }
    } catch (err: any) {
      toast.error(err?.message || "删除邀请码失败");
    }
  };

  const handleCreateInvite = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/guilds/${guild.id}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          maxUses: newMaxUses,
          expiresInHours: newExpireHours,
        }),
      });

      if (res.ok) {
        const created = await res.json();
        setInvites((prev) => [created, ...prev]);
        setIsCreating(false);
        handleCopyLink(created.code);
        toast.success(t("server:invites.copied"));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "创建邀请码失败");
      }
    } catch (err: any) {
      toast.error(err.message || "创建邀请码失败");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">
            {t("server:invites.title")} ({invites.length})
          </h2>
          <p className="text-xs text-gray-400">
            查看当前活跃的邀请链接、使用次数，或者随时作废指定邀请码。
          </p>
        </div>

        <button
          onClick={() => setIsCreating(!isCreating)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold shadow transition-colors self-start sm:self-center"
        >
          <Plus className="w-4 h-4" />
          <span>{t("server:invites.createBtn")}</span>
        </button>
      </div>

      {/* 创建表单面板 */}
      {isCreating && (
        <div className="rounded-xl bg-[#1e1f22] p-5 border border-white/10 space-y-4 animate-in slide-in-from-top-2">
          <h3 className="text-sm font-bold text-white">
            {t("server:invites.configTitle")}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-300 mb-1.5">
                {t("server:invites.expireLimit")}
              </label>
              <select
                value={newExpireHours}
                onChange={(e) =>
                  setNewExpireHours(parseInt(e.target.value, 10))
                }
                className="w-full bg-[#2b2d31] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#5865f2]"
              >
                <option value={1}>{t("server:invites.expire1h")}</option>
                <option value={6}>{t("server:invites.expire6h")}</option>
                <option value={12}>{t("server:invites.expire12h")}</option>
                <option value={24}>{t("server:invites.expire24h")}</option>
                <option value={168}>{t("server:invites.expire7d")}</option>
                <option value={0}>{t("server:invites.expireNever")}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-300 mb-1.5">
                {t("server:invites.maxUsesLimit")}
              </label>
              <select
                value={newMaxUses}
                onChange={(e) => setNewMaxUses(parseInt(e.target.value, 10))}
                className="w-full bg-[#2b2d31] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#5865f2]"
              >
                <option value={0}>{t("server:invites.unlimitedUses")}</option>
                <option value={1}>
                  {t("server:invites.usesCount", { count: 1 })}
                </option>
                <option value={5}>
                  {t("server:invites.usesCount", { count: 5 })}
                </option>
                <option value={10}>
                  {t("server:invites.usesCount", { count: 10 })}
                </option>
                <option value={25}>
                  {t("server:invites.usesCount", { count: 25 })}
                </option>
                <option value={50}>
                  {t("server:invites.usesCount", { count: 50 })}
                </option>
                <option value={100}>
                  {t("server:invites.usesCount", { count: 100 })}
                </option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setIsCreating(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300 hover:text-white"
            >
              {t("common:cancel")}
            </button>
            <button
              onClick={handleCreateInvite}
              className="px-4 py-1.5 rounded-lg bg-[#248046] hover:bg-[#1a6334] text-white text-xs font-semibold shadow"
            >
              立即生成并复制
            </button>
          </div>
        </div>
      )}

      {/* 邀请码列表 */}
      {isLoading ? (
        <div className="py-12 text-center text-xs text-gray-400 animate-pulse">
          正在加载邀请链接...
        </div>
      ) : invites.length === 0 ? (
        <div className="rounded-xl bg-[#2b2d31]/30 border border-white/5 p-12 text-center flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-gray-400">
            <Link className="w-6 h-6" />
          </div>
          <div className="text-sm font-semibold text-gray-300">
            暂无活跃的邀请链接
          </div>
          <p className="text-xs text-gray-500 max-w-sm">
            点击右上角按钮即可快速创建专属邀请链接并分享给伙伴。
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-[#2b2d31]/40 border border-white/5 divide-y divide-white/5 overflow-hidden">
          {invites.map((inv) => {
            const isCopied = copiedCode === inv.code;

            return (
              <div
                key={inv.code}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#1e1f22] flex items-center justify-center text-[#5865f2] shrink-0 border border-white/5">
                    <Link className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-bold text-white font-mono bg-[#1e1f22] px-2 py-0.5 rounded border border-white/5">
                        {inv.code}
                      </code>
                      <button
                        onClick={() => handleCopyLink(inv.code)}
                        className="text-xs text-[#5865f2] hover:underline flex items-center gap-1"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>{t("server:invites.copied")}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>{t("server:invites.copy")}</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-gray-400 mt-1.5 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-gray-500" />
                        {t("server:invites.table.uses")}：{inv.uses} /{" "}
                        {inv.maxUses && inv.maxUses > 0
                          ? inv.maxUses
                          : t("server:invites.permanent")}
                      </span>

                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-gray-500" />
                        {t("server:invites.table.expires")}：
                        {inv.expiresAt
                          ? new Date(inv.expiresAt).toLocaleString()
                          : t("server:invites.permanent")}
                      </span>

                      {inv.inviter && (
                        <span>
                          {t("server:invites.table.creator")}：
                          {inv.inviter.username}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleDeleteInvite(inv.code)}
                  title={t("server:invites.revoke")}
                  className="p-2 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors self-start sm:self-center"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
