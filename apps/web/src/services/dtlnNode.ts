/** Real DTLN ONNX inference runs in a dedicated Worker. */
export class DtlnWorkletNode extends AudioWorkletNode {
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
  readonly backend: "web-wasm" | "desktop-native";
  onFailure?: (reason: string) => void;
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
        20_000,
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
      const handleStatus = (data: { type?: string; reason?: string }) => {
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
        if (data?.type === "UNDERFLOW" && ++this.underflows >= 3)
          fail("Repeated inference underflow");
        if (data?.type === "OVERFLOW") fail("Inference output overflow");
        if (data?.type === "STATS")
          this.onStats?.({
            processedFrames: Number(data.processedFrames),
            queueMs: Number(data.queueMs),
            processingMs: Number(data.processingMs),
            processingP50Ms: Number(data.processingP50Ms),
            processingP95Ms: Number(data.processingP95Ms),
            processingP99Ms: Number(data.processingP99Ms),
          });
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
