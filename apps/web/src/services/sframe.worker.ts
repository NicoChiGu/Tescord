import type { MediaTransformControl } from "@tescord/types";
import {
  decodeSFrameHeader,
  encryptSFramePacket,
  decryptSFramePacket,
  SFrameReplayFilter,
  encodedFrameLayout,
  escapeMediaRbsp,
  unescapeMediaRbsp,
  joinMediaFrame,
} from "@tescord/types";
import type { EncodedMediaFrame } from "./sframe.js";
interface Transformer {
  options: { operation: "encrypt" | "decrypt"; kind: "audio" | "video" };
  generateKeyFrame?: () => Promise<unknown>;
  readable: ReadableStream<EncodedMediaFrame>;
  writable: WritableStream<EncodedMediaFrame>;
}
interface WorkerScope {
  onmessage: ((event: MessageEvent<MediaTransformControl>) => void) | null;
  onrtctransform: ((event: { transformer: Transformer }) => void) | null;
  postMessage(message: unknown): void;
}
const scope = globalThis as unknown as WorkerScope;
const keys = new Map<number, Uint8Array>(),
  filters = new Map<number, SFrameReplayFilter>();
const codecs = new Map<number, string>();
let currentTransformer: Transformer | undefined;
let sending: { keyId: number; key: Uint8Array } | null = null;
let counter = 0n,
  paused = false,
  generation = 0;
let encrypted = 0,
  decrypted = 0,
  replay = 0;
let reportedFirstFrame = false;
function report(): void {
  scope.postMessage({ type: "stats", encrypted, decrypted, replay });
  encrypted = 0;
  decrypted = 0;
  replay = 0;
}
scope.onmessage = ({ data }) => {
  if (data.type === "codecs") {
    const wasEmpty = !codecs.size;
    for (const codec of data.codecs || [])
      codecs.set(codec.payloadType, codec.mimeType);
    if (
      wasEmpty &&
      codecs.size &&
      currentTransformer?.options.operation === "encrypt"
    )
      void currentTransformer.generateKeyFrame?.().catch(() => {});
  } else if (data.type === "sender-key") {
    sending = { keyId: data.keyId, key: data.key };
    counter = 0n;
    generation++;
  } else if (data.type === "receiver-key") {
    keys.set(data.keyId, data.key);
    if (data.requestId !== undefined)
      scope.postMessage({ type: "key-installed", requestId: data.requestId });
  } else if (data.type === "pause") {
    paused = true;
    generation++;
  } else if (data.type === "resume") paused = false;
  else if (data.type === "clear-keys") {
    keys.clear();
    filters.clear();
    sending = null;
    generation++;
  }
};
scope.onrtctransform = ({ transformer }) => {
  currentTransformer = transformer;
  const operation = transformer.options.operation;
  scope.postMessage({ type: "codecs-needed" });
  void transformer.readable
    .pipeThrough(
      new TransformStream<EncodedMediaFrame, EncodedMediaFrame>({
        transform: async (frame, controller) => {
          if (paused) return;
          const frameGeneration = generation;
          try {
            const metadata = frame.getMetadata?.();
            const codec =
              metadata?.mimeType || codecs.get(metadata?.payloadType ?? -1);
            if (transformer.options.kind === "video" && !codec) {
              scope.postMessage({ type: "codecs-needed" });
              return;
            }
            const layout = encodedFrameLayout(
              new Uint8Array(frame.data),
              transformer.options.kind,
              codec,
              frame.type,
              operation === "decrypt",
            );
            if (operation === "encrypt") {
              if (!sending) return;
              const data = await encryptSFramePacket(
                layout.payload,
                sending.key,
                sending.keyId,
                counter++,
                layout.header,
              );
              if (paused || frameGeneration !== generation) return;
              frame.data = joinMediaFrame(
                layout.header,
                layout.rbsp ? escapeMediaRbsp(data) : data,
              ).buffer;
              encrypted++;
            } else {
              const packet = layout.rbsp
                  ? unescapeMediaRbsp(layout.payload)
                  : layout.payload,
                header = decodeSFrameHeader(packet),
                key = keys.get(header.kid);
              if (!key) return;
              const { decryptedPayload } = await decryptSFramePacket(
                packet,
                key,
                layout.header,
              );
              if (paused || frameGeneration !== generation) return;
              let filter = filters.get(header.kid);
              if (!filter) {
                filter = new SFrameReplayFilter(128);
                filters.set(header.kid, filter);
              }
              if (!filter.checkAndAdd(header.counter)) {
                replay++;
                return;
              }
              frame.data = (
                layout.wrapper
                  ? decryptedPayload.slice()
                  : joinMediaFrame(layout.header, decryptedPayload)
              ).buffer;
              decrypted++;
            }
            controller.enqueue(frame);
            // Availability timing must observe the first verified frame rather
            // than wait for the one-second periodic statistics batch.
            if (!reportedFirstFrame || encrypted + decrypted + replay >= 50) {
              reportedFirstFrame = true;
              report();
            }
          } catch (error) {
            // Corrupt receive frames are discarded; an encryption failure stops the pipeline.
            if (operation === "encrypt") {
              paused = true;
              scope.postMessage({
                type: "fatal",
                error:
                  error instanceof Error ? error.message : "MEDIA_KEY_INVALID",
              });
            }
          }
        },
      }),
    )
    .pipeTo(transformer.writable)
    .catch(() =>
      scope.postMessage({ type: "fatal", error: "MEDIA_KEY_UNAVAILABLE" }),
    );
};
setInterval(report, 1000);
