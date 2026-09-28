import { create } from "zustand";
import { ClientCallState, User } from "@tescord/types";

export interface DMCallStoreState {
  callState: ClientCallState;
  callId: string | null;
  channelId: string | null;
  callerId: string | null;
  calleeId: string | null;
  targetUser: User | null;
  hasVideo: boolean;
  isCaller: boolean;
  isStageCollapsed: boolean;
  callStartTime: number | null;
  remoteVolume: number;
  videoFitMode: "contain" | "cover";
  isRingtoneMuted: boolean;
  spotlight: "local" | "remote" | "screen" | null;

  // Actions
  startOutgoing: (params: {
    channelId: string;
    targetUser: User;
    hasVideo: boolean;
    callId?: string;
  }) => void;
  receiveIncoming: (params: {
    callId: string;
    channelId: string;
    caller: User;
    hasVideo: boolean;
  }) => void;
  setConnecting: (callId?: string) => void;
  setConnected: (callId?: string) => void;
  endCall: (reason?: string) => void;
  toggleStageCollapsed: () => void;
  setStageCollapsed: (collapsed: boolean) => void;
  setVideoFitMode: (mode: "contain" | "cover") => void;
  setRemoteVolume: (volume: number) => void;
  setSpotlight: (spotlight: "local" | "remote" | "screen" | null) => void;
  muteRingtone: () => void;
  reset: () => void;
}

export const useDMCallStore = create<DMCallStoreState>((set) => ({
  callState: "idle",
  callId: null,
  channelId: null,
  callerId: null,
  calleeId: null,
  targetUser: null,
  hasVideo: false,
  isCaller: false,
  isStageCollapsed: false,
  callStartTime: null,
  remoteVolume: 100,
  videoFitMode: "contain",
  isRingtoneMuted: false,
  spotlight: null,

  startOutgoing: ({ channelId, targetUser, hasVideo, callId }) =>
    set({
      callState: "outgoing_calling",
      channelId,
      targetUser,
      hasVideo,
      isCaller: true,
      callId: callId || null,
      isStageCollapsed: false,
      callStartTime: null,
      isRingtoneMuted: false,
      spotlight: null,
    }),

  receiveIncoming: ({ callId, channelId, caller, hasVideo }) =>
    set({
      callState: "incoming_ringing",
      callId,
      channelId,
      targetUser: caller,
      callerId: caller.id,
      hasVideo,
      isCaller: false,
      isStageCollapsed: false,
      callStartTime: null,
      isRingtoneMuted: false,
    }),

  setConnecting: (callId) =>
    set((state) => ({
      callState: "connecting",
      callId: callId || state.callId,
    })),

  setConnected: (callId) =>
    set((state) => ({
      callState: "connected",
      callId: callId || state.callId,
      callStartTime: state.callStartTime || Date.now(),
      isRingtoneMuted: false,
    })),

  endCall: () =>
    set({
      callState: "ended",
      callStartTime: null,
      isRingtoneMuted: false,
    }),

  toggleStageCollapsed: () =>
    set((state) => ({ isStageCollapsed: !state.isStageCollapsed })),

  setStageCollapsed: (collapsed) => set({ isStageCollapsed: collapsed }),

  setVideoFitMode: (mode) => set({ videoFitMode: mode }),

  setRemoteVolume: (volume) =>
    set({ remoteVolume: Math.max(0, Math.min(200, volume)) }),

  setSpotlight: (spotlight) => set({ spotlight }),

  muteRingtone: () => set({ isRingtoneMuted: true }),

  reset: () =>
    set({
      callState: "idle",
      callId: null,
      channelId: null,
      callerId: null,
      calleeId: null,
      targetUser: null,
      hasVideo: false,
      isCaller: false,
      isStageCollapsed: false,
      callStartTime: null,
      remoteVolume: 100,
      videoFitMode: "contain",
      isRingtoneMuted: false,
      spotlight: null,
    }),
}));
