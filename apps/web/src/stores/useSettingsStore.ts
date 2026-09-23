import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  AudioProcessingConfig,
  VideoSettingsConfig,
  UserSettingsDTO,
  SupportedLocale,
  VoiceTransmissionMode,
  ChannelMuteConfig,
  isChannelMuted as checkIsChannelMuted,
} from "@tescord/types";
import { API_BASE } from "../config.js";
import { useAuthStore } from "./useAuthStore.js";
import i18n from "../i18n/index.js";

interface SettingsState extends UserSettingsDTO {
  isCloudSyncing: boolean;
  lastCloudSyncedAt: number | null;
  guildPositions: string[];
  userNotes: Record<string, string>;

  // Actions
  setAudioConfig: (partial: Partial<AudioProcessingConfig>) => void;
  setVideoConfig: (partial: Partial<VideoSettingsConfig>) => void;
  setOutputVolume: (volume: number) => void;
  setUserVolume: (userId: string, volume: number) => void;
  setUserNote: (targetUserId: string, note: string) => void;
  setLanguage: (lang: SupportedLocale) => void;
  setVoiceTransmissionMode: (mode: VoiceTransmissionMode) => void;
  setChannelMute: (channelId: string, durationMs: number | null) => void;
  unmuteChannel: (channelId: string) => void;
  isChannelMuted: (channelId: string) => boolean;
  setGuildPositions: (positions: string[]) => void;
  fetchCloudSettings: () => Promise<void>;
  syncToCloud: () => Promise<void>;
}

const DEFAULT_AUDIO_CONFIG: AudioProcessingConfig = {
  noiseSuppression: true,
  noiseSuppressionMode: "rnnoise",
  echoCancellation: true,
  autoGainControl: true,
  manualGain: 100,
  agcGainRange: 18,
  highFidelityMusic: false,
  inputMode: "VAD",
  pushToTalk: false,
  pushToTalkKey: "Space",
  pushToTalkReleaseDelay: 200,
  vadSensitivity: 25,
  audioBitrate: 64000,
  inputDeviceId: undefined,
  outputDeviceId: undefined,
};

const DEFAULT_VIDEO_CONFIG: VideoSettingsConfig = {
  cameraDeviceId: undefined,
  mirrorLocalPreview: true,
  preferredVideoCodec: "h264",
  customBitrate: undefined,
  enableBackupCodec: true,
};

let syncTimer: any = null;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      audio: DEFAULT_AUDIO_CONFIG,
      video: DEFAULT_VIDEO_CONFIG,
      outputVolume: 100,
      userVolumes: {},
      language: (i18n.language as SupportedLocale) || "zh-CN",
      voiceTransmissionMode: "sfu",
      mutedChannels: {},
      guildPositions: [],
      userNotes: {},
      isCloudSyncing: false,
      lastCloudSyncedAt: null,

      setAudioConfig: (partial) => {
        set((state) => ({
          audio: { ...state.audio, ...partial },
        }));
        // 同步桌面端全局 PTT 热键
        if (partial.pushToTalkKey && window.electronAPI?.setPTTKeybind) {
          window.electronAPI.setPTTKeybind(partial.pushToTalkKey);
        }
        get().syncToCloud();
      },

      setVideoConfig: (partial) => {
        set((state) => ({
          video: { ...state.video, ...partial },
        }));
        get().syncToCloud();
      },

      setOutputVolume: (volume) => {
        const clamped = Math.max(0, Math.min(200, volume));
        set({ outputVolume: clamped });
        get().syncToCloud();
      },

      setUserVolume: (userId, volume) => {
        const clamped = Math.max(0, Math.min(200, volume));
        set((state) => ({
          userVolumes: {
            ...state.userVolumes,
            [userId]: clamped,
          },
        }));
        get().syncToCloud();
      },

      setUserNote: (targetUserId, note) => {
        const trimmed = note.trim();
        set((state) => {
          const updated = { ...state.userNotes };
          if (trimmed) {
            updated[targetUserId] = trimmed;
          } else {
            delete updated[targetUserId];
          }
          return { userNotes: updated };
        });
        get().syncToCloud();
      },

      setLanguage: (lang) => {
        set({ language: lang });
        i18n.changeLanguage(lang);
        if (typeof window !== "undefined") {
          localStorage.setItem("tescord_locale", lang);
        }
        // 语言设置作为关键选项立即同步云端，避免 1 秒防抖导致的即时刷新竞态
        const { getAuthHeaders, isAuthenticated } = useAuthStore.getState();
        if (isAuthenticated) {
          fetch(`${API_BASE}/api/users/@me/settings`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeaders(),
            },
            body: JSON.stringify({ language: lang }),
          }).catch(() => {});
        }
      },

      setVoiceTransmissionMode: (mode) => {
        set({ voiceTransmissionMode: mode });
        get().syncToCloud();
      },

      setChannelMute: (channelId, durationMs) => {
        const mutedUntil = durationMs ? Date.now() + durationMs : null;
        set((state) => ({
          mutedChannels: {
            ...state.mutedChannels,
            [channelId]: {
              muted: true,
              mutedUntil,
            },
          },
        }));
        get().syncToCloud();
      },

      unmuteChannel: (channelId) => {
        set((state) => {
          const updated = { ...state.mutedChannels };
          delete updated[channelId];
          return { mutedChannels: updated };
        });
        get().syncToCloud();
      },

      isChannelMuted: (channelId) => {
        const config = get().mutedChannels?.[channelId];
        return checkIsChannelMuted(config);
      },

      setGuildPositions: (positions: string[]) => {
        set({ guildPositions: positions });
        get().syncToCloud();
      },

      fetchCloudSettings: async () => {
        const { getAuthHeaders, isAuthenticated } = useAuthStore.getState();
        if (!isAuthenticated) return;

        try {
          set({ isCloudSyncing: true });
          const res = await fetch(`${API_BASE}/api/users/@me/settings`, {
            headers: {
              ...getAuthHeaders(),
            },
          });
          if (!res.ok) return;

          const cloudSettings: Partial<UserSettingsDTO> = await res.json();
          if (cloudSettings && typeof cloudSettings === "object") {
            set((state) => {
              const currentInput = state.audio.inputDeviceId;
              const currentOutput = state.audio.outputDeviceId;
              const currentCamera = state.video.cameraDeviceId;

              return {
                audio: {
                  ...state.audio,
                  ...(cloudSettings.audio || {}),
                  inputDeviceId: currentInput,
                  outputDeviceId: currentOutput,
                },
                video: {
                  ...state.video,
                  ...(cloudSettings.video || {}),
                  cameraDeviceId: currentCamera,
                },
                outputVolume:
                  typeof cloudSettings.outputVolume === "number"
                    ? cloudSettings.outputVolume
                    : state.outputVolume,
                userVolumes: {
                  ...state.userVolumes,
                  ...(cloudSettings.userVolumes || {}),
                },
                language: cloudSettings.language || state.language,
                voiceTransmissionMode:
                  cloudSettings.voiceTransmissionMode ||
                  state.voiceTransmissionMode,
                mutedChannels: {
                  ...state.mutedChannels,
                  ...(cloudSettings.mutedChannels || {}),
                },
                guildPositions: Array.isArray(cloudSettings.guildPositions)
                  ? cloudSettings.guildPositions
                  : state.guildPositions,
                userNotes: {
                  ...state.userNotes,
                  ...(cloudSettings.userNotes || {}),
                },
                lastCloudSyncedAt: Date.now(),
              };
            });

            // 如果云端语言和当前不同，优先尊重本地显式持久化的 tescord_locale 偏好
            const localLocale =
              typeof window !== "undefined"
                ? localStorage.getItem("tescord_locale")
                : null;
            if (
              cloudSettings.language &&
              !localLocale &&
              cloudSettings.language !== i18n.language
            ) {
              i18n.changeLanguage(cloudSettings.language);
            }
          }
        } catch (e) {
          console.warn("[SettingsStore] 拉取云端设置失败:", e);
        } finally {
          set({ isCloudSyncing: false });
        }
      },

      syncToCloud: async () => {
        // 1秒防抖，避免滑块连续滑动造成后端请求风暴
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = setTimeout(async () => {
          const { getAuthHeaders, isAuthenticated } = useAuthStore.getState();
          if (!isAuthenticated) return;

          const state = get();
          const cleanAudio = { ...state.audio };
          delete cleanAudio.inputDeviceId;
          delete cleanAudio.outputDeviceId;

          const cleanVideo = { ...state.video };
          delete cleanVideo.cameraDeviceId;

          const payload: UserSettingsDTO = {
            audio: cleanAudio,
            video: cleanVideo,
            outputVolume: state.outputVolume,
            userVolumes: state.userVolumes,
            language: state.language,
            voiceTransmissionMode: state.voiceTransmissionMode,
            mutedChannels: state.mutedChannels,
            guildPositions: state.guildPositions,
            userNotes: state.userNotes,
          };

          try {
            await fetch(`${API_BASE}/api/users/@me/settings`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                ...getAuthHeaders(),
              },
              body: JSON.stringify(payload),
            });
            set({ lastCloudSyncedAt: Date.now() });
          } catch (e) {
            console.warn("[SettingsStore] 上报云端设置失败:", e);
          }
        }, 1000);
      },
    }),
    {
      name: "tescord_user_settings",
      partialize: (state) => ({
        audio: state.audio,
        video: state.video,
        outputVolume: state.outputVolume,
        userVolumes: state.userVolumes,
        language: state.language,
        voiceTransmissionMode: state.voiceTransmissionMode,
        mutedChannels: state.mutedChannels,
        guildPositions: state.guildPositions,
        userNotes: state.userNotes,
      }),
    },
  ),
);

if (typeof window !== "undefined") {
  (window as any).useSettingsStore = useSettingsStore;
}
