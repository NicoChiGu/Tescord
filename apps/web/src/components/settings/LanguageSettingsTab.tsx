import React from "react";
import { useTranslation } from "react-i18next";
import { Globe, Check, Sparkles } from "lucide-react";
import { SUPPORTED_LOCALES, SupportedLocale } from "@tescord/types";
import { normalizeLocale } from "../../i18n/index.js";

export const LanguageSettingsTab: React.FC = () => {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const currentLocale = normalizeLocale(i18n.language);

  const handleSelectLanguage = async (locale: SupportedLocale) => {
    if (locale !== currentLocale) {
      await i18n.changeLanguage(locale);
    }
  };

  return (
    <div className="space-y-6">
      {/* 头部标题与描述 */}
      <div className="border-b border-white/5 pb-5">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Globe className="w-6 h-6 text-[#5865f2]" />
          <span>{t("settings:language")}</span>
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          {t("settings:languageDescription")}
        </p>
      </div>

      {/* 语言选项列表 */}
      <div className="space-y-3">
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
          {t("settings:selectLanguage")}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="language-options-list">
          {SUPPORTED_LOCALES.map((option) => {
            const isSelected = currentLocale === option.code;
            return (
              <button
                key={option.code}
                type="button"
                data-testid={`lang-option-${option.code}`}
                onClick={() => handleSelectLanguage(option.code)}
                className={`relative flex items-center justify-between p-4 rounded-xl border text-left transition-all group ${
                  isSelected
                    ? "bg-[#5865f2]/10 border-[#5865f2] ring-1 ring-[#5865f2]"
                    : "bg-[#2b2d31] border-white/5 hover:bg-white/5 hover:border-white/10"
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 transition-colors ${
                      isSelected
                        ? "bg-[#5865f2] text-white shadow-md shadow-[#5865f2]/30"
                        : "bg-[#1e1f22] text-gray-300 group-hover:text-white"
                    }`}
                  >
                    {option.code === "zh-CN"
                      ? "简"
                      : option.code === "zh-TW"
                        ? "繁"
                        : option.code === "zh-HK"
                          ? "港"
                          : option.code === "ja-JP"
                            ? "あ"
                            : "EN"}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white flex items-center gap-2 truncate">
                      <span>{option.nativeName}</span>
                      {isSelected && (
                        <span className="text-[10px] font-medium bg-[#5865f2]/20 text-[#5865f2] px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                          <Sparkles className="w-2.5 h-2.5" />
                          {t("settings:currentLanguage")}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate">
                      {option.englishName}
                    </div>
                  </div>
                </div>

                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                    isSelected
                      ? "bg-[#5865f2] border-[#5865f2] text-white"
                      : "border-gray-600 bg-transparent opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
