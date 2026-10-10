import React, { useState, useEffect, useCallback } from "react";
import {
  Keyboard,
  Mic,
  Headphones,
  Scissors,
  RotateCcw,
  XCircle,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useKeybinds,
  formatShortcutDisplay,
  normalizeShortcut,
} from "../../hooks/useKeybinds.js";
import type { KeybindAction, KeybindConfig } from "@tescord/types";

export const KeybindsSettingsTab: React.FC = () => {
  const { t } = useTranslation(["settings", "common"]);
  const { keybinds, updateKeybind, resetKeybinds } = useKeybinds();

  const [recordingAction, setRecordingAction] = useState<KeybindAction | null>(
    null,
  );
  const [toast, setToast] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);

  const showToast = useCallback((message: string, type: "error" | "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const getActionName = useCallback(
    (action: KeybindAction): string => {
      switch (action) {
        case "TOGGLE_MUTE":
          return t("settings:keybinds.toggleMute", "开关麦克风");
        case "TOGGLE_DEAFEN":
          return t("settings:keybinds.toggleDeafen", "开关拒听/输出");
        case "SCREEN_CAPTURE":
          return t("settings:keybinds.screenCapture", "屏幕截图");
      }
    },
    [t],
  );

  const getActionDesc = useCallback(
    (action: KeybindAction): string => {
      switch (action) {
        case "TOGGLE_MUTE":
          return t(
            "settings:keybinds.toggleMuteDesc",
            "快速切换麦克风静音与取消静音状态",
          );
        case "TOGGLE_DEAFEN":
          return t(
            "settings:keybinds.toggleDeafenDesc",
            "快速切换扬声器静音与恢复接收声音",
          );
        case "SCREEN_CAPTURE":
          return t(
            "settings:keybinds.screenCaptureDesc",
            "全屏暗色框选截图并复制或贴入聊天 (桌面客户端专用)",
          );
      }
    },
    [t],
  );

  const getActionIcon = (action: KeybindAction) => {
    switch (action) {
      case "TOGGLE_MUTE":
        return <Mic className="w-5 h-5 text-indigo-400" />;
      case "TOGGLE_DEAFEN":
        return <Headphones className="w-5 h-5 text-emerald-400" />;
      case "SCREEN_CAPTURE":
        return <Scissors className="w-5 h-5 text-amber-400" />;
    }
  };

  useEffect(() => {
    if (!recordingAction) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingAction(null);
        return;
      }

      // 如果仅按下修饰键本身，不作为组合终点
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Control");
      if (e.metaKey) parts.push("Meta");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");

      const keyPart = e.code ? e.code : e.key.toUpperCase();
      parts.push(keyPart);

      const shortcutString = normalizeShortcut(parts.join("+"));

      const targetAction = recordingAction;
      setRecordingAction(null);

      const res = await updateKeybind(targetAction, {
        shortcut: shortcutString,
        enabled: true,
      });

      if (res.conflict) {
        if (res.type === "INTERNAL_CONFLICT" && res.conflictingAction) {
          const confName = getActionName(res.conflictingAction);
          showToast(
            t(
              "settings:keybinds.conflictInternal",
              `快捷键冲突：该按键组合已被“${confName}”占用`,
              { action: confName },
            ),
            "error",
          );
        } else {
          showToast(
            t(
              "settings:keybinds.conflictSystem",
              "快捷键冲突：该按键已被系统或其他应用占用",
            ),
            "error",
          );
        }
      } else {
        showToast(t("common:saved", "快捷键已保存"), "success");
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [recordingAction, updateKeybind, getActionName, showToast, t]);

  const isElectron =
    typeof window !== "undefined" && Boolean(window.electronAPI);

  const displayList = keybinds.filter((k) => {
    if (k.id === "SCREEN_CAPTURE" && !isElectron) return false;
    return true;
  });

  return (
    <div
      data-testid="keybinds-settings-tab"
      className="p-6 max-w-4xl space-y-6 text-gray-200"
    >
      {/* 头部标题与描述 */}
      <div className="border-b border-white/10 pb-4">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          <Keyboard className="w-5 h-5 text-indigo-400" />
          <span>{t("settings:keybinds.title", "快捷键设置")}</span>
        </h3>
        <p className="text-xs text-gray-400 mt-1">
          {t(
            "settings:keybinds.description",
            "自定义 Tescord 常用操作的快捷键绑定。在桌面客户端支持系统全局热键。",
          )}
        </p>
      </div>

      {/* 快捷键列表 */}
      <div className="space-y-3">
        {displayList.map((item) => {
          const isRecording = recordingAction === item.id;
          return (
            <div
              key={item.id}
              data-testid={`keybind-row-${item.id}`}
              className="bg-[#2b2d31] border border-white/5 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors hover:border-white/10"
            >
              <div className="flex items-start gap-3.5">
                <div className="p-2.5 rounded-lg bg-[#1e1f22]/60 border border-white/5 mt-0.5">
                  {getActionIcon(item.id)}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <span>{getActionName(item.id)}</span>
                    {item.id === "SCREEN_CAPTURE" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-medium">
                        桌面客户端专属
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {getActionDesc(item.id)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 self-end sm:self-center">
                {/* 录制按键触发器 */}
                <button
                  type="button"
                  data-testid={`keybind-record-btn-${item.id}`}
                  onClick={() => setRecordingAction(item.id)}
                  className={`min-w-[120px] px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all flex items-center justify-center border ${
                    isRecording
                      ? "bg-amber-500/20 border-amber-500 text-amber-300 animate-pulse"
                      : item.shortcut
                        ? "bg-[#1e1f22] border-white/10 text-white hover:border-[#5865f2] hover:bg-[#5865f2]/10"
                        : "bg-[#1e1f22]/50 border-dashed border-white/20 text-gray-400 hover:border-white/40"
                  }`}
                >
                  {isRecording
                    ? t("settings:keybinds.recording", "请按下组合键...")
                    : item.shortcut
                      ? formatShortcutDisplay(item.shortcut)
                      : t("settings:keybinds.unassigned", "未指定")}
                </button>

                {/* 清除按钮 */}
                {item.shortcut && !isRecording && (
                  <button
                    type="button"
                    data-testid={`keybind-clear-btn-${item.id}`}
                    onClick={() =>
                      updateKeybind(item.id, { shortcut: "", enabled: false })
                    }
                    className="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                    title={t("settings:keybinds.clearBtn", "清除按键绑定")}
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部重置与辅助信息 */}
      <div className="flex items-center justify-between pt-4 border-t border-white/10">
        <button
          type="button"
          data-testid="keybinds-reset-defaults-btn"
          onClick={() => {
            resetKeybinds();
            showToast(t("common:saved", "已恢复默认快捷键"), "success");
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2b2d31] hover:bg-[#35373c] text-xs font-medium text-gray-300 hover:text-white transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{t("settings:keybinds.resetDefaults", "恢复默认按键")}</span>
        </button>
      </div>

      {/* 提示消息 Toast */}
      {toast && (
        <div
          data-testid="keybind-toast"
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-2xl border flex items-center gap-2 text-xs font-medium animate-fade-in ${
            toast.type === "error"
              ? "bg-rose-950/95 border-rose-500/40 text-rose-200"
              : "bg-emerald-950/95 border-emerald-500/40 text-emerald-200"
          }`}
        >
          {toast.type === "error" ? (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};
