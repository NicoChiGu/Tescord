import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Guild,
  Role,
  PermissionFlags,
  ALL_PERMISSIONS,
  hasPermission,
  parseRoleIds,
} from "@tescord/types";
import {
  Shield,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { dialog } from "../../stores/useDialogStore.js";
import { toast } from "../../stores/useToastStore.js";
import { usePermissions } from "../../hooks/usePermissions.js";

interface RolesTabProps {
  guild: Guild;
  roles: Role[];
  onCreateRole: (name?: string) => Promise<Role>;
  onUpdateRole: (
    roleId: string,
    data: {
      name?: string;
      color?: string | null;
      hoist?: boolean;
      permissions?: number;
    },
  ) => Promise<void>;
  onDeleteRole: (roleId: string) => Promise<void>;
}

const PRESET_COLORS = [
  "#99aab5", // 灰色
  "#1abc9c", // 青绿
  "#2ecc71", // 绿色
  "#3498db", // 蓝色
  "#9b59b6", // 紫色
  "#e91e63", // 品红
  "#f1c40f", // 黄色
  "#e67e22", // 橙色
  "#e74c3c", // 红色
  "#5865f2", // Blurple (Discord Blue)
];

export const RolesTab: React.FC<RolesTabProps> = ({
  guild,
  roles,
  onCreateRole,
  onUpdateRole,
  onDeleteRole,
}) => {
  const { t } = useTranslation(["server", "common", "errors"]);
  const { user: currentUser } = useAuthStore();
  const sortedRoles = useMemo(() => {
    return [...roles].sort((a, b) => b.position - a.position);
  }, [roles]);

  const [selectedRoleId, setSelectedRoleId] = useState<string>(
    sortedRoles[0]?.id || "",
  );
  const selectedRole = useMemo(() => {
    return sortedRoles.find((r) => r.id === selectedRoleId) || sortedRoles[0];
  }, [sortedRoles, selectedRoleId]);

  // 表单临时编辑状态
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState<string | null>(null);
  const [formHoist, setFormHoist] = useState(false);
  const [formPermissions, setFormPermissions] = useState<number>(0);
  const [activeCategory, setActiveCategory] = useState<
    "ALL" | "GENERAL" | "MEMBERSHIP" | "TEXT" | "VOICE" | "ADVANCED"
  >("ALL");

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 同步当前选中角色至编辑表单
  React.useEffect(() => {
    if (selectedRole) {
      setFormName(selectedRole.name);
      setFormColor(selectedRole.color || null);
      setFormHoist(selectedRole.hoist);
      setFormPermissions(selectedRole.permissions);
    }
  }, [selectedRole?.id]);

  // 计算当前用户最高角色权重以进行防越权禁用判断
  const permissions = usePermissions(guild);
  const isOwner =
    permissions.isOwner ||
    guild.ownerId === currentUser?.id ||
    currentUser?.role === "SUPER_ADMIN" ||
    (currentUser as any)?.role === "ADMIN";
  const actorHighestPos = useMemo(() => {
    if (isOwner) return Infinity;
    const currentMember = guild.members?.find(
      (m) => m.userId === currentUser?.id,
    );
    if (!currentMember) return 0;
    const myRoleIds = parseRoleIds(currentMember.roleIds);
    const myRoles = roles.filter((r) => myRoleIds.includes(r.id));
    if (myRoles.length === 0) return 0;
    return Math.max(...myRoles.map((r) => r.position));
  }, [guild, currentUser, roles, isOwner]);

  const isEveryone =
    selectedRole?.isDefault || selectedRole?.name === "@everyone";
  const canEditSelectedRole =
    isOwner ||
    (isEveryone ? true : actorHighestPos > (selectedRole?.position ?? 0));
  const canDeleteSelectedRole =
    !isEveryone && (isOwner || actorHighestPos > (selectedRole?.position ?? 0));

  const hasChanges =
    selectedRole &&
    (formName.trim() !== selectedRole.name.trim() ||
      formColor !== (selectedRole.color || null) ||
      formHoist !== selectedRole.hoist ||
      formPermissions !== selectedRole.permissions);

  const handleTogglePermission = (flag: PermissionFlags) => {
    if (!canEditSelectedRole) return;
    setFormPermissions((prev) => {
      if ((prev & flag) === flag) {
        return prev & ~flag;
      } else {
        return prev | flag;
      }
    });
  };

  const handleSave = async () => {
    if (!selectedRole) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await onUpdateRole(selectedRole.id, {
        name: isEveryone ? undefined : formName.trim(),
        color: isEveryone ? undefined : formColor,
        hoist: isEveryone ? undefined : formHoist,
        permissions: formPermissions,
      });
      setSaveSuccess(true);
      toast.success(t("server:roles.saveSuccess"));
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      toast.error(err?.message || t("errors:UNKNOWN_ERROR"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateNewRole = async () => {
    try {
      const newRole = await onCreateRole(t("server:roles.createRole"));
      setSelectedRoleId(newRole.id);
      toast.success(
        t("server:roles.createSuccess", { defaultValue: "身份组创建成功" }),
      );
    } catch (err: any) {
      toast.error(err?.message || t("errors:UNKNOWN_ERROR"));
    }
  };

  const handleDelete = async () => {
    if (!selectedRole || !canDeleteSelectedRole) return;
    const confirmed = await dialog.confirm({
      title: t("server:roles.deleteConfirmTitle"),
      description: t("server:roles.deleteConfirmDesc", {
        name: selectedRole.name,
      }),
      variant: "danger",
      confirmText: t("server:roles.deleteRole"),
    });
    if (!confirmed) return;

    try {
      await onDeleteRole(selectedRole.id);
      const remaining = sortedRoles.filter((r) => r.id !== selectedRole.id);
      if (remaining.length > 0) {
        setSelectedRoleId(remaining[0].id);
      }
      toast.success(
        t("server:roles.deleteSuccess", { defaultValue: "身份组已成功删除" }),
      );
    } catch (err: any) {
      toast.error(err?.message || t("errors:UNKNOWN_ERROR"));
    }
  };

  const filteredPermissions = useMemo(() => {
    if (activeCategory === "ALL") return ALL_PERMISSIONS;
    return ALL_PERMISSIONS.filter((p) => p.category === activeCategory);
  }, [activeCategory]);

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden animate-in fade-in duration-200">
      {/* 左侧：角色列表 */}
      <div className="w-64 border-r border-white/5 bg-[#2b2d31]/50 p-4 flex flex-col justify-between shrink-0 h-full overflow-hidden">
        <div className="space-y-3 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-1 shrink-0">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              {t("server:roles.title")} ({sortedRoles.length})
            </span>
            <button
              onClick={handleCreateNewRole}
              title={t("server:roles.createRole")}
              className="p-1 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1 overflow-y-auto flex-1 min-h-0 pr-1 custom-scrollbar">
            {sortedRoles.map((r) => {
              const isCurrent = r.id === selectedRole?.id;
              const isDef = r.isDefault || r.name === "@everyone";

              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedRoleId(r.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                    isCurrent
                      ? "bg-[#5865f2] text-white shadow"
                      : "text-gray-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          r.color || (isDef ? "#99aab5" : "#5865f2"),
                      }}
                    />
                    <span className="truncate">
                      {isDef ? "@everyone" : r.name}
                    </span>
                  </div>
                  {isDef && (
                    <span className="text-[10px] bg-black/20 px-1.5 py-0.5 rounded text-gray-300 shrink-0">
                      {t("common:status.default", { defaultValue: "默认" })}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {canDeleteSelectedRole && (
          <button
            onClick={handleDelete}
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold text-rose-400 hover:text-white hover:bg-rose-600 transition-colors border border-rose-500/20"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t("server:roles.deleteRole")}</span>
          </button>
        )}
      </div>

      {/* 右侧：角色配置画布 */}
      {selectedRole ? (
        <div className="flex-1 flex flex-col overflow-hidden bg-[#313338]">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* 顶栏提示与越权防范告警 */}
            {!canEditSelectedRole && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{t("server:roles.hierarchyWarning")}</span>
              </div>
            )}

            {/* 基础显示属性 */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
                {t("server:roles.title")}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-300 mb-1.5">
                    {t("server:roles.roleName")}
                  </label>
                  <input
                    type="text"
                    value={formName}
                    disabled={isEveryone || !canEditSelectedRole}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={t("server:roles.roleName")}
                    className="w-full bg-[#1e1f22] border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#5865f2] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  />
                  {isEveryone && (
                    <span className="text-[11px] text-gray-400 mt-1 block">
                      @everyone {t("server:roles.defaultRole")}
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-300 mb-1.5">
                    {t("server:roles.hoistLabel", {
                      defaultValue: "成员列表分栏显示 (Hoist)",
                    })}
                  </label>
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#1e1f22] border border-white/5">
                    <span className="text-xs text-gray-300">
                      {t("server:roles.hoistDesc", {
                        defaultValue: "在右侧成员列表中按此身份组单独分组",
                      })}
                    </span>
                    <button
                      type="button"
                      disabled={isEveryone || !canEditSelectedRole}
                      onClick={() => setFormHoist(!formHoist)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                        formHoist ? "bg-[#248046]" : "bg-gray-600"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          formHoist ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* 颜色配置 */}
              {!isEveryone && (
                <div>
                  <label className="block text-xs font-bold text-gray-300 mb-2">
                    {t("server:roles.roleColor")}
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={!canEditSelectedRole}
                        onClick={() => setFormColor(c)}
                        className={`w-7 h-7 rounded-full transition-transform hover:scale-110 flex items-center justify-center ${
                          formColor === c ? "ring-2 ring-white scale-110" : ""
                        }`}
                        style={{ backgroundColor: c }}
                      >
                        {formColor === c && (
                          <Check className="w-3.5 h-3.5 text-white drop-shadow" />
                        )}
                      </button>
                    ))}
                    <div className="flex items-center gap-2 ml-2">
                      <input
                        type="color"
                        value={formColor || "#5865f2"}
                        disabled={!canEditSelectedRole}
                        onChange={(e) => setFormColor(e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                      />
                      <button
                        type="button"
                        disabled={!canEditSelectedRole}
                        onClick={() => setFormColor(null)}
                        className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-[#1e1f22] border border-white/5"
                      >
                        {t("server:roles.defaultColor", {
                          defaultValue: "默认无色",
                        })}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 权限配置树 */}
            <div className="space-y-4 pt-4 border-t border-white/10">
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
                    {t("server:roles.permissions")}
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {t("server:roles.permissionsDesc", {
                      defaultValue:
                        "为拥有此身份组的成员开启或关闭相应的服务器能力。",
                    })}
                  </p>
                </div>

                {/* 分类过滤器 (独立一行自适应换行，避免挤压) */}
                <div className="flex flex-wrap items-center gap-1.5 bg-[#1e1f22] p-1.5 rounded-lg border border-white/5 text-[11px]">
                  {(
                    [
                      [
                        "ALL",
                        t("server:roles.categories.all", {
                          defaultValue: "全部",
                        }),
                      ],
                      [
                        "GENERAL",
                        t("server:roles.categories.general", {
                          defaultValue: "常规管理",
                        }),
                      ],
                      [
                        "MEMBERSHIP",
                        t("server:roles.categories.membership", {
                          defaultValue: "成员与邀请",
                        }),
                      ],
                      [
                        "TEXT",
                        t("server:roles.categories.text", {
                          defaultValue: "文字互动",
                        }),
                      ],
                      [
                        "VOICE",
                        t("server:roles.categories.voice", {
                          defaultValue: "语音频道",
                        }),
                      ],
                      [
                        "ADVANCED",
                        t("server:roles.categories.advanced", {
                          defaultValue: "高级特权",
                        }),
                      ],
                    ] as const
                  ).map(([catKey, catLabel]) => (
                    <button
                      key={catKey}
                      type="button"
                      onClick={() => setActiveCategory(catKey)}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors shrink-0 whitespace-nowrap cursor-pointer ${
                        activeCategory === catKey
                          ? "bg-[#5865f2] text-white shadow-sm"
                          : "text-gray-400 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      {catLabel}
                    </button>
                  ))}
                </div>
              </div>

              {/* 权限条目开关列表 */}
              <div className="space-y-2">
                {filteredPermissions.map((p) => {
                  const isChecked = hasPermission(formPermissions, p.flag);
                  const isAdv = p.category === "ADVANCED";

                  return (
                    <div
                      key={p.flag}
                      className={`flex items-center justify-between p-3.5 rounded-xl border transition-colors ${
                        isAdv
                          ? "bg-rose-500/5 border-rose-500/20 hover:border-rose-500/40"
                          : "bg-[#1e1f22] border-white/5 hover:border-white/10"
                      }`}
                    >
                      <div className="pr-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-semibold ${
                              isAdv ? "text-rose-400" : "text-white"
                            }`}
                          >
                            {p.name}
                          </span>
                          {isAdv && (
                            <span className="text-[10px] bg-rose-500/20 text-rose-400 font-bold px-1.5 py-0.5 rounded">
                              {t("server:roles.dangerousBadge", {
                                defaultValue: "高危",
                              })}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {p.description}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={!canEditSelectedRole}
                        onClick={() => handleTogglePermission(p.flag)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                          isChecked ? "bg-[#248046]" : "bg-gray-600"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            isChecked ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 危险操作区：删除身份组 */}
            {!isEveryone && canDeleteSelectedRole && (
              <div className="pt-6 border-t border-rose-500/20">
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-rose-400">
                      {t("server:roles.deleteRole")}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {t("server:roles.deleteConfirmDesc", {
                        name: selectedRole.name,
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer self-start sm:self-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t("server:roles.deleteRole")}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 底部保存浮动栏 */}
          <div className="border-t border-white/10 bg-[#2b2d31] px-6 py-3 flex items-center justify-between">
            <div className="text-xs text-gray-400">
              {saveSuccess && (
                <span className="text-emerald-400 flex items-center gap-1 font-medium">
                  <Check className="w-4 h-4" /> {t("server:roles.saveSuccess")}
                </span>
              )}
              {!saveSuccess && hasChanges && (
                <span className="text-amber-400 font-medium">
                  {t("server:overview.unsavedChanges")}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {hasChanges && (
                <button
                  type="button"
                  onClick={() => {
                    setFormName(selectedRole.name);
                    setFormColor(selectedRole.color || null);
                    setFormHoist(selectedRole.hoist);
                    setFormPermissions(selectedRole.permissions);
                  }}
                  className="text-xs text-gray-300 hover:underline px-2 py-1"
                >
                  {t("server:overview.reset")}
                </button>
              )}
              <button
                type="button"
                disabled={!hasChanges || isSaving || !canEditSelectedRole}
                onClick={handleSave}
                className="px-5 py-2 rounded-lg bg-[#248046] hover:bg-[#1a6334] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow transition-all"
              >
                {isSaving
                  ? t("server:overview.saving")
                  : t("server:overview.saveChanges")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          {t("server:roles.searchRoles")}
        </div>
      )}
    </div>
  );
};
