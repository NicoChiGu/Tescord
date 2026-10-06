import { create } from "zustand";

export interface AudioTrackInfo {
  id: string;
  url: string;
  fileName: string;
  fileSize?: number;
  duration?: number;
}

export interface AudioPlayerState {
  // 当前播放轨道信息
  activeTrack: AudioTrackInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number; // 0.0 - 1.0
  isMuted: boolean;
  playbackRate: number; // 1.0, 1.25, 1.5, 2.0
  isBuffering: boolean;
  error: string | null;

  // 小窗展开状态
  isExpanded: boolean;

  // 动作
  playTrack: (track: AudioTrackInfo) => void;
  pauseTrack: () => void;
  togglePlay: (track: AudioTrackInfo) => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  setIsExpanded: (expanded: boolean) => void;
  close: () => void;
}

// 模块级唯一的 HTMLAudioElement 物理单例
let globalAudio: HTMLAudioElement | null = null;
let lastNonMutedVolume = 1.0;

function getOrCreateAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") {
    return null;
  }
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preload = "auto";
  }
  return globalAudio;
}

export const useAudioPlayerStore = create<AudioPlayerState>((set, get) => {
  // 初始化全局 Audio 监听事件
  const audio = getOrCreateAudio();
  if (audio) {
    audio.addEventListener("timeupdate", () => {
      set({ currentTime: audio.currentTime });
    });

    audio.addEventListener("loadedmetadata", () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
      set((state) => ({
        duration: dur || state.activeTrack?.duration || 0,
        isBuffering: false,
        error: null,
      }));
    });

    audio.addEventListener("durationchange", () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (dur > 0) {
        set({ duration: dur });
      }
    });

    audio.addEventListener("waiting", () => {
      set({ isBuffering: true });
    });

    audio.addEventListener("playing", () => {
      set({ isBuffering: false, isPlaying: true });
    });

    audio.addEventListener("pause", () => {
      set({ isPlaying: false });
    });

    audio.addEventListener("ended", () => {
      set({ isPlaying: false, currentTime: 0 });
    });

    audio.addEventListener("error", () => {
      // 若当前没有有效 src，或没有活跃音轨（例如已 close 清空），不触发全局错误
      if (!audio.getAttribute("src") || !get().activeTrack) {
        return;
      }
      set({
        isPlaying: false,
        isBuffering: false,
        error: "audio_playback_error",
      });
    });
  }

  return {
    activeTrack: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1.0,
    isMuted: false,
    playbackRate: 1.0,
    isBuffering: false,
    error: null,
    isExpanded: false,

    playTrack: (track: AudioTrackInfo) => {
      const audio = getOrCreateAudio();
      if (!audio) return;

      const currentTrack = get().activeTrack;
      const isSameTrack = currentTrack?.id === track.id;

      if (isSameTrack) {
        if (audio.paused) {
          audio.play().catch((err: unknown) => {
            if (err instanceof DOMException && err.name === "AbortError") {
              return;
            }
            console.warn("[AudioPlayer] play failed:", err);
            set({ error: "audio_playback_error", isPlaying: false });
          });
        }
        return;
      }

      // 切换新音频
      audio.pause();
      audio.src = track.url;
      audio.currentTime = 0;
      audio.playbackRate = get().playbackRate;
      audio.volume = get().isMuted ? 0 : get().volume;

      set({
        activeTrack: track,
        currentTime: 0,
        duration: track.duration || 0,
        isBuffering: true,
        error: null,
      });

      audio
        .play()
        .then(() => {
          set({ isPlaying: true, isBuffering: false });
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") {
            return;
          }
          console.warn("[AudioPlayer] play failed:", err);
          set({ error: "audio_playback_error", isPlaying: false });
        });
    },

    pauseTrack: () => {
      const audio = getOrCreateAudio();
      if (audio && !audio.paused) {
        audio.pause();
      }
      set({ isPlaying: false });
    },

    togglePlay: (track: AudioTrackInfo) => {
      const { activeTrack, isPlaying } = get();
      if (activeTrack?.id === track.id) {
        if (isPlaying) {
          get().pauseTrack();
        } else {
          get().playTrack(track);
        }
      } else {
        get().playTrack(track);
      }
    },

    seek: (seconds: number) => {
      const audio = getOrCreateAudio();
      if (!audio) return;
      const safeTime = Math.max(0, Math.min(seconds, get().duration || audio.duration || seconds));
      audio.currentTime = safeTime;
      set({ currentTime: safeTime });
    },

    setVolume: (volume: number) => {
      const audio = getOrCreateAudio();
      const clamped = Math.max(0, Math.min(1, volume));
      if (clamped > 0) {
        lastNonMutedVolume = clamped;
      }
      if (audio) {
        audio.volume = clamped;
        audio.muted = clamped === 0;
      }
      set({ volume: clamped, isMuted: clamped === 0 });
    },

    toggleMute: () => {
      const audio = getOrCreateAudio();
      const { isMuted, volume } = get();
      if (isMuted) {
        const restoreVol = lastNonMutedVolume > 0 ? lastNonMutedVolume : 1.0;
        if (audio) {
          audio.volume = restoreVol;
          audio.muted = false;
        }
        set({ isMuted: false, volume: restoreVol });
      } else {
        lastNonMutedVolume = volume > 0 ? volume : 1.0;
        if (audio) {
          audio.volume = 0;
          audio.muted = true;
        }
        set({ isMuted: true, volume: 0 });
      }
    },

    setPlaybackRate: (rate: number) => {
      const audio = getOrCreateAudio();
      if (audio) {
        audio.playbackRate = rate;
      }
      set({ playbackRate: rate });
    },

    setIsExpanded: (expanded: boolean) => {
      set({ isExpanded: expanded });
    },

    close: () => {
      const audio = getOrCreateAudio();
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      set({
        activeTrack: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        isBuffering: false,
        error: null,
        isExpanded: false,
      });
    },
  };
});
