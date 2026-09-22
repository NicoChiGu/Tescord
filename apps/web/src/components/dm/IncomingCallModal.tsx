import React, { useEffect } from "react";
import { User } from "@tescord/types";
import { Phone, PhoneOff, ShieldCheck, Video } from "lucide-react";

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
  // 振铃提示音 (Web Audio API 合成和弦振铃)
  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    let timer: any = null;

    try {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();

        const playChime = () => {
          if (!audioCtx || audioCtx.state === "closed") return;
          try {
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc1.type = "sine";
            osc1.frequency.setValueAtTime(440, audioCtx.currentTime); // A4
            osc2.type = "sine";
            osc2.frequency.setValueAtTime(880, audioCtx.currentTime); // A5

            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(
              0.001,
              audioCtx.currentTime + 0.8,
            );

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(audioCtx.destination);

            osc1.start();
            osc2.start();
            osc1.stop(audioCtx.currentTime + 0.8);
            osc2.stop(audioCtx.currentTime + 0.8);
          } catch {
            // ignore
          }
        };

        playChime();
        timer = setInterval(playChime, 2500);
      }
    } catch {
      // ignore
    }

    return () => {
      if (timer) clearInterval(timer);
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
    };
  }, []);

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
    <div className="fixed bottom-8 right-8 z-50 animate-bounce-short select-none" role="dialog" aria-live="assertive" aria-label={`${caller.username} 的来电`}>
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
            <span>正在向您发起{hasVideo ? "视频" : "语音"}呼叫...</span>
          </p>
          <p
            className={`mt-1 flex items-center gap-1 text-[10px] ${
              encryption.status === "failed" ? "text-red-300" :
                encryption.status === "negotiating" ? "text-amber-300" : "text-discord-green"
            }`}
            title={encryption.fingerprint ? `设备指纹：${encryption.fingerprint}` : undefined}
          >
            <ShieldCheck className="h-3 w-3" />
            {encryption.status === "trusted" ? "已验证设备 · E2EE" :
              encryption.status === "tofu" ? "首次信任设备 · E2EE" :
                encryption.status === "failed" ? "设备验证失败" : "正在验证设备密钥"}
          </p>
        </div>

        {/* 交互按钮 */}
        <div className="flex items-center space-x-2">
          {/* 接听 */}
          <button
            onClick={onAccept}
            className="w-11 h-11 rounded-full bg-discord-green hover:bg-[#23a55a] flex items-center justify-center text-white shadow-lg transition transform hover:scale-105"
            title="接听通话（Alt+A）"
            data-testid="accept-call-btn"
          >
            <Phone className="w-5 h-5" />
          </button>

          {/* 挂断 / 拒绝 */}
          <button
            onClick={onReject}
            className="w-11 h-11 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center text-white shadow-lg transition transform hover:scale-105"
            title="拒绝呼叫（Alt+R）"
            data-testid="reject-call-btn"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
