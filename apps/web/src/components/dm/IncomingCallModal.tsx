import React, { useEffect, useState } from "react";
import { User } from "@tescord/types";
import { Phone, PhoneOff, ShieldCheck, Video, BellOff, Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { soundManager } from "../../services/soundManager.js";
import { useAuthStore } from "../../stores/useAuthStore.js";

interface IncomingCallModalProps {
  caller: User;
  channelId: string;
  hasVideo: boolean;
  onAccept: () => void;
  onReject: () => void;
  encryption: {
    status: "idle" | "negotiating" | "tofu" | "trusted" | "failed";
    fingerprint?: string;
  };
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  caller,
  hasVideo,
  onAccept,
  onReject,
  encryption,
}) => {
  const { t } = useTranslation(["chat", "common"]);
  const [isRingtoneMuted, setIsRingtoneMuted] = useState(false);
  const currentUserStatus = useAuthStore.getState().user?.status;

  // 振铃提示音 (统一收口至 soundManager 程序化合成管线)
  useEffect(() => {
    // 若当前为请勿打扰 (DND) 则静默振铃
    if (currentUserStatus !== "DND" && !isRingtoneMuted) {
      soundManager.startLoop("CALL_RINGING");
    }

    return () => {
      soundManager.stopLoop();
    };
  }, [currentUserStatus, isRingtoneMuted]);

  const handleToggleMuteRingtone = () => {
    setIsRingtoneMuted((prev) => {
      if (!prev) {
        soundManager.stopLoop();
      } else if (currentUserStatus !== "DND") {
        soundManager.startLoop("CALL_RINGING");
      }
      return !prev;
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        onAccept();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        onReject();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onAccept, onReject]);

  return (
    <div
      className="fixed bottom-8 right-8 z-50 animate-bounce-short select-none"
      role="dialog"
      aria-live="assertive"
      aria-label={t("chat:dm.incomingCall.ariaLabel", {
        username: caller.username,
        defaultValue: `${caller.username} 的来电`,
      })}
    >
      <div className="bg-[#2b2d31] p-5 rounded-2xl border border-discord-brand shadow-2xl flex items-center space-x-4 max-w-sm w-full">
        {/* 头像 */}
        <div className="relative">
          {caller.avatarUrl ? (
            <img
              src={caller.avatarUrl}
              alt={caller.username}
              className="w-14 h-14 rounded-full object-cover border-2 border-discord-brand"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-discord-brand flex items-center justify-center font-bold text-white text-lg border-2 border-white/20">
              {caller.username.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-discord-green flex items-center justify-center text-white">
            {hasVideo ? (
              <Video className="w-3 h-3" />
            ) : (
              <Phone className="w-3 h-3" />
            )}
          </div>
        </div>

        {/* 呼叫者信息 */}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-base truncate">
            {caller.username}
          </p>
          <p className="text-xs text-discord-textMuted flex items-center space-x-1">
            <span className="inline-block w-2 h-2 rounded-full bg-discord-green animate-ping" />
            <span>
              {hasVideo
                ? t("chat:dm.incomingCall.callingVideo", {
                    defaultValue: "正在向您发起视频呼叫...",
                  })
                : t("chat:dm.incomingCall.callingVoice", {
                    defaultValue: "正在向您发起语音呼叫...",
                  })}
            </span>
          </p>
          <p
            className={`mt-1 flex items-center gap-1 text-[10px] ${
              encryption.status === "failed"
                ? "text-red-300"
                : encryption.status === "negotiating"
                  ? "text-amber-300"
                  : "text-discord-green"
            }`}
            title={
              encryption.fingerprint
                ? t("chat:dm.incomingCall.deviceFingerprint", {
                    fingerprint: encryption.fingerprint,
                    defaultValue: `设备指纹：${encryption.fingerprint}`,
                  })
                : undefined
            }
          >
            <ShieldCheck className="h-3 w-3" />
            {encryption.status === "trusted"
              ? t("chat:dm.incomingCall.e2eeTrusted", {
                  defaultValue: "已验证设备 · E2EE",
                })
              : encryption.status === "tofu"
                ? t("chat:dm.incomingCall.e2eeTofu", {
                    defaultValue: "首次信任设备 · E2EE",
                  })
                : encryption.status === "failed"
                  ? t("chat:dm.incomingCall.e2eeFailed", {
                      defaultValue: "设备验证失败",
                    })
                  : t("chat:dm.incomingCall.e2eeNegotiating", {
                      defaultValue: "正在验证设备密钥",
                    })}
          </p>
        </div>

        {/* 交互按钮 */}
        <div className="flex items-center space-x-2">
          {/* 静音振铃 */}
          <button
            onClick={handleToggleMuteRingtone}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition ${
              isRingtoneMuted
                ? "bg-amber-500/20 text-amber-300"
                : "bg-white/10 hover:bg-white/20 text-white/80"
            }`}
            title={
              isRingtoneMuted
                ? t("chat:dm.incomingCall.unmuteRingtone", { defaultValue: "恢复铃声" })
                : t("chat:dm.incomingCall.muteRingtone", { defaultValue: "静音铃声" })
            }
            data-testid="mute-ringtone-btn"
          >
            {isRingtoneMuted ? (
              <BellOff className="w-4 h-4" />
            ) : (
              <Bell className="w-4 h-4" />
            )}
          </button>

          {/* 接听 */}
          <button
            onClick={onAccept}
            className="w-11 h-11 rounded-full bg-discord-green hover:bg-[#23a55a] flex items-center justify-center text-white shadow-lg transition transform hover:scale-105"
            title={t("chat:dm.incomingCall.acceptTooltip", {
              defaultValue: "接听通话（Alt+A）",
            })}
            data-testid="accept-call-btn"
          >
            <Phone className="w-5 h-5" />
          </button>

          {/* 挂断 / 拒绝 */}
          <button
            onClick={onReject}
            className="w-11 h-11 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center text-white shadow-lg transition transform hover:scale-105"
            title={t("chat:dm.incomingCall.rejectTooltip", {
              defaultValue: "拒绝呼叫（Alt+R）",
            })}
            data-testid="reject-call-btn"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
