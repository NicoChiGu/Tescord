const {
  app,
  utilityProcess,
  MessageChannelMain,
  BrowserWindow,
  ipcMain,
} = require("electron");
const path = require("node:path");
const assert = require("node:assert/strict");
const resources = process.env.TESCORD_PACKAGED_RESOURCES;
const audioDir = resources
  ? path.join(resources, "app.asar/dist/audio")
  : path.resolve(__dirname, "../apps/desktop/dist/audio");
const webDir = resources
  ? path.join(resources, "web/dist")
  : path.resolve(__dirname, "../apps/web/dist");
const preload = resources
  ? path.join(resources, "app.asar/dist/preload.js")
  : path.resolve(__dirname, "../apps/desktop/dist/preload.js");

async function check(mode) {
  const child = utilityProcess.fork(
    path.join(audioDir, "native-inference.mjs"),
    [],
    { serviceName: `Tescord ${mode} test` },
  );
  const channel = new MessageChannelMain();
  const port = channel.port1;
  const modelDir = path.join(webDir, "models", mode);
  const result = await new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setTimeout(
      () => reject(new Error(`${mode} timed out`)),
      30000,
    );
    let frames = 0;
    let pcmFrames = 0;
    let nonFinite = 0;
    let outputEnergy = 0;
    let lastStats = null;
    let sendTimer;
    port.on("message", ({ data }) => {
      if (data?.type === "ERROR") {
        clearTimeout(timer);
        clearInterval(sendTimer);
        reject(new Error(String(data.reason)));
      } else if (data?.type === "READY") {
        sendTimer = setInterval(() => {
          if (frames >= 200) {
            clearInterval(sendTimer);
            return;
          }
          const i = frames;
          const pcm = new Float32Array(128);
          for (let j = 0; j < pcm.length; j++)
            pcm[j] = 0.04 * Math.sin((i * 128 + j) * 0.019);
          port.postMessage({
            type: "PCM",
            pcm,
            sequence: i,
            sampleCount: (i + 1) * 128,
          });
          frames++;
        }, 3);
      } else if (data?.type === "STATS") {
        lastStats = data;
      } else if (data?.type === "PCM") {
        pcmFrames += data.pcm.length;
        for (const sample of data.pcm) {
          if (!Number.isFinite(sample)) nonFinite++;
          else outputEnergy += sample * sample;
        }
        if (pcmFrames >= 15000) {
          clearTimeout(timer);
          clearInterval(sendTimer);
          resolve({
            mode,
            sentFrames: frames,
            outputSamples: pcmFrames,
            nonFinite,
            outputRms: Math.sqrt(outputEnergy / pcmFrames),
            elapsedMs: performance.now() - started,
            lastStats,
          });
        }
      }
    });
    port.start();
    child.once("exit", (code) =>
      reject(new Error(`${mode} utility process exited ${code}`)),
    );
    child.postMessage({ mode, modelDir }, [channel.port2]);
  }).finally(() => {
    try {
      port.postMessage({ type: "STOP" });
    } catch {}
    child.kill();
    port.close();
  });
  assert.equal(result.nonFinite, 0);
  assert(result.outputRms > 0.0001, `${mode} produced silent PCM`);
  return result;
}

async function checkRejectedFrame(frame, label) {
  const child = utilityProcess.fork(
    path.join(audioDir, "native-inference.mjs"),
    [],
    { serviceName: `Tescord ${label} test` },
  );
  const channel = new MessageChannelMain();
  const port = channel.port1;
  try {
    const failure = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label} timed out`)),
        10000,
      );
      port.on("message", ({ data }) => {
        if (data?.type === "READY") port.postMessage({ type: "PCM", ...frame });
        if (data?.type === "ERROR") {
          clearTimeout(timer);
          resolve(String(data.reason));
        }
      });
      port.start();
      child.postMessage(
        { mode: "rnnoise", modelDir: path.join(webDir, "models", "rnnoise") },
        [channel.port2],
      );
    });
    assert.match(failure, /Invalid PCM (frame|sequence)/);
    return failure;
  } finally {
    try {
      port.postMessage({ type: "STOP" });
    } catch {}
    child.kill();
    port.close();
  }
}

async function checkRendererBridge() {
  // The harness loads the real file:// SPA without booting its unrelated
  // desktop services. Stub only those startup calls so harness logs stay clean.
  ipcMain.handle("desktop-detect-local-network", () => null);
  ipcMain.handle("window-is-maximized", () => false);
  ipcMain.handle("window-get-mode", () => "full");
  ipcMain.handle("auth-logout", () => null);
  ipcMain.handle("window-set-mode", () => null);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  let child;
  ipcMain.once("audio-inference-start", (event, request) => {
    assert.equal(request.mode, "dtln");
    assert.equal(event.ports.length, 1);
    child = utilityProcess.fork(
      path.join(audioDir, "native-inference.mjs"),
      [],
      { serviceName: "Tescord renderer bridge test" },
    );
    child.postMessage(
      { mode: "dtln", modelDir: path.join(webDir, "models/dtln") },
      [event.ports[0]],
    );
  });
  try {
    // Exercise the installed file:// page and its worklet asset, not only a
    // synthetic data: page with preload injected.
    await window.loadFile(path.join(webDir, "index.html"));
    const workletLoaded = await window.webContents
      .executeJavaScript(`(async () => {
      const context = new AudioContext({ sampleRate: 48000 });
      try {
        await context.audioWorklet.addModule(new URL('./models/streamWorkletProcessor.js', location.href).href);
        return true;
      } finally { await context.close(); }
    })()`);
    assert.equal(workletLoaded, true);
    const result = await window.webContents
      .executeJavaScript(`new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('port timed out')), 5000);
      try {
        const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)),
          (byte) => byte.toString(16).padStart(2, '0')).join('');
        window.addEventListener('message', ({ data, ports, source }) => {
          if (source !== window || data?.type !== 'tescord-audio-inference-port' ||
              data.requestId !== requestId) return;
          const port = ports[0];
          let frames = 0;
          let samples = 0;
          port.onmessage = ({ data }) => {
            if (data?.type === 'ERROR') { clearTimeout(timer); reject(new Error(data.reason)); }
            if (data?.type === 'READY') {
              const send = setInterval(() => {
                if (frames >= 160) { clearInterval(send); return; }
                port.postMessage({ type: 'PCM', pcm: new Float32Array(128).fill(0.04), sequence: frames, sampleCount: (frames + 1) * 128 });
                frames++;
              }, 3);
            }
            if (data?.type === 'PCM') {
              samples += data.pcm.length;
              if (samples >= 15000) { clearTimeout(timer); port.close(); resolve(samples); }
            }
          };
          port.start();
        });
        window.electronAPI.openAudioInferencePort('dtln', requestId);
      } catch (error) { clearTimeout(timer); reject(error); }
    })`);
    assert(result >= 15000);
    return result;
  } finally {
    child?.kill();
    window.destroy();
  }
}

app.whenReady().then(async () => {
  try {
    for (const mode of ["rnnoise", "dtln", "dfn3"])
      console.log(JSON.stringify(await check(mode)));
    console.log(
      JSON.stringify({
        invalidPcmRejected: await checkRejectedFrame(
          { pcm: new Float32Array(129), sequence: 0, sampleCount: 129 },
          "invalid PCM",
        ),
      }),
    );
    console.log(
      JSON.stringify({
        invalidSequenceRejected: await checkRejectedFrame(
          { pcm: new Float32Array(128), sequence: 1, sampleCount: 128 },
          "invalid sequence",
        ),
      }),
    );
    console.log(
      JSON.stringify({ rendererBridgeSamples: await checkRendererBridge() }),
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
