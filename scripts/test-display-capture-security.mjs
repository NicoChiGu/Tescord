import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import ts from "typescript";
const handlers = new Map();
let displayHandler;
let currentTime = Date.now();
const calls = [];
let nextNative = 0;
const native = {
  start: (hwnd, exclude) => {
    calls.push({ hwnd, exclude });
    return ++nextNative;
  },
  poll: () => ({ status: 0, samples: new Float32Array([0.1, 0.2]) }),
  stop: (id) => calls.push({ stop: id }),
};
const source = { id: "window:12345:0", name: "Selected app" };
const owner = new EventEmitter();
owner.id = 10;
owner.mainFrame = { url: "https://localhost:3000" };
owner.isDestroyed = () => false;
owner.session = {
  setDisplayMediaRequestHandler: (handler) => {
    displayHandler = handler;
  },
};
const win = { webContents: owner };
const main = { exports: {} };
class Clock extends Date {
  static now() {
    return currentTime;
  }
}
const context = vm.createContext({
  exports: main.exports,
  module: main,
  __filename: path.resolve("apps/desktop/src/displayCapture.ts"),
  __dirname: path.resolve("apps/desktop/src"),
  process: { platform: "win32" },
  Date: Clock,
  setInterval,
  clearInterval,
  console,
  require: (id) => {
    if (id === "electron")
      return {
        ipcMain: {
          handle: (name, fn) => handlers.set(name, fn),
          on: (name, fn) => handlers.set(name, fn),
        },
        desktopCapturer: {
          getSources: async () => [source, { id: "screen:0:0" }],
        },
      };
    if (id === "node:module") return { createRequire: () => () => native };
    if (id === "node:os")
      return {
        default: { release: () => "10.0.26100" },
        release: () => "10.0.26100",
      };
    if (id === "node:crypto") return { randomBytes: () => Buffer.alloc(16, 1) };
    if (id === "node:path") return path;
    throw new Error(`Unexpected runtime dependency ${id}`);
  },
});
const compiled = ts.transpileModule(
  fs.readFileSync("apps/desktop/src/displayCapture.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText;
vm.runInContext(compiled, context);
const capture = main.exports;
capture.installDisplayCapture(
  () => win,
  (event) => event.sender === owner && event.senderFrame === owner.mainFrame,
);
capture.attachDisplayCapture(win);
const event = { sender: owner, senderFrame: owner.mainFrame };
const prepare = handlers.get("display-capture-prepare");
const request = { sourceId: source.id, captureAudio: true };
function video(frame = owner.mainFrame) {
  let result;
  displayHandler({ frame, videoRequested: true }, (value) => {
    result = value;
  });
  return result;
}
function port() {
  const value = new EventEmitter();
  value.sent = [];
  value.closed = false;
  value.postMessage = (message) => value.sent.push(message);
  value.start = () => {};
  value.close = () => {
    if (!value.closed) {
      value.closed = true;
      value.emit("close");
    }
  };
  return value;
}
await assert.rejects(
  () => prepare({ ...event, sender: { id: 99 } }, request),
  /Invalid capture/,
);
await assert.rejects(
  () => prepare({ ...event, senderFrame: {} }, request),
  /Invalid capture/,
);
await assert.rejects(
  () => prepare(event, { ...request, sourceId: "window:98765:0" }),
  /unavailable/,
);
assert.equal(video().video, undefined, "Unprepared capture must reject");
const grant = await prepare(event, { ...request, pid: 999999 });
assert.equal(grant.audioScope, "application");
assert.equal(video({}).video, undefined, "Subframe cannot consume grant");
assert.equal(video().video, source);
assert.equal(video().video, undefined, "Video grant is single use");
const unauthorized = port();
handlers.get("display-audio-start")(
  { ...event, ports: [unauthorized] },
  { grantId: "f".repeat(32), requestId: "a".repeat(32) },
);
assert.equal(unauthorized.closed, true);
assert.equal(calls.length, 0, "Forged grant cannot start capture");
const audio = port();
handlers.get("display-audio-start")(
  { ...event, ports: [audio] },
  { grantId: grant.grantId, requestId: "a".repeat(32), pid: 999999 },
);
assert.equal(
  calls[0].hwnd,
  12345,
  "Native capture resolves only enumerated HWND",
);
assert.equal(calls[0].exclude, false);
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(audio.sent[0].type, "ready");
assert.ok(audio.sent.some((message) => message.type === "pcm"));
handlers.get("display-capture-stop")(
  { ...event, sender: { id: 99 } },
  "a".repeat(32),
);
assert.equal(audio.closed, false, "Different owner cannot stop capture");
handlers.get("display-capture-stop")(event, "b".repeat(32));
assert.equal(audio.closed, false, "Different session cannot stop capture");
handlers.get("display-capture-stop")(event, "a".repeat(32));
assert.equal(audio.closed, true);
await prepare(event, request);
currentTime += 15001;
assert.equal(video().video, undefined, "Expired grant cannot capture");
const screen = await prepare(event, {
  sourceId: "screen:0:0",
  captureAudio: true,
});
video();
const system = port();
handlers.get("display-audio-start")(
  { ...event, ports: [system] },
  { grantId: screen.grantId, requestId: "c".repeat(32) },
);
assert.equal(calls.find((value) => value.exclude === true).hwnd, 0);
owner.emit("did-start-navigation", {}, "https://other.invalid", false, true);
assert.equal(system.closed, true, "Navigation closes native capture");
console.log(
  "PASS 20 desktop capture ownership, grant, source, expiry, scope and lifecycle assertions",
);
