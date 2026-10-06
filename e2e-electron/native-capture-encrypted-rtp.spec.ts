import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const desktopRoot = resolve("apps/desktop");
const desktopRequire = createRequire(resolve(desktopRoot, "package.json"));
const serverRequire = createRequire(resolve("apps/server/package.json"));
const { build } = serverRequire(
  serverRequire.resolve("esbuild", {
    paths: [dirname(serverRequire.resolve("tsx"))],
  }),
) as {
  build(
    options: Record<string, unknown>,
  ): Promise<{ outputFiles: { text: string }[] }>;
};

test("real Windows selected-app audio crosses encrypted P2P into a separate receiver renderer", async ({}, testInfo) => {
  test.setTimeout(150000);
  expect(process.platform).toBe("win32");
  const fixture = testInfo.outputPath("tone-fixture");
  await mkdir(fixture, { recursive: true });
  const apps: ElectronApplication[] = [];
  let app: ElectronApplication | undefined;
  try {
    for (const frequency of [440, 880]) {
      const tone = await electron.launch({
        executablePath: desktopRequire("electron"),
        args: [
          resolve("scripts/test-display-capture-native.cjs"),
          "--tone",
          String(frequency),
          fixture,
        ],
        timeout: 30000,
      });
      apps.push(tone);
      await expect
        .poll(async () => {
          try {
            await readFile(resolve(fixture, `${frequency}.json`));
            return true;
          } catch {
            return false;
          }
        })
        .toBe(true);
    }
    const selected = JSON.parse(
      await readFile(resolve(fixture, "440.json"), "utf8"),
    ) as { hwnd: number };
    app = await electron.launch({
      executablePath: desktopRequire("electron"),
      args: [desktopRoot, "--autoplay-policy=no-user-gesture-required"],
      env: {
        ...process.env,
        TESCORD_E2E_USER_DATA_DIR: testInfo.outputPath("user-data"),
        TESCORD_E2E_FORCE_FILE: "true",
        TESCORD_E2E_SKIP_SINGLE_INSTANCE: "true",
        NODE_ENV: "development",
      },
      timeout: 45000,
    });
    const auth = await app.firstWindow();
    await expect(auth.getByTestId("auth-email-input")).toBeVisible({
      timeout: 30000,
    });
    await auth.getByTestId("auth-email-input").fill("admin@tescord.local");
    await auth.getByTestId("auth-submit-btn").click();
    await auth.getByTestId("auth-password-input").fill("adminpassword123");
    const mainPromise = app.waitForEvent("window", {
      predicate: (candidate) => candidate !== auth,
    });
    await auth.getByTestId("auth-submit-btn").click();
    const senderPage = await mainPromise;
    await expect(senderPage.getByTestId("current-user-panel-btn")).toBeVisible({
      timeout: 30000,
    });
    const sourceId = await senderPage.evaluate(async (hwnd) => {
      const api = (
        window as unknown as {
          electronAPI: { getDesktopSources: () => Promise<{ id: string }[]> };
        }
      ).electronAPI;
      return (await api.getDesktopSources()).find(
        (source) => Number(source.id.split(":")[1]) === hwnd,
      )?.id;
    }, selected.hwnd);
    expect(sourceId).toMatch(/^window:/);
    await app.context().route("**/native-capture-receiver", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Encrypted native audio receiver</title>",
      }),
    );
    const receiverPromise = app.waitForEvent("window");
    await app.evaluate(async ({ BrowserWindow }) => {
      const receiver = new BrowserWindow({ show: false });
      await receiver.loadURL("https://localhost:4173/native-capture-receiver");
    });
    const receiverPage = await receiverPromise;
    const worker = (
      await build({
        entryPoints: [resolve("apps/web/src/services/sframe.worker.ts")],
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
      })
    ).outputFiles[0].text;
    const script = `import { captureDisplay } from "./apps/web/src/services/displayCapture.ts";
      import { SFrameManager } from "./apps/web/src/services/sframe.ts";
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      async function gather(pc){const until=Date.now()+10000;while(pc.iceGatheringState!=="complete"){if(Date.now()>until)throw Error("ICE gathering timeout");await wait(25);}}
      window.startNativeSender=async sourceId=>{
        const captured=await captureDisplay({sourceId,captureAudio:true});
        if(captured.audioScope!=="application"||captured.stream.getAudioTracks().length!==1)throw Error("No scoped native application audio");
        const cipher=new SFrameManager(),key=crypto.getRandomValues(new Uint8Array(32));
        cipher.beginContext(async streamId=>({key,keyId:4455,streamId}));
        const pc=new RTCPeerConnection({encodedInsertableStreams:true});
        cipher.attachSender(pc.addTrack(captured.stream.getAudioTracks()[0],captured.stream));
        await pc.setLocalDescription(await pc.createOffer());await gather(pc);
        window.nativeState={pc,cipher,captured};return {offer:pc.localDescription.toJSON(),key:Array.from(key),scope:captured.audioScope};
      };
      window.startNativeReceiver=async({offer,key})=>{
        const cipher=new SFrameManager();cipher.beginContext(async streamId=>({key:crypto.getRandomValues(new Uint8Array(32)),keyId:5566,streamId}));cipher.addReceiverKey(4455,new Uint8Array(key));
        const pc=new RTCPeerConnection({encodedInsertableStreams:true}),ctx=new AudioContext({sampleRate:48000});await ctx.resume();
        window.nativeState={pc,cipher,ctx};
        pc.ontrack=event=>{cipher.attachReceiver(event.receiver);const stream=event.streams[0]||new MediaStream([event.track]);const audio=document.createElement("audio");audio.srcObject=stream;audio.autoplay=true;document.body.append(audio);void audio.play();const source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();analyser.fftSize=8192;source.connect(analyser).connect(ctx.destination);Object.assign(window.nativeState,{audio,source,analyser});};
        await pc.setRemoteDescription(offer);await pc.setLocalDescription(await pc.createAnswer());await gather(pc);return pc.localDescription.toJSON();
      };
      window.nativeProof=async()=>{
        const state=window.nativeState,all=await state.pc.getStats();let sent=0,received=0,codec="",pair=null;
        for(const value of all.values()){if(value.type==="outbound-rtp"&&value.kind==="audio")sent+=value.bytesSent||0;if(value.type==="inbound-rtp"&&value.kind==="audio"){received+=value.bytesReceived||0;codec=all.get(value.codecId)?.mimeType||"";}if(value.type==="candidate-pair"&&value.nominated&&value.state==="succeeded")pair={local:all.get(value.localCandidateId)?.candidateType,remote:all.get(value.remoteCandidateId)?.candidateType};}
        let rms=0,hz440=-200,hz880=-200;
        if(state.analyser){const samples=new Float32Array(state.analyser.fftSize);state.analyser.getFloatTimeDomainData(samples);rms=Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);const bins=new Float32Array(state.analyser.frequencyBinCount);state.analyser.getFloatFrequencyData(bins);const peak=hz=>Math.max(...bins.slice(Math.round((hz-12)*bins.length/24000),Math.round((hz+12)*bins.length/24000)+1));hz440=peak(440);hz880=peak(880);}
        return {crypto:state.cipher.getStats(),sent,received,codec,pair,rms,hz440,hz880,connection:state.pc.connectionState,playing:state.audio?!state.audio.paused:false};
      };
      window.stopNativeTest=async()=>{const state=window.nativeState;if(!state)return;state.pc.close();state.cipher.disable();state.captured?.cleanup();state.source?.disconnect();state.analyser?.disconnect();state.audio?.remove();if(state.ctx)await state.ctx.close();URL.revokeObjectURL(window.__nativeCipherWorker);};`;
    const harness = (
      await build({
        stdin: { contents: script, resolveDir: process.cwd(), loader: "js" },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        define: {
          "import.meta.env": JSON.stringify({ BASE_URL: "./", DEV: false }),
          "import.meta.url": JSON.stringify(
            "file:///native-capture-harness.js",
          ),
        },
        plugins: [
          {
            name: "inline-native-test-worker",
            setup: (builder: {
              onLoad: (
                options: { filter: RegExp },
                callback: (args: {
                  path: string;
                }) => Promise<{ contents: string; loader: string }>,
              ) => void;
            }) =>
              builder.onLoad(
                { filter: /[\\/]sframe\.ts$/ },
                async ({ path }) => ({
                  contents: (await readFile(path, "utf8")).replace(
                    'new URL("./sframe.worker.ts", import.meta.url)',
                    "window.__nativeCipherWorker",
                  ),
                  loader: "ts",
                }),
              ),
          },
        ],
      })
    ).outputFiles[0].text;
    const content = `window.__nativeCipherWorker=URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:"application/javascript"}));${harness}`;
    const errors: string[] = [];
    senderPage.on("pageerror", (error) => errors.push(error.message));
    receiverPage.on("pageerror", (error) => errors.push(error.message));
    await senderPage.addScriptTag({ content });
    await receiverPage.addScriptTag({ content });
    const offer = await senderPage.evaluate(
      (id) =>
        (
          window as unknown as {
            startNativeSender: (source: string) => Promise<{
              offer: RTCSessionDescriptionInit;
              key: number[];
              scope: string;
            }>;
          }
        ).startNativeSender(id!),
      sourceId,
    );
    const answer = await receiverPage.evaluate(
      (data) =>
        (
          window as unknown as {
            startNativeReceiver: (
              offer: typeof data,
            ) => Promise<RTCSessionDescriptionInit>;
          }
        ).startNativeReceiver(data),
      offer,
    );
    await senderPage.evaluate(
      (answer) =>
        (
          window as unknown as { nativeState: { pc: RTCPeerConnection } }
        ).nativeState.pc.setRemoteDescription(answer),
      answer,
    );
    interface Proof {
      crypto: { framesEncrypted: number; framesDecrypted: number };
      sent: number;
      received: number;
      codec: string;
      pair: unknown;
      rms: number;
      hz440: number;
      hz880: number;
      connection: string;
      playing: boolean;
    }
    const getProof = () =>
      receiverPage.evaluate(() =>
        (
          window as unknown as { nativeProof: () => Promise<Proof> }
        ).nativeProof(),
      );
    await expect
      .poll(
        async () => {
          const result = await getProof();
          return (
            result.crypto.framesDecrypted > 30 &&
            result.rms > 0.001 &&
            result.playing
          );
        },
        { timeout: 15000 },
      )
      .toBe(true);
    const receive = await getProof();
    const send = await senderPage.evaluate(() =>
      (
        window as unknown as { nativeProof: () => Promise<Proof> }
      ).nativeProof(),
    );
    expect(send.crypto.framesEncrypted).toBeGreaterThan(30);
    expect(send.sent).toBeGreaterThan(0);
    expect(receive.crypto.framesDecrypted).toBeGreaterThan(30);
    expect(receive.received).toBeGreaterThan(0);
    expect(receive.codec.toLowerCase()).toContain("opus");
    expect(receive.pair).toBeTruthy();
    expect(receive.playing).toBe(true);
    expect(receive.rms).toBeGreaterThan(0.001);
    expect(receive.hz440).toBeGreaterThan(receive.hz880 + 20);
    expect(errors).toEqual([]);
    await writeFile(
      testInfo.outputPath("native-encrypted-rtp-proof.json"),
      JSON.stringify({ sourceId, scope: offer.scope, send, receive }, null, 2),
    );
    await senderPage.evaluate(() =>
      (
        window as unknown as { stopNativeTest: () => Promise<void> }
      ).stopNativeTest(),
    );
    await receiverPage.evaluate(() =>
      (
        window as unknown as { stopNativeTest: () => Promise<void> }
      ).stopNativeTest(),
    );
  } finally {
    await app?.close();
    for (const tone of apps) await tone.close();
  }
});
