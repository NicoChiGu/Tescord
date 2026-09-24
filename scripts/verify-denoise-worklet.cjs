const { app, BrowserWindow, ipcMain, utilityProcess } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const webDir = path.join(root, "apps/web/dist");
const audioDir = path.join(root, "apps/desktop/dist/audio");
const preload = path.join(root, "apps/desktop/dist/preload.js");
const children = new Set();
const sessions = new Map();
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

ipcMain.handle("desktop-detect-local-network", () => null);
ipcMain.handle("window-is-maximized", () => false);
ipcMain.handle("window-get-mode", () => "full");
ipcMain.handle("auth-logout", () => null);
ipcMain.handle("window-set-mode", () => null);
ipcMain.on("audio-inference-start", (event, request) => {
  const child = utilityProcess.fork(
    path.join(audioDir, "native-inference.mjs"),
  );
  children.add(child);
  sessions.set(request.requestId, child);
  child.on("exit", () => {
    children.delete(child);
    if (sessions.get(request.requestId) === child)
      sessions.delete(request.requestId);
  });
  child.postMessage(
    { mode: request.mode, modelDir: path.join(webDir, "models", request.mode) },
    [event.ports[0]],
  );
});
ipcMain.on("audio-inference-stop", (_event, request) => {
  const child = sessions.get(request.requestId);
  if (child) {
    sessions.delete(request.requestId);
    child.kill();
  }
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    await window.loadFile(path.join(webDir, "index.html"));
    for (const mode of ["rnnoise", "dtln", "dfn3", "rnnoise", "dtln", "dfn3"]) {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const mode = ${JSON.stringify(mode)};
        const context = new AudioContext({sampleRate:48000});
        await context.audioWorklet.addModule(new URL('./models/streamWorkletProcessor.js', location.href).href);
        const worklet = new AudioWorkletNode(context, 'stream-denoise-processor', {outputChannelCount:[1]});
        const oscillator = context.createOscillator();
        oscillator.frequency.value = 440;
        const inputGain = context.createGain();
        inputGain.gain.value = 0.04;
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        const inputAnalyser = context.createAnalyser();
        inputAnalyser.fftSize = 512;
        const destination = context.createMediaStreamDestination();
        oscillator.connect(inputGain).connect(worklet).connect(analyser).connect(destination);
        inputGain.connect(inputAnalyser);
        const monitor = context.createGain();
        monitor.gain.value = 0;
        analyser.connect(monitor).connect(context.destination);
        const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,'0')).join('');
        const errors = [];
        let ready = false;
        let stats = null;
        worklet.port.onmessage = ({data}) => {
          if (data?.type === 'READY') ready = true;
          if (data?.type === 'STATS') stats = data;
          if (data?.type === 'ERROR' || data?.type === 'UNDERFLOW') errors.push(data);
        };
        const receive = ({data, ports, source}) => {
          if (source !== window || data?.type !== 'tescord-audio-inference-port' || data.requestId !== requestId) return;
          window.removeEventListener('message', receive);
          worklet.port.postMessage({type:'CONNECT'}, [ports[0]]);
        };
        window.addEventListener('message', receive);
        window.electronAPI.openAudioInferencePort(mode, requestId);
        await context.resume();
        oscillator.start();
        let maxRms = 0;
        let inputRms = 0;
        const samples = new Float32Array(512);
        for (let i=0; i<60; i++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          analyser.getFloatTimeDomainData(samples);
          let energy = 0;
          for (const sample of samples) energy += sample*sample;
          maxRms = Math.max(maxRms, Math.sqrt(energy/samples.length));
          inputAnalyser.getFloatTimeDomainData(samples);
          energy = 0;
          for (const sample of samples) energy += sample*sample;
          inputRms = Math.max(inputRms, Math.sqrt(energy/samples.length));
        }
        worklet.port.postMessage({type:'STOP'});
        window.electronAPI.closeAudioInferencePort(requestId);
        oscillator.stop();
        await context.close();
        return {mode, ready, maxRms, inputRms, stats, errors:errors.slice(0,5)};
      })()`);
      console.log(JSON.stringify(result));
      assert(result.ready, `${mode} never became ready`);
      assert(result.inputRms > 0.01, `${mode} lost input PCM`);
      assert(result.maxRms > 0.0001, `${mode} AudioWorklet produced silence`);
      assert(
        (result.stats?.processedFrames ?? 0) > 0,
        `${mode} did not infer PCM`,
      );
      assert.deepEqual(result.errors, [], `${mode} reported audio errors`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(children.size, 0, `${mode} utility process leaked`);
    }
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    for (const child of children) child.kill();
    window.destroy();
  }
});
