import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  AudioProcessingConfig,
  VideoSettingsConfig,
  UserSettingsDTO,
  SupportedLocale,
  VoiceTransmissionMode,
} from "@tescord/types";
import { API_BASE } from "../config.js";
import { useAuthStore } from "./useAuthStore.js";
import i18n from "../i18n/index.js";

interface SettingsState extends UserSettingsDTO {
  isCloudSyncing: boolean;
  lastCloudSyncedAt: number | null;

  // Actions
  setAudioConfig: (partial: Partial<AudioProcessingConfig>) => void;
  setVideoConfig: (partial: Partial<VideoSettingsConfig>) => void;
  setOutputVolume: (volume: number) => void;
  setUserVolume: (userId: string, volume: number) => void;
  setLanguage: (lang: SupportedLocale) => void;
  setVoiceTransmissionMode: (mode: VoiceTransmissionMode) => void;
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

      setLanguage: (lang) => {
        set({ language: lang });
        i18n.changeLanguage(lang);
        get().syncToCloud();
      },

      setVoiceTransmissionMode: (mode) => {
        set({ voiceTransmissionMode: mode });
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
            set((state) => ({
              audio: { ...state.audio, ...(cloudSettings.audio || {}) },
              video: { ...state.video, ...(cloudSettings.video || {}) },
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
                cloudSettings.voiceTransmissionMode || state.voiceTransmissionMode,
              lastCloudSyncedAt: Date.now(),
            }));

            // 如果云端语言和当前不同，同步切换
            if (cloudSettings.language && cloudSettings.language !== i18n.language) {
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
          const payload: UserSettingsDTO = {
            audio: state.audio,
            video: state.video,
            outputVolume: state.outputVolume,
            userVolumes: state.userVolumes,
            language: state.language,
            voiceTransmissionMode: state.voiceTransmissionMode,
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
      }),
    },
  ),
);
