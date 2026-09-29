import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Fingerprint,
  Plus,
  Trash2,
  Edit2,
  ShieldCheck,
  AlertCircle,
  KeyRound,
  Laptop,
  Smartphone,
  Shield,
  Loader2,
} from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { PasskeyInfo } from "@tescord/types";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { dialog } from "../../stores/useDialogStore.js";
import { toast } from "../../stores/useToastStore.js";
import { API_BASE } from "../../config.js";
import {
  isWebAuthnSupported,
  getDefaultDeviceName,
} from "../../utils/webauthn.js";

export const SecuritySettingsTab: React.FC = () => {
  const { t } = useTranslation(["settings", "common", "auth"]);
  const { getAuthHeaders } = useAuthStore();

  const isSupported = isWebAuthnSupported();
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchPasskeys = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/webauthn/credentials`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setPasskeys(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      toast.error(
        err.message ||
          t("settings:passkeyLoadFailed", { defaultValue: "加载通行密钥失败" }),
      );
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders, isSupported, t]);

  useEffect(() => {
    void fetchPasskeys();
  }, [fetchPasskeys]);

  const handleAddPasskey = async () => {
    if (!isSupported) {
      toast.error(
        t("settings:passkeyNotSupported", {
          defaultValue: "当前环境不支持通行密钥",
        }),
      );
      return;
    }

    const defaultName = getDefaultDeviceName();
    const chosenName = await dialog.prompt({
      title: t("settings:addPasskeyModalTitle", {
        defaultValue: "添加通行密钥 (Passkey)",
      }),
      description: t("settings:addPasskeyModalDesc", {
        defaultValue: "请输入此设备的自定义别名，方便后续管理与安全识别。",
      }),
      placeholder: defaultName,
      defaultValue: defaultName,
      confirmText: t("common:confirm", { defaultValue: "继续并验证" }),
      cancelText: t("common:cancel", { defaultValue: "取消" }),
    });

    if (chosenName === null) return;
    const deviceName = chosenName.trim() || defaultName;

    setIsRegistering(true);
    try {
      // 1. 获取注册挑战选项
      const optRes = await fetch(
        `${API_BASE}/api/auth/webauthn/register-options`,
        {
          headers: getAuthHeaders(),
        },
      );
      const optData = await optRes.json();
      if (!optRes.ok) {
        throw new Error(
          optData.error ||
            t("settings:passkeyOptFailed", {
              defaultValue: "获取注册配置失败",
            }),
        );
      }

      const { options, challengeId } = optData;

      // 2. 拉起浏览器/OS 原生验证凭据生成器
      const regResponse = await startRegistration({ optionsJSON: options });

      // 3. 将凭证发送至后端验签并保存
      const verifyRes = await fetch(
        `${API_BASE}/api/auth/webauthn/register-verify`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            challengeId,
            response: regResponse,
            name: deviceName,
          }),
        },
      );

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(
          verifyData.error ||
            t("settings:passkeyVerifyFailed", {
              defaultValue: "注册通行密钥失败",
            }),
        );
      }

      toast.success(
        t("settings:passkeyAddSuccess", { defaultValue: "通行密钥添加成功" }),
      );
      await fetchPasskeys();
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        toast.info(
          t("settings:passkeyRegistrationCancelled", {
            defaultValue: "已取消添加通行密钥",
          }),
        );
      } else {
        toast.error(
          err.message ||
            t("settings:passkeyAddFailed", {
              defaultValue: "添加通行密钥失败",
            }),
        );
      }
    } finally {
      setIsRegistering(false);
    }
  };

  const handleRename = async (passkey: PasskeyInfo) => {
    const newName = await dialog.prompt({
      title: t("settings:renamePasskeyTitle", {
        defaultValue: "重命名通行密钥",
      }),
      description: t("settings:renamePasskeyDesc", {
        defaultValue: "修改当前通行密钥的显示别名：",
      }),
      placeholder: passkey.name,
      defaultValue: passkey.name,
      confirmText: t("common:save", { defaultValue: "保存" }),
      cancelText: t("common:cancel", { defaultValue: "取消" }),
      required: true,
    });

    if (!newName || newName.trim() === passkey.name) return;

    setEditingId(passkey.id);
    try {
      const res = await fetch(
        `${API_BASE}/api/auth/webauthn/credentials/${passkey.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ name: newName.trim() }),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error ||
            t("settings:renamePasskeyFailed", { defaultValue: "重命名失败" }),
        );
      }

      toast.success(
        t("settings:renamePasskeySuccess", {
          defaultValue: "已更新通行密钥名称",
        }),
      );
      setPasskeys((prev) =>
        prev.map((item) =>
          item.id === passkey.id ? { ...item, name: data.name } : item,
        ),
      );
    } catch (err: any) {
      toast.error(
        err.message ||
          t("settings:renamePasskeyFailed", { defaultValue: "重命名失败" }),
      );
    } finally {
      setEditingId(null);
    }
  };

  const handleDelete = async (passkey: PasskeyInfo) => {
    const password = await dialog.prompt({
      title: t("settings:deletePasskeyTitle", { defaultValue: "解绑通行密钥" }),
      description: t("settings:deletePasskeyDesc", {
        defaultValue: `确定要移除「${passkey.name}」吗？移除后将无法使用该设备生物识别登录。为保证安全，请输入当前账号密码：`,
      }),
      placeholder: t("auth:password", { defaultValue: "当前账号密码" }),
      confirmText: t("common:delete", { defaultValue: "确认解除绑定" }),
      cancelText: t("common:cancel", { defaultValue: "取消" }),
      required: true,
    });

    if (!password) return;

    setEditingId(passkey.id);
    try {
      const res = await fetch(
        `${API_BASE}/api/auth/webauthn/credentials/${passkey.id}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ password }),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error ||
            t("settings:deletePasskeyFailed", { defaultValue: "解绑失败" }),
        );
      }

      toast.success(
        t("settings:deletePasskeySuccess", {
          defaultValue: "通行密钥已成功解绑",
        }),
      );
      setPasskeys((prev) => prev.filter((item) => item.id !== passkey.id));
    } catch (err: any) {
      toast.error(
        err.message ||
          t("settings:deletePasskeyFailed", { defaultValue: "解绑失败" }),
      );
    } finally {
      setEditingId(null);
    }
  };

  const getDeviceIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (
      lower.includes("phone") ||
      lower.includes("ios") ||
      lower.includes("android")
    ) {
      return <Smartphone className="w-5 h-5 text-[#5865f2]" />;
    }
    if (
      lower.includes("mac") ||
      lower.includes("windows") ||
      lower.includes("pc")
    ) {
      return <Laptop className="w-5 h-5 text-[#5865f2]" />;
    }
    return <KeyRound className="w-5 h-5 text-[#5865f2]" />;
  };

  return (
    <div
      className="space-y-6 max-w-4xl animate-fade-in"
      data-testid="security-settings-tab"
    >
      {/* 顶部标语与说明 */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Shield className="w-6 h-6 text-[#5865f2]" />
          <span>
            {t("settings:securityAndPasskeysTitle", {
              defaultValue: "账号安全与通行密钥",
            })}
          </span>
        </h2>
        <p className="text-xs text-discord-textMuted mt-1">
          {t("settings:securityAndPasskeysDesc", {
            defaultValue:
              "管理绑定的生物识别与硬件安全密钥，使用 Touch ID、Windows Hello 或 YubiKey 免密极速登录。",
          })}
        </p>
      </div>

      {/* 不受支持环境降级提示 */}
      {!isSupported && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-4 flex items-start gap-3 text-amber-200">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-semibold">
              {t("settings:passkeyUnsupportedTitle", {
                defaultValue: "当前环境不支持通行密钥",
              })}
            </p>
            <p className="text-amber-200/80 leading-relaxed">
              {t("settings:passkeyUnsupportedNotice", {
                defaultValue:
                  "检测到当前运行环境未开启或不支持 WebAuthn 硬件凭据标准。如需体验指纹/面容免密登录，请使用现代浏览器（Chrome、Edge、Safari、Firefox）访问 Tescord Web 客户端。",
              })}
            </p>
          </div>
        </div>
      )}

      {/* 通行密钥管理卡片 */}
      <div className="rounded-2xl bg-[#2b2d31] p-5 sm:p-6 border border-white/5 space-y-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#5865f2]/15 border border-[#5865f2]/30 flex items-center justify-center text-[#5865f2]">
              <Fingerprint className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>
                  {t("settings:passkeysSectionTitle", {
                    defaultValue: "已绑定的通行密钥 (Passkeys)",
                  })}
                </span>
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-white/10 text-gray-300">
                  {passkeys.length}
                </span>
              </h3>
              <p className="text-xs text-discord-textMuted mt-0.5">
                {t("settings:passkeysSectionDesc", {
                  defaultValue:
                    "绑定的凭证将存储在您受信任设备的硬件安全区（Secure Enclave / TPM）中。",
                })}
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="add-passkey-btn"
            disabled={!isSupported || isRegistering}
            onClick={handleAddPasskey}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] active:scale-[0.98] text-white text-xs font-semibold shadow-md shadow-[#5865f2]/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {isRegistering ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            <span>
              {t("settings:addPasskeyBtn", { defaultValue: "添加通行密钥" })}
            </span>
          </button>
        </div>

        {/* 密钥列表展示 */}
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center text-gray-400 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-[#5865f2]" />
            <span className="text-xs">
              {t("common:loading", { defaultValue: "加载中..." })}
            </span>
          </div>
        ) : passkeys.length === 0 ? (
          <div className="py-10 text-center flex flex-col items-center justify-center text-gray-400 space-y-2">
            <Fingerprint className="w-10 h-10 text-gray-500/60" />
            <p className="text-xs font-medium text-gray-300">
              {t("settings:noPasskeysYet", {
                defaultValue: "暂无绑定的通行密钥",
              })}
            </p>
            <p className="text-[11px] text-gray-500 max-w-sm">
              {t("settings:noPasskeysHint", {
                defaultValue:
                  "点击上方「添加通行密钥」按钮，即可为当前电脑、手机或硬件安全密钥配置免密登录。",
              })}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {passkeys.map((pk) => {
              const isBusy = editingId === pk.id;
              const formattedCreated = new Date(
                pk.createdAt,
              ).toLocaleDateString();
              const formattedUsed = pk.lastUsedAt
                ? new Date(pk.lastUsedAt).toLocaleDateString()
                : t("settings:neverUsed", { defaultValue: "从未使用" });

              return (
                <div
                  key={pk.id}
                  data-testid={`passkey-item-${pk.id}`}
                  className="flex items-center justify-between p-3.5 rounded-xl bg-[#1e1f22]/70 hover:bg-[#1e1f22] border border-white/5 hover:border-white/10 transition-all"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                      {getDeviceIcon(pk.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">
                          {pk.name}
                        </span>
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-0.5">
                        <span>
                          {t("settings:passkeyCreatedAt", {
                            defaultValue: "绑定于",
                          })}
                          : {formattedCreated}
                        </span>
                        <span>•</span>
                        <span>
                          {t("settings:passkeyLastUsed", {
                            defaultValue: "最近使用",
                          })}
                          : {formattedUsed}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    <button
                      type="button"
                      data-testid={`rename-passkey-${pk.id}`}
                      disabled={isBusy}
                      onClick={() => handleRename(pk)}
                      title={t("common:edit", { defaultValue: "重命名" })}
                      className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid={`delete-passkey-${pk.id}`}
                      disabled={isBusy}
                      onClick={() => handleDelete(pk)}
                      title={t("common:delete", { defaultValue: "解除绑定" })}
                      className="p-2 rounded-lg hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
