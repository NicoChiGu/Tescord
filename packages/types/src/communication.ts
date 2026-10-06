import type { Message } from "./index.js";

export interface DownloadProgress {
  loaded: number;
  total?: number;
  phase: "downloading" | "verifying" | "initializing" | "decoding" | "ready";
}
export interface ModelLoadProgress extends DownloadProgress {
  asset: string;
}
export interface MessagePage {
  messages: Message[];
  before?: number;
  after?: number;
  hasOlder: boolean;
  hasNewer: boolean;
}
export interface MessageHistoryState {
  hasOlder: boolean;
  hasNewer: boolean;
  loadingOlder: boolean;
  loadingNewer: boolean;
  olderError?: string;
  newerError?: string;
}
export interface GuildIconCrop {
  left: number;
  top: number;
  size: number;
}
export interface GuildIconProcessRequest {
  fileUrl: string;
  crop?: GuildIconCrop;
  frame?: number;
  output: "animated" | "frame";
}
export interface GuildIconMetadata {
  width: number;
  height: number;
  frames: number;
  delays: number[];
}
export interface DisplayCaptureRequest {
  sourceId: string;
  captureAudio: boolean;
}
export type DisplayAudioScope = "application" | "system" | "tab" | "none";
export interface DisplayCaptureResult {
  audioScope: DisplayAudioScope;
  reason?: "unsupported" | "no_audio" | "capture_failed";
}
export interface DesktopLoopbackStart {
  requestId: string;
  sourceId: string;
}
export interface AudioContinuityStats {
  packetsReceived?: number;
  packetsLost?: number;
  packetLoss?: number;
  concealedSamples?: number;
  concealmentPercent?: number;
  jitterBufferMs?: number;
  bytesReceived?: number;
}

export type Dfn3ComparisonInput = {
  type: "COMPARE";
  base: string;
  pcm: Float32Array;
  sampleRate: number;
};
export type Dfn3ComparisonOutput =
  | { type: "PROGRESS"; progress: ModelLoadProgress }
  | { type: "COMPARED"; pcm: Float32Array; processedFrames: number }
  | { type: "ERROR"; reason: string };
