import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Guild, AuditLogEntry, AuditLogAction } from "@tescord/types";
import {
  FileText,
  Filter,
  Shield,
  User,
  Clock,
  ArrowRight,
} from "lucide-react";
import { API_BASE, resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";

interface AuditLogTabProps {
  guild: Guild;
}

const ACTION_DESCRIPTIONS: Record<
  string,
  { i18nKey: string; label: string; color: string }
> = {
  [AuditLogAction.GUILD_UPDATE]: {
    i18nKey: "server:auditLog.actions.guildUpdate",
    label: "修改服务器基本信息",
    color: "bg-blue-500/20 text-blue-400",
  },
  [AuditLogAction.ROLE_CREATE]: {
    i18nKey: "server:auditLog.actions.roleCreate",
    label: "创建新身份组",
    color: "bg-emerald-500/20 text-emerald-400",
  },
  [AuditLogAction.ROLE_UPDATE]: {
    i18nKey: "server:auditLog.actions.roleUpdate",
    label: "修改身份组属性/权限",
    color: "bg-amber-500/20 text-amber-400",
  },
  [AuditLogAction.ROLE_DELETE]: {
    i18nKey: "server:auditLog.actions.roleDelete",
    label: "删除身份组",
    color: "bg-rose-500/20 text-rose-400",
  },
  [AuditLogAction.MEMBER_KICK]: {
    i18nKey: "server:auditLog.actions.memberKick",
    label: "踢出成员",
    color: "bg-amber-500/20 text-amber-400",
  },
  [AuditLogAction.MEMBER_BAN_ADD]: {
    i18nKey: "server:auditLog.actions.memberBanAdd",
    label: "封禁成员 (拉入黑名单)",
    color: "bg-rose-500/20 text-rose-400",
  },
  [AuditLogAction.MEMBER_BAN_REMOVE]: {
    i18nKey: "server:auditLog.actions.memberBanRemove",
    label: "解除成员封禁",
    color: "bg-emerald-500/20 text-emerald-400",
  },
  [AuditLogAction.MEMBER_ROLE_UPDATE]: {
    i18nKey: "server:auditLog.actions.memberRoleUpdate",
    label: "更新成员角色/昵称",
    color: "bg-purple-500/20 text-purple-400",
  },
  [AuditLogAction.INVITE_CREATE]: {
    i18nKey: "server:auditLog.actions.inviteCreate",
    label: "生成新邀请链接",
    color: "bg-teal-500/20 text-teal-400",
  },
  [AuditLogAction.INVITE_DELETE]: {
    i18nKey: "server:auditLog.actions.inviteDelete",
    label: "作废/删除邀请链接",
    color: "bg-gray-500/20 text-gray-300",
  },
  GUILD_OWNERSHIP_TRANSFER: {
    i18nKey: "server:auditLog.actions.guildOwnershipTransfer",
    label: "转让服务器所有权",
    color: "bg-amber-500/20 text-amber-400",
  },
};

export const AuditLogTab: React.FC<AuditLogTabProps> = ({ guild }) => {
  const { t } = useTranslation(["server", "common", "errors"]);
  const { token } = useAuthStore();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>("ALL");

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      let url = `${API_BASE}/api/guilds/${guild.id}/audit-logs?limit=50`;
      if (filterAction !== "ALL") {
        url += `&action=${encodeURIComponent(filterAction)}`;
      }
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [guild.id, filterAction]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">
            {t("server:auditLog.title")}
          </h2>
          <p className="text-xs text-gray-400">
            {t("server:auditLog.description")}
          </p>
        </div>

        {/* 过滤器 */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="bg-[#1e1f22] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#5865f2]"
          >
            <option value="ALL">{t("server:auditLog.filterAll")}</option>
            <option value={AuditLogAction.GUILD_UPDATE}>{t("server:auditLog.actions.guildUpdate")}</option>
            <option value={AuditLogAction.ROLE_CREATE}>{t("server:auditLog.actions.roleCreate")}</option>
            <option value={AuditLogAction.ROLE_UPDATE}>{t("server:auditLog.actions.roleUpdate")}</option>
            <option value={AuditLogAction.ROLE_DELETE}>{t("server:auditLog.actions.roleDelete")}</option>
            <option value={AuditLogAction.MEMBER_KICK}>{t("server:auditLog.actions.memberKick")}</option>
            <option value={AuditLogAction.MEMBER_BAN_ADD}>{t("server:auditLog.actions.memberBanAdd")}</option>
            <option value={AuditLogAction.MEMBER_BAN_REMOVE}>{t("server:auditLog.actions.memberBanRemove")}</option>
            <option value={AuditLogAction.MEMBER_ROLE_UPDATE}>
              {t("server:auditLog.actions.memberRoleUpdate")}
            </option>
            <option value={AuditLogAction.INVITE_DELETE}>{t("server:auditLog.actions.inviteDelete")}</option>
            <option value="GUILD_OWNERSHIP_TRANSFER">{t("server:auditLog.actions.guildOwnershipTransfer")}</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-xs text-gray-400 animate-pulse">
          {t("server:auditLog.loading")}
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl bg-[#2b2d31]/30 border border-white/5 p-12 text-center flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-gray-400">
            <FileText className="w-6 h-6" />
          </div>
          <div className="text-sm font-semibold text-gray-300">
            {t("server:auditLog.noLogs")}
          </div>
          <p className="text-xs text-gray-500 max-w-sm">
            {t("server:auditLog.noLogsDesc")}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-[#2b2d31]/40 border border-white/5 divide-y divide-white/5 overflow-hidden">
          {logs.map((log) => {
            const meta = ACTION_DESCRIPTIONS[log.action];
            const actionLabel = meta?.i18nKey ? t(meta.i18nKey) : meta?.label || log.action;
            const actionColor = meta?.color || "bg-gray-500/20 text-gray-300";

            return (
              <div
                key={log.id}
                className="p-4 space-y-2 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <img
                      src={
                        resolveServerUrl(log.user?.avatarUrl) ||
                        "https://api.dicebear.com/7.x/bottts/svg?seed=" +
                          log.userId
                      }
                      alt={log.user?.username || "user"}
                      className="w-7 h-7 rounded-full bg-[#1e1f22] object-cover ring-1 ring-white/10 shrink-0"
                    />
                    <span className="text-xs font-bold text-white">
                      {log.user?.username || t("server:auditLog.table.actor")}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${actionColor}`}
                    >
                      {actionLabel}
                    </span>
                    {log.targetName && (
                      <span className="text-xs text-gray-300">
                        {t("server:auditLog.table.target")}：
                        <code className="bg-[#1e1f22] px-1.5 py-0.5 rounded text-white font-semibold">
                          {log.targetName}
                        </code>
                      </span>
                    )}
                  </div>

                  <span className="text-[11px] text-gray-500 flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3" />
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>

                {/* 理由说明 */}
                {log.reason && (
                  <div className="text-xs text-gray-400 pl-9">
                    {t("server:bans.table.reason")}：{log.reason}
                  </div>
                )}

                {/* 属性 Diff 对比卡片 */}
                {log.changes && Object.keys(log.changes).length > 0 && (
                  <div className="ml-9 rounded-lg bg-[#1e1f22] p-2.5 border border-white/5 space-y-1 text-xs">
                    {Object.entries(log.changes).map(([prop, diff]) => (
                      <div
                        key={prop}
                        className="flex items-center gap-2 text-gray-300 flex-wrap"
                      >
                        <span className="font-mono text-gray-400">{prop}:</span>
                        {diff.old !== undefined && (
                          <span className="text-rose-400 line-through truncate max-w-xs">
                            {typeof diff.old === "object"
                              ? JSON.stringify(diff.old)
                              : String(diff.old)}
                          </span>
                        )}
                        <ArrowRight className="w-3 h-3 text-gray-500" />
                        <span className="text-emerald-400 truncate max-w-xs font-medium">
                          {typeof diff.new === "object"
                            ? JSON.stringify(diff.new)
                            : String(diff.new)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
