import React from "react";
import { SavedAccount } from "@tescord/types";
import { X, UserPlus, KeyRound, ArrowRight, Fingerprint } from "lucide-react";
import { useTranslation } from "react-i18next";

interface AccountPickerProps {
  savedAccounts: SavedAccount[];
  onSelectAccount: (account: SavedAccount) => void;
  onUseAnotherAccount: () => void;
  onRemoveAccount: (idOrEmail: string) => void;
  onPasskeyLogin?: () => void;
  isPasskeySupported?: boolean;
  isLoading?: boolean;
}

export const AccountPicker: React.FC<AccountPickerProps> = ({
  savedAccounts,
  onSelectAccount,
  onUseAnotherAccount,
  onRemoveAccount,
  onPasskeyLogin,
  isPasskeySupported = false,
  isLoading = false,
}) => {
  const { t } = useTranslation(["auth", "common"]);

  return (
    <div
      data-testid="account-picker"
      className="w-full flex flex-col items-center animate-in fade-in zoom-in-95 duration-200"
    >
      {/* 顶部标题 */}
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-white tracking-tight">
          {t("auth:accountPicker.title", { defaultValue: "欢迎回来！" })}
        </h2>
        <p className="text-sm text-discord-textMuted mt-1">
          {t("auth:accountPicker.subtitle", {
            defaultValue: "选择要登录的账号，或使用其他账号",
          })}
        </p>
      </div>

      {/* 历史账号卡片列表 */}
      <div className="w-full space-y-2.5 max-h-[320px] overflow-y-auto pr-1 custom-scrollbar">
        {savedAccounts.map((account) => {
          const displayName = account.displayName || account.username;
          const displayTag = account.discriminator
            ? `@${account.username.split("#")[0]}#${account.discriminator}`
            : `@${account.username}`;
          const hasAutoLogin =
            Boolean(account.rememberPassword) && Boolean(account.refreshToken);

          return (
            <div
              key={account.id || account.email}
              data-testid={`saved-account-card-${account.id || account.email}`}
              onClick={() => !isLoading && onSelectAccount(account)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !isLoading) {
                  e.preventDefault();
                  onSelectAccount(account);
                }
              }}
              className="group relative flex items-center justify-between w-full p-3 rounded-xl bg-[#2b2d31] hover:bg-[#35373c] border border-white/5 hover:border-white/10 transition-all duration-150 cursor-pointer shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
            >
              {/* 左侧：头像与文字信息 */}
              <div className="flex items-center space-x-3.5 min-w-0 flex-1 mr-2">
                {/* 头像 */}
                <div className="relative flex-shrink-0">
                  {account.avatarUrl ? (
                    <img
                      src={account.avatarUrl}
                      alt={displayName}
                      className="w-12 h-12 rounded-full object-cover border border-white/10"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[#5865f2] flex items-center justify-center text-lg font-bold text-white shadow-inner">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}

                  {/* 免密快捷角标 */}
                  {hasAutoLogin && (
                    <div
                      className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-[#2b2d31] flex items-center justify-center text-white"
                      title={t("auth:accountPicker.autoLoginEnabled", {
                        defaultValue: "已开启30天免密快捷登录",
                      })}
                    >
                      <KeyRound className="w-2.5 h-2.5" />
                    </div>
                  )}
                </div>

                {/* 账号文案 */}
                <div className="min-w-0 flex-1 text-left">
                  <div className="flex items-center space-x-1.5 truncate">
                    <span className="font-semibold text-white text-sm truncate">
                      {displayName}
                    </span>
                    <span className="text-xs text-discord-textMuted flex-shrink-0">
                      {displayTag}
                    </span>
                  </div>
                  <p className="text-xs text-discord-textMuted truncate mt-0.5">
                    {account.email}
                  </p>
                </div>
              </div>

              {/* 右侧：操作区 */}
              <div className="flex items-center space-x-1 flex-shrink-0">
                {/* 移除卡片按钮 */}
                <button
                  type="button"
                  data-testid={`remove-account-${account.id || account.email}`}
                  title={t("auth:accountPicker.removeAccount", {
                    defaultValue: "从这台设备移除此账号",
                  })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveAccount(account.id || account.email);
                  }}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-full hover:bg-red-500/20 text-discord-textMuted hover:text-red-400 transition"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* 进入箭头 */}
                <div className="text-discord-textMuted group-hover:text-white transition pl-1">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部：使用其他账号登录按钮 */}
      <div className="w-full mt-5 pt-3 border-t border-white/5 space-y-2">
        <button
          type="button"
          data-testid="use-other-account-btn"
          onClick={onUseAnotherAccount}
          disabled={isLoading}
          className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-md bg-[#4e5058]/30 hover:bg-[#4e5058]/50 text-white font-medium text-sm transition focus:outline-none focus:ring-2 focus:ring-[#5865f2] cursor-pointer"
        >
          <UserPlus className="w-4 h-4 text-discord-textMuted" />
          <span>
            {t("auth:accountPicker.useOtherAccount", {
              defaultValue: "使用其他账号登录",
            })}
          </span>
        </button>

        {isPasskeySupported && onPasskeyLogin && (
          <button
            type="button"
            data-testid="account-picker-passkey-btn"
            onClick={onPasskeyLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-md bg-[#2b2d31] hover:bg-[#35373c] border border-white/10 text-white font-medium text-sm transition focus:outline-none focus:ring-2 focus:ring-[#5865f2] cursor-pointer shadow-sm"
          >
            <Fingerprint className="w-4 h-4 text-[#5865f2]" />
            <span>
              {t("auth:loginWithPasskey", {
                defaultValue: "使用通行密钥登录",
              })}
            </span>
          </button>
        )}
      </div>
    </div>
  );
};
