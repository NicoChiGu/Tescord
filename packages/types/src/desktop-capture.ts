import type { DisplayCaptureResult } from "./communication.js";

/** A grant is one-use, bound to the initiating main frame and expires promptly. */
export interface DesktopDisplayCaptureGrant extends DisplayCaptureResult {
  grantId: string;
}
export interface DesktopCaptureAudioStart {
  grantId: string;
  requestId: string;
}
export type DesktopCaptureAudioMessage =
  | { type: "ready"; sampleRate: 48000; channels: 2 }
  | { type: "pcm"; samples: Float32Array }
  | { type: "error"; reason: "unsupported" | "capture_failed" }
  | { type: "ended" };
