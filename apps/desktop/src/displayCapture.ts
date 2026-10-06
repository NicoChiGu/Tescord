import {
  desktopCapturer,
  ipcMain,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type DesktopCapturerSource,
} from "electron";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type {
  DesktopDisplayCaptureGrant,
  DesktopCaptureAudioStart,
  DesktopCaptureAudioMessage,
  DisplayCaptureRequest,
} from "@tescord/types";

interface LoopbackAddon {
  start(hwnd: number, excludeSelf: boolean): number;
  poll(id: number): { status: number; samples?: Float32Array };
  stop(id: number): void;
}
interface Grant {
  id: string;
  source: DesktopCapturerSource;
  expires: number;
  consumed: boolean;
  audio: boolean;
}
const grants = new Map<number, Grant>();
const captures = new Map<number, { requestId: string; stop: () => void }>();
let addon: LoopbackAddon | undefined;
function getAddon(): LoopbackAddon | undefined {
  if (
    process.platform !== "win32" ||
    Number(os.release().split(".")[2]) < 20348
  )
    return undefined;
  try {
    return (addon ??= createRequire(__filename)(
      path.join(__dirname, "audio", "loopback.node"),
    ) as LoopbackAddon);
  } catch {
    return undefined;
  }
}
export function clearDisplayCapture(owner: number): void {
  grants.delete(owner);
  captures.get(owner)?.stop();
}
export function installDisplayCapture(
  getMain: () => BrowserWindow | null,
  trusted: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean,
): void {
  const allowed = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    trusted(event) && event.sender === getMain()?.webContents;
  ipcMain.handle(
    "display-capture-prepare",
    async (event, input: unknown): Promise<DesktopDisplayCaptureGrant> => {
      if (!allowed(event) || !input || typeof input !== "object")
        throw new Error("Invalid capture request");
      const request = input as DisplayCaptureRequest;
      if (
        typeof request.sourceId !== "string" ||
        request.sourceId.length > 100 ||
        typeof request.captureAudio !== "boolean"
      )
        throw new Error("Invalid capture source");
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
      });
      if (!allowed(event)) throw new Error("Capture owner changed");
      const source = sources.find(
        (candidate) => candidate.id === request.sourceId,
      );
      if (!source) throw new Error("Capture source unavailable");
      clearDisplayCapture(event.sender.id);
      const id = randomBytes(16).toString("hex");
      const canAudio = request.captureAudio && !!getAddon();
      grants.set(event.sender.id, {
        id,
        source,
        expires: Date.now() + 15000,
        consumed: false,
        audio: canAudio,
      });
      return {
        grantId: id,
        audioScope: canAudio
          ? source.id.startsWith("window:")
            ? "application"
            : "system"
          : "none",
        reason: request.captureAudio && !canAudio ? "unsupported" : undefined,
      };
    },
  );
  ipcMain.on("display-audio-start", (event, input: unknown) => {
    const port = event.ports[0];
    const request = input as DesktopCaptureAudioStart | null;
    const grant = grants.get(event.sender.id);
    const native = getAddon();
    if (
      !port ||
      !allowed(event) ||
      !request ||
      !/^[a-f0-9]{32}$/.test(request.requestId ?? "") ||
      !grant ||
      request.grantId !== grant.id ||
      !grant.consumed ||
      grant.expires < Date.now() ||
      !grant.audio ||
      !native ||
      captures.has(event.sender.id)
    ) {
      port?.close();
      return;
    }
    grants.delete(event.sender.id);
    const owner = event.sender.id;
    let handle: number;
    let ready = false;
    const send = (message: DesktopCaptureAudioMessage) => {
      try {
        port.postMessage(message);
      } catch {
        /* Port already closed during navigation. */
      }
    };
    try {
      const isWindow = grant.source.id.startsWith("window:");
      const hwnd = isWindow ? Number(grant.source.id.split(":")[1]) : 0;
      if (isWindow && (!Number.isSafeInteger(hwnd) || hwnd <= 0))
        throw new Error("Invalid selected window");
      handle = native.start(hwnd, !isWindow);
    } catch {
      send({ type: "error", reason: "capture_failed" });
      port.close();
      return;
    }
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      native.stop(handle);
      captures.delete(owner);
      if (!event.sender.isDestroyed())
        event.sender.removeListener("destroyed", stop);
      send({ type: "ended" });
      port.close();
    };
    const timer = setInterval(() => {
      const result = native.poll(handle);
      // E_PENDING until asynchronous activation completes.
      if (result.status === -2147483638) return;
      if (result.status < 0) {
        send({ type: "error", reason: "capture_failed" });
        stop();
        return;
      }
      if (!ready) {
        ready = true;
        send({ type: "ready", sampleRate: 48000, channels: 2 });
      }
      if (result.samples?.length)
        send({ type: "pcm", samples: result.samples });
    }, 10);
    captures.set(owner, { requestId: request.requestId, stop });
    event.sender.once("destroyed", stop);
    port.on("close", stop);
    port.start();
  });
  ipcMain.on("display-capture-stop", (event, requestId: unknown) => {
    if (!allowed(event) || typeof requestId !== "string") return;
    if (captures.get(event.sender.id)?.requestId === requestId)
      clearDisplayCapture(event.sender.id);
  });
}
export function attachDisplayCapture(win: BrowserWindow): void {
  // Shared session: only the current main frame with an unconsumed grant may capture.
  win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    const owner = win.webContents;
    const grant = grants.get(owner.id);
    if (
      owner.isDestroyed() ||
      request.frame !== owner.mainFrame ||
      !request.videoRequested ||
      !grant ||
      grant.consumed ||
      grant.expires < Date.now()
    ) {
      callback({});
      return;
    }
    grant.consumed = true;
    callback({ video: grant.source }); // Audio exclusively uses scoped WASAPI, never system fallback.
  });
  win.webContents.on(
    "did-start-navigation",
    (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame) clearDisplayCapture(win.webContents.id);
    },
  );
  win.webContents.once("destroyed", () =>
    clearDisplayCapture(win.webContents.id),
  );
}
