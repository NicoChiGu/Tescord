import React, { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select } from "../ui/Select.js";

export interface InviteOptions {
  maxAge: number; // 秒，0 为永不
  maxUses: number; // 0 为无限制
  isTemporary: boolean;
}

interface InviteSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (options: InviteOptions) => Promise<void>;
  currentOptions?: InviteOptions;
}

export const InviteSettingsModal: React.FC<InviteSettingsModalProps> = ({
  isOpen,
  onClose,
  onGenerate,
  currentOptions = { maxAge: 604800, maxUses: 0, isTemporary: false },
}) => {
  const { t } = useTranslation(["modals", "common"]);

  const [maxAge, setMaxAge] = useState<number>(currentOptions.maxAge);
  const [maxUses, setMaxUses] = useState<number>(currentOptions.maxUses);
  const [isTemporary, setIsTemporary] = useState<boolean>(
    currentOptions.isTemporary,
  );
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      await onGenerate({ maxAge, maxUses, isTemporary });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        className="bg-[#313338] w-full max-w-md rounded-lg overflow-hidden shadow-2xl border border-[#1f2023] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <h3 className="text-white text-base font-bold tracking-wide">
            {t("modals:inviteSettings.title", {
              defaultValue: "伺服器邀請連結設定",
            })}
          </h3>
          <button
            onClick={onClose}
            className="text-discord-textMuted hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-5 py-3 space-y-5">
            {/* 1. 过期时间下拉 */}
            <div>
              <label className="block text-xs font-bold text-discord-textMuted uppercase tracking-wider mb-2">
                {t("modals:inviteSettings.expireTitle", {
                  defaultValue: "將連結設定為在以下時間後失效",
                })}
              </label>
              <Select
                value={String(maxAge)}
                onChange={(val) => setMaxAge(Number(val))}
                options={[
                  {
                    value: "1800",
                    label: t("modals:inviteSettings.expireOptions.30m", {
                      defaultValue: "30 分鐘",
                    }),
                  },
                  {
                    value: "3600",
                    label: t("modals:inviteSettings.expireOptions.1h", {
                      defaultValue: "1 小時",
                    }),
                  },
                  {
                    value: "21600",
                    label: t("modals:inviteSettings.expireOptions.6h", {
                      defaultValue: "6 小時",
                    }),
                  },
                  {
                    value: "43200",
                    label: t("modals:inviteSettings.expireOptions.12h", {
                      defaultValue: "12 小時",
                    }),
                  },
                  {
                    value: "86400",
                    label: t("modals:inviteSettings.expireOptions.1d", {
                      defaultValue: "1 天",
                    }),
                  },
                  {
                    value: "604800",
                    label: t("modals:inviteSettings.expireOptions.7d", {
                      defaultValue: "7 天",
                    }),
                  },
                  {
                    value: "0",
                    label: t("modals:inviteSettings.expireOptions.never", {
                      defaultValue: "永不失效",
                    }),
                  },
                ]}
              />
            </div>

            {/* 2. 最大使用次数 */}
            <div>
              <label className="block text-xs font-bold text-discord-textMuted uppercase tracking-wider mb-2">
                {t("modals:inviteSettings.maxUsesTitle", {
                  defaultValue: "最大使用次數",
                })}
              </label>
              <Select
                value={String(maxUses)}
                onChange={(val) => setMaxUses(Number(val))}
                options={[
                  {
                    value: "0",
                    label: t("modals:inviteSettings.maxUsesOptions.unlimited", {
                      defaultValue: "無限制",
                    }),
                  },
                  {
                    value: "1",
                    label: t("modals:inviteSettings.maxUsesOptions.1", {
                      defaultValue: "1 次",
                    }),
                  },
                  {
                    value: "5",
                    label: t("modals:inviteSettings.maxUsesOptions.5", {
                      defaultValue: "5 次",
                    }),
                  },
                  {
                    value: "10",
                    label: t("modals:inviteSettings.maxUsesOptions.10", {
                      defaultValue: "10 次",
                    }),
                  },
                  {
                    value: "25",
                    label: t("modals:inviteSettings.maxUsesOptions.25", {
                      defaultValue: "25 次",
                    }),
                  },
                  {
                    value: "50",
                    label: t("modals:inviteSettings.maxUsesOptions.50", {
                      defaultValue: "50 次",
                    }),
                  },
                  {
                    value: "100",
                    label: t("modals:inviteSettings.maxUsesOptions.100", {
                      defaultValue: "100 次",
                    }),
                  },
                ]}
              />
            </div>

            {/* 3. 临时会员开关 */}
            <div className="pt-2">
              <label className="flex items-start justify-between cursor-pointer group">
                <div className="min-w-0 pr-4">
                  <div className="text-sm font-semibold text-white group-hover:text-white/90">
                    {t("modals:inviteSettings.temporaryTitle", {
                      defaultValue: "允許臨時會員身分",
                    })}
                  </div>
                  <div className="text-xs text-discord-textMuted mt-0.5 leading-relaxed">
                    {t("modals:inviteSettings.temporaryDesc", {
                      defaultValue:
                        "當成員離線時自動被踢出伺服器，除非他們已取得身分組",
                    })}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isTemporary}
                  onChange={(e) => setIsTemporary(e.target.checked)}
                  className="w-5 h-5 mt-0.5 rounded border-[#1f2023] bg-[#1e1f22] text-discord-brand focus:ring-0 cursor-pointer accent-discord-brand shrink-0"
                />
              </label>
            </div>
          </div>

          {/* 底部按钮栏 */}
          <div className="bg-[#2b2d31] px-5 py-3.5 mt-5 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-white hover:underline transition"
            >
              {t("common:cancel", { defaultValue: "取消" })}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-discord-brand hover:bg-discord-brand/90 disabled:opacity-50 text-white text-sm font-semibold rounded transition flex items-center space-x-1.5 shadow"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {t("modals:inviteSettings.generateNew", {
                  defaultValue: "產生新的連結",
                })}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
