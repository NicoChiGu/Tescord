import { ErrorCode, type ModelLoadProgress } from "@tescord/types";

// Keep unsupported browsers able to import the application. Construction still
// fails explicitly; this local base does not install or emulate an AudioWorklet.
const WorkletBase =
  globalThis.AudioWorkletNode ??
  (class {
    constructor() {
      throw new Error(ErrorCode.AUDIO_PROCESSING_UNSUPPORTED);
    }
  } as unknown as typeof AudioWorkletNode);

/** Real DTLN ONNX inference runs in a dedicated Worker. */
export class DtlnWorkletNode extends WorkletBase {
  private worker: Worker | null = null;
  private readyPromise: Promise<void>;
  private rejectReady: ((reason: Error) => void) | null = null;
  private readyTimeout: ReturnType<typeof setTimeout> | null = null;
  private failed = false;
  private destroyed = false;
  private desktopPortListener: ((event: MessageEvent) => void) | null = null;
  private desktopExitListener: ((event: MessageEvent) => void) | null = null;
  private desktopRequestId: string | null = null;
  private underflows = 0;
  private underflowTimes: number[] = [];
  private outputReady = false;
  private outputWaiters = new Set<() => void>();
  public continuity = { underruns: 0, outputQueueMs: 0, renderedSamples: 0 };
  readonly backend: "web-wasm" | "desktop-native";
  onFailure?: (reason: string) => void;
  onProgress?: (progress: ModelLoadProgress) => void;
  onStats?: (stats: {
    processedFrames: number;
    queueMs: number;
    processingMs: number;
    processingP50Ms: number;
    processingP95Ms: number;
    processingP99Ms: number;
  }) => void;

  constructor(
    context: BaseAudioContext,
    readonly mode: "rnnoise" | "dtln" | "dfn3" = "dtln",
  ) {
    super(context, "stream-denoise-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const desktop = Boolean(window.electronAPI?.openAudioInferencePort);
    this.backend = desktop ? "desktop-native" : "web-wasm";
    const channel = desktop ? null : new MessageChannel();
    if (channel) this.port.postMessage({ type: "CONNECT" }, [channel.port1]);
    const base = new URL(import.meta.env.BASE_URL || "./", window.location.href)
      .href;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.rejectReady = reject;
      this.readyTimeout = setTimeout(
        () => fail(`${mode} model load timed out`),
        60_000,
      );
      const fail = (reason: string) => {
        if (this.failed || this.destroyed) return;
        this.failed = true;
        if (this.readyTimeout) clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
        if (this.desktopRequestId)
          window.electronAPI?.closeAudioInferencePort?.(this.desktopRequestId);
        this.onFailure?.(reason);
        this.rejectReady = null;
        reject(new Error(reason));
      };
      const handleStatus = (data: {
        type?: string;
        reason?: string;
        progress?: ModelLoadProgress;
      }) => {
        if (data?.type === "PROGRESS" && data.progress) {
          this.onProgress?.(data.progress);
          if (this.readyTimeout) clearTimeout(this.readyTimeout);
          this.readyTimeout = setTimeout(
            () => fail(`${mode} initialization stalled`),
            data.progress.phase === "downloading" ? 35_000 : 60_000,
          );
        }
        if (data?.type === "READY") {
          if (this.readyTimeout) clearTimeout(this.readyTimeout);
          this.readyTimeout = null;
          this.rejectReady = null;
          resolve();
        } else if (data?.type === "ERROR") {
          const reason = String(data.reason || "DTLN inference failed");
          fail(reason);
        }
      };
      this.port.onmessage = ({ data }) => {
        handleStatus(data);
        if (data?.type === "OUTPUT_READY") {
          this.outputReady = true;
          for (const resolve of this.outputWaiters) resolve();
          this.outputWaiters.clear();
        }
        if (data?.type === "UNDERFLOW") {
          this.continuity.underruns = ++this.underflows;
          const now = performance.now();
          this.underflowTimes = this.underflowTimes.filter(
            (time) => now - time < 2000,
          );
          this.underflowTimes.push(now);
          if (this.underflowTimes.length >= 3)
            fail("Repeated inference underflow");
        }
        if (data?.type === "OVERFLOW") fail("Inference output overflow");
        if (data?.type === "STATS") {
          this.continuity = {
            underruns: this.underflows,
            outputQueueMs: Number(data.outputQueueMs) || 0,
            renderedSamples: Number(data.renderedSamples) || 0,
          };
          this.onStats?.({
            processedFrames: Number(data.processedFrames),
            queueMs: Number(data.queueMs),
            processingMs: Number(data.processingMs),
            processingP50Ms: Number(data.processingP50Ms),
            processingP95Ms: Number(data.processingP95Ms),
            processingP99Ms: Number(data.processingP99Ms),
          });
        }
      };
      if (desktop) {
        const requestId = Array.from(
          crypto.getRandomValues(new Uint8Array(16)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        this.desktopRequestId = requestId;
        const receivePort = (event: MessageEvent) => {
          if (
            event.source !== window ||
            event.data?.type !== "tescord-audio-inference-port" ||
            event.data.requestId !== requestId
          )
            return;
          window.removeEventListener("message", receivePort);
          this.desktopPortListener = null;
          const port = event.ports[0];
          if (!port) {
            fail("Desktop audio port unavailable");
            return;
          }
          if (this.destroyed) {
            port.close();
            return;
          }
          this.port.postMessage({ type: "CONNECT" }, [port]);
        };
        this.desktopPortListener = receivePort;
        window.addEventListener("message", receivePort);
        this.desktopExitListener = (event: MessageEvent) => {
          if (event.source === window && event.data?.requestId === requestId) {
            if (event.data.type === "tescord-audio-inference-exit")
              fail(`Native process exited (${event.data.code})`);
            else if (event.data.type === "tescord-audio-inference-error")
              fail(String(event.data.reason || "Native inference failed"));
          }
        };
        window.addEventListener("message", this.desktopExitListener);
        window.electronAPI!.openAudioInferencePort!(mode, requestId);
      } else {
        if (mode === "rnnoise") {
          reject(new Error("Native RNNoise requires Electron"));
          return;
        }
        this.worker =
          mode === "dtln"
            ? new Worker(new URL("../workers/dtlnWorker.ts", import.meta.url), {
                type: "module",
              })
            : new Worker(new URL("../workers/dfn3Worker.ts", import.meta.url), {
                type: "module",
              });
        this.worker.onmessage = ({ data }) => handleStatus(data);
        this.worker.onerror = (event) => {
          fail(event.message);
        };
        this.worker.postMessage({ type: "START", port: channel!.port2, base }, [
          channel!.port2,
        ]);
      }
    });
  }

  async ready(): Promise<void> {
    await this.readyPromise;
    if (this.failed) throw new Error("DTLN worker failed");
  }

  async waitForOutput(timeoutMs = 5000): Promise<void> {
    if (this.outputReady) return;
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.outputWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(() => {
        this.outputWaiters.delete(finish);
        reject(new Error("Inference output timed out"));
      }, timeoutMs);
      this.outputWaiters.add(finish);
    });
    if (this.failed || this.destroyed)
      throw new Error("Inference output unavailable");
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.readyTimeout) clearTimeout(this.readyTimeout);
    this.readyTimeout = null;
    this.rejectReady?.(new Error(`${this.mode} inference cancelled`));
    this.rejectReady = null;
    if (this.desktopRequestId)
      window.electronAPI?.closeAudioInferencePort?.(this.desktopRequestId);
    if (this.desktopPortListener)
      window.removeEventListener("message", this.desktopPortListener);
    if (this.desktopExitListener)
      window.removeEventListener("message", this.desktopExitListener);
    this.port.postMessage({ type: "STOP" });
    this.worker?.postMessage({ type: "STOP" });
    this.worker?.terminate();
    this.disconnect();
  }
}

const loadedContexts = new WeakMap<AudioContext, Promise<void>>();
export async function loadDtlnWorklet(
  audioContext: AudioContext,
): Promise<boolean> {
  if (!audioContext.audioWorklet) return false;
  let pending = loadedContexts.get(audioContext);
  if (!pending) {
    const base = new URL(
      import.meta.env.BASE_URL || "./",
      window.location.href,
    );
    pending = audioContext.audioWorklet.addModule(
      new URL("models/streamWorkletProcessor.js", base).href,
    );
    loadedContexts.set(audioContext, pending);
  }
  await pending;
  return true;
}
