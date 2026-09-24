const { app, BrowserWindow, ipcMain, utilityProcess } = require("electron");
const { createRequire } = require("node:module");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const webRoot = path.join(root, "apps/web");
const webRequire = createRequire(path.join(webRoot, "package.json"));
const audioDir = path.join(root, "apps/desktop/dist/audio");
const preload = path.join(root, "apps/desktop/dist/preload.js");
const sessions = new Map();
const children = new Set();
let maxSessions = 0;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("ignore-certificate-errors");
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");

ipcMain.on("audio-inference-start", (event, request) => {
  if (sessions.size >= 4 || sessions.has(request.requestId)) {
    event.sender.send("audio-inference-error", {
      requestId: request.requestId,
      reason: "Too many audio inference sessions",
    });
    event.ports[0].close();
    return;
  }
  const child = utilityProcess.fork(
    path.join(audioDir, "native-inference.mjs"),
  );
  children.add(child);
  sessions.set(request.requestId, child);
  maxSessions = Math.max(maxSessions, sessions.size);
  child.on("exit", (code) => {
    children.delete(child);
    if (sessions.get(request.requestId) === child)
      sessions.delete(request.requestId);
    if (!event.sender.isDestroyed())
      event.sender.send("audio-inference-exit", {
        requestId: request.requestId,
        code,
      });
  });
  child.postMessage(
    {
      mode: request.mode,
      modelDir: path.join(webRoot, "dist/models", request.mode),
    },
    [event.ports[0]],
  );
});
ipcMain.on("audio-inference-stop", (_event, request) => {
  const child = sessions.get(request.requestId);
  if (!child) return;
  sessions.delete(request.requestId);
  child.kill();
});

app.whenReady().then(async () => {
  let server;
  let window;
  try {
    const vitePackageDir = path.dirname(
      webRequire.resolve("vite/package.json"),
    );
    const { createServer } = await import(
      pathToFileURL(path.join(vitePackageDir, "dist/node/index.js")).href
    );
    server = await createServer({
      root: webRoot,
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    await server.listen();
    const origin = server.resolvedUrls.local[0];
    window = new BrowserWindow({
      show: true,
      webPreferences: {
        preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    await window.loadURL(`${origin}audio-test.html`);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const { audioEngine } = await import('/src/services/audioEngine.ts');
      audioEngine.config.inputMode = 'PTT';
      audioEngine.config.pushToTalk = true;
      audioEngine.config.noiseSuppression = true;
      audioEngine.config.noiseSuppressionMode = 'rnnoise';
      audioEngine.config.echoCancellation = false;
      const stream = await audioEngine.initMicrophone();
      if (!stream) throw new Error(audioEngine.lastError || 'Mic init failed');
      const track = stream.getAudioTracks()[0];
      audioEngine.setPTTActive(true);
      const probe = new AudioContext({sampleRate:48000});
      const source = probe.createMediaStreamSource(stream);
      const analyser = probe.createAnalyser();
      analyser.fftSize = 512;
      const silent = probe.createGain();
      silent.gain.value = 0;
      source.connect(analyser).connect(silent).connect(probe.destination);
      await probe.resume();
      let maxVolume = 0;
      let speakingSeen = false;
      let currentVolume = 0;
      let currentSpeaking = false;
      const unbind = audioEngine.onSpeakingChange((speaking, volume) => {
        maxVolume = Math.max(maxVolume, volume);
        speakingSeen ||= speaking;
        currentVolume = Math.max(currentVolume, volume);
        currentSpeaking ||= speaking;
      });
      const results = [];
      for (const mode of ['rnnoise','dtln','dfn3','rnnoise','dtln','dfn3']) {
        currentVolume = 0;
        currentSpeaking = false;
        audioEngine.setNoiseSuppressionMode(mode);
        for (let i=0;i<400;i++) {
          if (audioEngine.noiseStatus.effectiveMode === mode &&
              audioEngine.noiseStatus.phase === 'ready') break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        let maxRms = 0;
        const samples = new Float32Array(512);
        for (let i=0;i<36;i++) {
          await new Promise(resolve => setTimeout(resolve,50));
          analyser.getFloatTimeDomainData(samples);
          let energy=0;
          for (const sample of samples) energy+=sample*sample;
          maxRms=Math.max(maxRms,Math.sqrt(energy/samples.length));
        }
        results.push({mode, maxRms, volume:currentVolume,
          speaking:currentSpeaking, status:{...audioEngine.noiseStatus},
          trackEnabled:track.enabled});
      }
      for (const mode of ['rnnoise','dtln','dfn3','rnnoise'])
        audioEngine.setNoiseSuppressionMode(mode);
      for (let i=0;i<400;i++) {
        if (audioEngine.noiseStatus.effectiveMode === 'rnnoise' &&
            audioEngine.noiseStatus.phase === 'ready') break;
        await new Promise(resolve => setTimeout(resolve,50));
      }
      await new Promise(resolve => setTimeout(resolve,1000));
      const rapidStatus = {...audioEngine.noiseStatus};
      const rapidSamples = new Float32Array(512);
      let rapidRms = 0;
      for (let i=0;i<20;i++) {
        await new Promise(resolve => setTimeout(resolve,50));
        analyser.getFloatTimeDomainData(rapidSamples);
        let rapidEnergy = 0;
        for (const sample of rapidSamples) rapidEnergy += sample*sample;
        rapidRms = Math.max(rapidRms,Math.sqrt(rapidEnergy/rapidSamples.length));
      }
      const comparison = await audioEngine.recordTripleABComparison(1);
      const ab = {
        raw: !!comparison.rawUrl,
        rnnoise: !!comparison.rnnoiseUrl,
        dtln: !!comparison.dtlnUrl,
        dfn3: !!comparison.dfn3Url,
        errors: [comparison.rnnoiseError,comparison.dtlnError,
          comparison.dfn3Error].filter(Boolean),
      };
      for (const url of [comparison.rawUrl,comparison.rnnoiseUrl,
        comparison.dtlnUrl,comparison.dfn3Url]) if (url) URL.revokeObjectURL(url);
      unbind();
      audioEngine.stop();
      await probe.close();
      return {results,rapidStatus,rapidRms,ab,maxVolume,speakingSeen,trackEnded:track.readyState};
    })()`);
    console.log(JSON.stringify({ ...result, maxSessions }));
    assert(
      result.results.every(
        ({ mode, status }) =>
          status.requestedMode === mode &&
          status.effectiveMode === mode &&
          status.phase === "ready",
      ),
      "A requested mode failed or fell back",
    );
    assert(
      result.results.every(
        ({ maxRms, volume, speaking, trackEnabled }) =>
          maxRms > 0.0001 && volume > 5 && speaking && trackEnabled,
      ),
      "Processed microphone or per-mode indicator went silent",
    );
    assert(
      result.maxVolume > 5 && result.speakingSeen,
      "Local microphone level/indicator never activated",
    );
    assert(
      result.rapidStatus.effectiveMode === "rnnoise" &&
        result.rapidStatus.phase === "ready" &&
        result.rapidRms > 0.0001,
      "Rapid switching did not recover audible RNNoise output",
    );
    assert.deepEqual(
      result.ab,
      {
        raw: true,
        rnnoise: true,
        dtln: true,
        dfn3: true,
        errors: [],
      },
      "Four-track comparison exhausted inference sessions",
    );
    assert.equal(result.trackEnded, "ended");
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(sessions.size, 0, "An inference session leaked after stop");
    assert(maxSessions <= 4, "Session limit was exceeded");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    for (const child of children) child.kill();
    window?.destroy();
    await server?.close();
  }
});
