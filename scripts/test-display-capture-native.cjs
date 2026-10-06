// Execute with apps/desktop/node_modules/electron/dist/electron.exe.
// Real WASAPI test: two distinct application processes emit 440/880 Hz.
const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Playwright prepends inspector switches before the application entry path.
const toneArgument = process.argv.indexOf("--tone");
const args = toneArgument >= 0 ? process.argv.slice(toneArgument) : [];
const childMode = args[0] === "--tone";
if (childMode) app.setPath("userData", path.join(args[2], `tone-${args[1]}`));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function tone(frequency) {
  const win = new BrowserWindow({
    width: 300,
    height: 160,
    show: childMode,
    title: `Tescord native tone ${frequency}`,
  });
  await win.loadURL("data:text/html,<title>Tescord capture test</title>");
  await win.webContents.executeJavaScript(
    `window.testContext=new AudioContext(); window.testOscillator=testContext.createOscillator(); window.testGain=testContext.createGain(); testOscillator.frequency.value=${frequency}; testGain.gain.value=0.06; testOscillator.connect(testGain).connect(testContext.destination); testOscillator.start(); testContext.resume();`,
  );
  return win;
}
function amplitude(samples, frequency) {
  let re = 0,
    im = 0;
  const frames = samples.length / 2;
  for (let i = 0; i < frames; i++) {
    const v = samples[i * 2];
    re += v * Math.cos((2 * Math.PI * frequency * i) / 48000);
    im += v * Math.sin((2 * Math.PI * frequency * i) / 48000);
  }
  return (Math.hypot(re, im) * 2) / frames;
}
app
  .whenReady()
  .then(async () => {
    if (childMode) {
      const win = await tone(Number(args[1]));
      fs.writeFileSync(
        path.join(args[2], `${args[1]}.json`),
        JSON.stringify({
          hwnd: Number(win.getNativeWindowHandle().readBigUInt64LE()),
          pid: process.pid,
        }),
      );
      return;
    }
    const folder = fs.mkdtempSync(
      path.join(os.tmpdir(), "tescord-native-capture-"),
    );
    const children = [];
    let native;
    let capture;
    try {
      native = require(
        path.resolve(
          __dirname,
          "../apps/desktop/native/loopback/build/Release/loopback.node",
        ),
      );
      for (const frequency of [440, 880])
        children.push(
          spawn(
            process.execPath,
            [__filename, "--tone", String(frequency), folder],
            { stdio: "ignore", windowsHide: true },
          ),
        );
      for (
        let i = 0;
        i < 100 &&
        (!fs.existsSync(path.join(folder, "440.json")) ||
          !fs.existsSync(path.join(folder, "880.json")));
        i++
      )
        await delay(100);
      const source = JSON.parse(
        fs.readFileSync(path.join(folder, "440.json"), "utf8"),
      );
      await tone(220); // Tescord itself: system exclusion must not capture this.
      await delay(700);
      async function record(hwnd, excludeSelf) {
        capture = native.start(hwnd, excludeSelf);
        const chunks = [];
        for (let i = 0; i < 180; i++) {
          await delay(10);
          const result = native.poll(capture);
          assert.ok(
            result.status === -2147483638 || result.status >= 0,
            `WASAPI HRESULT: ${result.status}`,
          );
          if (result.samples) chunks.push(result.samples);
        }
        native.stop(capture);
        capture = undefined;
        const samples = new Float32Array(
          chunks.reduce((count, chunk) => count + chunk.length, 0),
        );
        let offset = 0;
        for (const chunk of chunks) {
          samples.set(chunk, offset);
          offset += chunk.length;
        }
        assert.ok(
          samples.length > 48000,
          "Native capture returned insufficient PCM",
        );
        return {
          frames: samples.length / 2,
          hz220: amplitude(samples, 220),
          hz440: amplitude(samples, 440),
          hz880: amplitude(samples, 880),
        };
      }
      const application = await record(source.hwnd, false);
      assert.ok(application.hz440 > 0.005, "Selected application tone absent");
      assert.ok(
        application.hz880 < application.hz440 / 20,
        "Other application leaked into window capture",
      );
      assert.ok(
        application.hz220 < application.hz440 / 20,
        "Tescord audio leaked into window capture",
      );
      console.log(
        "PASS application process-tree isolation",
        JSON.stringify(application),
      );
      const system = await record(0, true);
      assert.ok(
        system.hz440 > 0.005 && system.hz880 > 0.005,
        "System capture missed other application tones",
      );
      assert.ok(
        system.hz220 < Math.min(system.hz440, system.hz880) / 20,
        "Tescord audio leaked into system capture",
      );
      console.log(
        "PASS system capture excludes Tescord",
        JSON.stringify(system),
      );
      assert.throws(() => native.start(1, false), /window/);
      console.log("PASS invalid HWND rejected; native stop completed");
      app.exit(0);
    } catch (error) {
      console.error(error);
      if (capture !== undefined) native?.stop(capture);
      app.exit(1);
    } finally {
      for (const child of children) if (!child.killed) child.kill();
      // Isolated temporary evidence is retained for inspection; never touch business data.
      console.log("Native capture fixture:", folder);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
