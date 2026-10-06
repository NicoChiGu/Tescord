import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const require = createRequire(resolve("apps/server/package.json"));
const { build } = require(
  require.resolve("esbuild", { paths: [dirname(require.resolve("tsx"))] }),
) as {
  build(
    options: Record<string, unknown>,
  ): Promise<{ outputFiles: { text: string }[] }>;
};
let harness: string, worker: string;
test.beforeAll(async () => {
  const script = `import { SFrameManager } from "./apps/web/src/services/sframe.ts";
  window.runMediaEncryptionTest = async (legacy, wrongKey = false) => {
    const original = globalThis.RTCRtpScriptTransform;
    if (legacy) Object.defineProperty(globalThis, "RTCRtpScriptTransform", {value:undefined,configurable:true,writable:true});
    const a = new SFrameManager(), b = new SFrameManager();
    if (!a.isSupported()) throw new Error("No encoded-transform capability");
    const keyA = crypto.getRandomValues(new Uint8Array(32)), keyB = crypto.getRandomValues(new Uint8Array(32));
    a.beginContext(async streamId=>({key:keyA,keyId:1001,streamId}));
    b.beginContext(async streamId=>({key:keyB,keyId:2002,streamId}));
    a.addReceiverKey(2002,wrongKey ? crypto.getRandomValues(new Uint8Array(32)) : keyB); b.addReceiverKey(1001,wrongKey ? crypto.getRandomValues(new Uint8Array(32)) : keyA);
    const ctx = new AudioContext(), oscillators = [], sinks = [], nodes = [];
    const tone = (frequency) => {const source=ctx.createOscillator(), gain=ctx.createGain(), out=ctx.createMediaStreamDestination();source.frequency.value=frequency;gain.gain.value=.2;source.connect(gain).connect(out);source.start();oscillators.push(source);return out.stream;};
    const pa = new RTCPeerConnection({encodedInsertableStreams:true}), pb = new RTCPeerConnection({encodedInsertableStreams:true});
    const remote = new Map();
    const playback=(pc,manager,id)=>{pc.ontrack=e=>{manager.attachReceiver(e.receiver);remote.set(id,e.streams[0]||new MediaStream([e.track]));};};
    playback(pa,a,"a");playback(pb,b,"b");
    const streamA=tone(440),streamB=tone(660);
    a.attachSender(pa.addTrack(streamA.getAudioTracks()[0],streamA));b.attachSender(pb.addTrack(streamB.getAudioTracks()[0],streamB));
    if (legacy) Object.defineProperty(globalThis,"RTCRtpScriptTransform",{value:original,configurable:true,writable:true});
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const gather=async pc=>{const deadline=Date.now()+5000;while(pc.iceGatheringState!=="complete"){if(Date.now()>deadline)throw Error("ICE gathering timeout");await wait(25);}};
    try {
      await ctx.resume();await pa.setLocalDescription(await pa.createOffer());await gather(pa);await pb.setRemoteDescription(pa.localDescription);
      await pb.setLocalDescription(await pb.createAnswer());await gather(pb);await pa.setRemoteDescription(pb.localDescription);
      const deadline=Date.now()+12000;while((pa.connectionState!=="connected"||pb.connectionState!=="connected"||remote.size!==2)&&Date.now()<deadline)await wait(50);
      if(remote.size!==2)throw Error("No received tracks");
      const rms = new Map();
      for(const [id,stream]of remote){const audio=document.createElement("audio");audio.autoplay=true;audio.muted=true;audio.srcObject=stream;document.body.append(audio);sinks.push(audio);await audio.play();const analyser=ctx.createAnalyser(), source=ctx.createMediaStreamSource(stream), mute=ctx.createGain();mute.gain.value=0;source.connect(analyser).connect(mute).connect(ctx.destination);nodes.push(source,analyser,mute);rms.set(id,analyser);}
      await wait(2500);
      const samples=[...rms].map(([id,analyser])=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return {id,rms:Math.sqrt(data.reduce((sum,n)=>sum+n*n,0)/data.length)};});
      const stats=async pc=>{const all=await pc.getStats();let sent=0,received=0,codec="",pair=null;for(const report of all.values()){if(report.type==="outbound-rtp"&&report.kind==="audio")sent+=report.bytesSent||0;if(report.type==="inbound-rtp"&&report.kind==="audio"){received+=report.bytesReceived||0;codec=all.get(report.codecId)?.mimeType||"";}if(report.type==="candidate-pair"&&report.state==="succeeded"&&report.nominated)pair={local:all.get(report.localCandidateId)?.candidateType,remote:all.get(report.remoteCandidateId)?.candidateType};}return {sent,received,codec,pair};};
      return {a:a.getStats(),b:b.getStats(),pa:await stats(pa),pb:await stats(pb),samples,legacy};
    } finally {pa.close();pb.close();a.disable();b.disable();for(const source of oscillators)source.stop();for(const node of nodes)node.disconnect();for(const audio of sinks)audio.remove();await ctx.close();}
  };
  window.runEncryptedVideoTest = async (requestedCodec) => {
    const senderCipher=new SFrameManager(),receiverCipher=new SFrameManager(),key=crypto.getRandomValues(new Uint8Array(32));
    senderCipher.beginContext(async streamId=>({streamId,key,keyId:6006}));
    receiverCipher.beginContext(async streamId=>({streamId,key:crypto.getRandomValues(new Uint8Array(32)),keyId:7007}));
    receiverCipher.addReceiverKey(6006,key);
    const canvas=document.createElement("canvas");canvas.width=320;canvas.height=180;
    let paintIndex=0;
    // Moving pixels force delta frames: a static first decoded frame is insufficient.
    const paint=()=>{const draw=canvas.getContext("2d");draw.fillStyle="#23a55a";draw.fillRect(0,0,320,180);draw.fillStyle="#a54fea";draw.fillRect((paintIndex++%24)*10,40,24,40);};paint();
    const timer=setInterval(paint,33),stream=canvas.captureStream(30),video=document.createElement("video");video.autoplay=true;video.muted=true;document.body.append(video);
    const sender=new RTCPeerConnection({encodedInsertableStreams:true}),receiver=new RTCPeerConnection({encodedInsertableStreams:true});
    receiver.ontrack=event=>{receiverCipher.attachReceiver(event.receiver);video.srcObject=event.streams[0]||new MediaStream([event.track]);void video.play();};
    const transceiver=sender.addTransceiver(stream.getVideoTracks()[0],{direction:"sendonly",streams:[stream]});
    const codecs=RTCRtpSender.getCapabilities("video").codecs.filter(codec=>codec.mimeType.toLowerCase()==="video/"+requestedCodec);
    if(!codecs.length)throw Error("No "+requestedCodec+" capability");const repair=RTCRtpSender.getCapabilities("video").codecs.filter(codec=>codec.mimeType.toLowerCase()==="video/rtx");transceiver.setCodecPreferences([...codecs,...repair]);senderCipher.attachSender(transceiver.sender);
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const gather=async pc=>{const until=Date.now()+5000;while(pc.iceGatheringState!=="complete"){if(Date.now()>until)throw Error("ICE timeout");await wait(25);}};
    try {
      await sender.setLocalDescription(await sender.createOffer());await gather(sender);await receiver.setRemoteDescription(sender.localDescription);await receiver.setLocalDescription(await receiver.createAnswer());await gather(receiver);await sender.setRemoteDescription(receiver.localDescription);
      const until=Date.now()+7000;while(video.videoWidth!==320){if(Date.now()>until)throw Error("No decoded encrypted video");await wait(50);}await wait(1500);
      const sample=document.createElement("canvas");sample.width=1;sample.height=1;const draw=sample.getContext("2d");draw.drawImage(video,0,0,1,1);
      const stats=await receiver.getStats();let received=0,codec="",framesDecoded=0,pair=null;for(const stat of stats.values()){if(stat.type==="inbound-rtp"&&stat.kind==="video"){received=stat.bytesReceived||0;framesDecoded=stat.framesDecoded||0;codec=stats.get(stat.codecId)?.mimeType||"";}if(stat.type==="candidate-pair"&&stat.nominated&&stat.state==="succeeded")pair={local:stats.get(stat.localCandidateId)?.candidateType,remote:stats.get(stat.remoteCandidateId)?.candidateType};}
      const sdp=sender.localDescription.sdp;const repair={codec:/a=rtpmap:\\d+ rtx\\/90000/i.test(sdp)&&/a=fmtp:\\d+ apt=\\d+/i.test(sdp),separateSsrc:/a=ssrc-group:FID \\d+ \\d+/i.test(sdp)}; return {repair,sender:senderCipher.getStats(),receiver:receiverCipher.getStats(),received,framesDecoded,codec,pair,width:video.videoWidth,height:video.videoHeight,pixel:Array.from(draw.getImageData(0,0,1,1).data)};
    } finally {clearInterval(timer);stream.getTracks().forEach(track=>track.stop());sender.close();receiver.close();senderCipher.disable();receiverCipher.disable();video.srcObject=null;video.remove();}
  };
  window.runMediaQualityTest = async () => {
    const a=new SFrameManager(),b=new SFrameManager(), key=crypto.getRandomValues(new Uint8Array(32));
    a.beginContext(async streamId=>({key,keyId:3003,streamId}));b.beginContext(async streamId=>({key:crypto.getRandomValues(new Uint8Array(32)),keyId:4004,streamId}));b.addReceiverKey(3003,key);
    const ctx=new AudioContext({sampleRate:48000}), fixture=await ctx.decodeAudioData(await(await fetch("/voice-fixture.wav")).arrayBuffer());
    const source=ctx.createBufferSource(),out=ctx.createMediaStreamDestination();source.buffer=fixture;source.loop=true;source.connect(out);
    const pa=new RTCPeerConnection({encodedInsertableStreams:true}),pb=new RTCPeerConnection({encodedInsertableStreams:true});
    const recorded={source:[],received:[]};const nodes=[],base=ctx.currentTime;
    const capture=(stream,name)=>{const input=ctx.createMediaStreamSource(stream),processor=ctx.createScriptProcessor(1024,1,1),mute=ctx.createGain();mute.gain.value=0;processor.onaudioprocess=e=>recorded[name].push({time:e.playbackTime,data:new Float32Array(e.inputBuffer.getChannelData(0))});input.connect(processor).connect(mute).connect(ctx.destination);nodes.push(input,processor,mute);};
    capture(out.stream,"source");let remote=null;const playback=document.createElement("audio");playback.autoplay=true;playback.muted=true;document.body.append(playback);
    pb.ontrack=e=>{b.attachReceiver(e.receiver);remote=e.streams[0]||new MediaStream([e.track]);playback.srcObject=remote;void playback.play();capture(remote,"received");};
    a.attachSender(pa.addTrack(out.stream.getAudioTracks()[0],out.stream));
    const wait=ms=>new Promise(r=>setTimeout(r,ms));const gather=async pc=>{const limit=Date.now()+5000;while(pc.iceGatheringState!=="complete"){if(Date.now()>limit)throw Error("ICE timeout");await wait(25);}};
    const serialize=chunks=>{const length=Math.max(...chunks.map(chunk=>Math.round((chunk.time-base)*48000)+chunk.data.length),1), pcm=new Float32Array(length);for(const chunk of chunks)pcm.set(chunk.data,Math.max(0,Math.round((chunk.time-base)*48000)));return pcm;};
    const wav=pcm=>{const bytes=new Uint8Array(44+pcm.length*2),view=new DataView(bytes.buffer);const text=(at,value)=>{for(let i=0;i<value.length;i++)bytes[at+i]=value.charCodeAt(i);};text(0,"RIFF");view.setUint32(4,36+pcm.length*2,true);text(8,"WAVEfmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,48000,true);view.setUint32(28,96000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,"data");view.setUint32(40,pcm.length*2,true);for(let i=0;i<pcm.length;i++)view.setInt16(44+i*2,Math.max(-32768,Math.min(32767,pcm[i]*32767)),true);let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);};
    try {
      await ctx.resume();await pa.setLocalDescription(await pa.createOffer());await gather(pa);await pb.setRemoteDescription(pa.localDescription);await pb.setLocalDescription(await pb.createAnswer());await gather(pb);await pa.setRemoteDescription(pb.localDescription);
      source.start(ctx.currentTime+.1);await wait(6000);
      const report=await pb.getStats();let inbound=null,codec="",pair=null;for(const item of report.values()){if(item.type==="inbound-rtp"&&item.kind==="audio"){inbound=item;codec=report.get(item.codecId)?.mimeType||"";}if(item.type==="candidate-pair"&&item.nominated&&item.state==="succeeded")pair={local:report.get(item.localCandidateId)?.candidateType,remote:report.get(item.remoteCandidateId)?.candidateType};}
      const ref=serialize(recorded.source),recv=serialize(recorded.received);let best=-1,bestLag=0;
      // Same AudioContext clock; correlate unique speech samples after startup over 0..200ms delay.
      const start=Math.round((ctx.currentTime-base-3.5)*48000),count=24000;
      for(let lag=0;lag<=9600;lag+=48){let dot=0,rr=0,ss=0;for(let i=0;i<count;i+=12){const x=ref[start+i]||0,y=recv[start+i+lag]||0;dot+=x*y;rr+=x*x;ss+=y*y;}const score=dot/Math.sqrt(rr*ss||1);if(score>best){best=score;bestLag=lag;}}
      return {impairment:"synthetic encoded-frame dropping and bounded transform delay; not network packet loss",source:"noisy_2s_48k.wav (same fixture loop)",cipher:a.getStats(),decoder:b.getStats(),codec,pair,inbound:{bytesReceived:inbound?.bytesReceived,packetsReceived:inbound?.packetsReceived,packetsLost:inbound?.packetsLost,jitterMs:(inbound?.jitter||0)*1000,concealedSamples:inbound?.concealedSamples,totalSamplesReceived:inbound?.totalSamplesReceived,concealmentEvents:inbound?.concealmentEvents,jitterBufferDelayMs:inbound?.jitterBufferEmittedCount?inbound.jitterBufferDelay/inbound.jitterBufferEmittedCount*1000:null},latencyMs:bestLag/48,correlation:best,diagnostic:{sourceLength:ref.length,receivedLength:recv.length,start,sourceEnergy:ref.reduce((sum,n)=>sum+n*n,0),receivedEnergy:recv.reduce((sum,n)=>sum+n*n,0),sourceTimes:recorded.source.map(chunk=>chunk.time).slice(-3),receivedTimes:recorded.received.map(chunk=>chunk.time).slice(-3),contextTime:ctx.currentTime,base},recordings:{source:wav(ref),received:wav(recv)}};
    } finally {source.stop();playback.srcObject=null;playback.remove();pa.close();pb.close();for(const node of nodes)node.disconnect();a.disable();b.disable();await ctx.close();}
  };`;
  harness = (
    await build({
      stdin: {
        contents: script,
        resolveDir: process.cwd(),
        sourcefile: "harness.ts",
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
    })
  ).outputFiles[0].text;
  worker = (
    await build({
      entryPoints: [resolve("apps/web/src/services/sframe.worker.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
    })
  ).outputFiles[0].text;
});
for (const legacy of [false, true])
  test(`real bidirectional encrypted Opus RTP with ${legacy ? "legacy streams" : "Worker ScriptTransform"}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/media-encryption-harness", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<button id="start">Start</button><script type="module" src="/harness.js"></script>',
      }),
    );
    await page.route("**/harness.js", (route) =>
      route.fulfill({ contentType: "application/javascript", body: harness }),
    );
    await page.route("**/sframe.worker.ts", (route) =>
      route.fulfill({ contentType: "application/javascript", body: worker }),
    );
    await page.goto("/media-encryption-harness");
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { runMediaEncryptionTest?: unknown })
          .runMediaEncryptionTest === "function",
    );
    await page.click("#start");
    const result = await page.evaluate(
      async (legacy) =>
        (
          window as unknown as {
            runMediaEncryptionTest: (legacy: boolean) => Promise<{
              a: { framesEncrypted: number; framesDecrypted: number };
              b: { framesEncrypted: number; framesDecrypted: number };
              pa: {
                sent: number;
                received: number;
                codec: string;
                pair: unknown;
              };
              pb: {
                sent: number;
                received: number;
                codec: string;
                pair: unknown;
              };
              samples: { rms: number }[];
            }>;
          }
        ).runMediaEncryptionTest(legacy),
      legacy,
    );
    await testInfo.attach("encrypted-rtp-proof.json", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
    mkdirSync(resolve("test-results/media-encryption-proof"), {
      recursive: true,
    });
    writeFileSync(
      resolve(
        `test-results/media-encryption-proof/${legacy ? "legacy" : "worker"}.json`,
      ),
      JSON.stringify(result, null, 2),
    );
    for (const stats of [result.a, result.b]) {
      expect(stats.framesEncrypted).toBeGreaterThan(0);
      expect(stats.framesDecrypted).toBeGreaterThan(0);
    }
    for (const stats of [result.pa, result.pb]) {
      expect(stats.sent).toBeGreaterThan(0);
      expect(stats.received).toBeGreaterThan(0);
      expect(stats.codec.toLowerCase()).toContain("opus");
      expect(stats.pair).toBeTruthy();
    }
    for (const sample of result.samples)
      expect(sample.rms).toBeGreaterThan(0.001);
    expect(errors).toEqual([]);
  });

test("wrong media keys drop encoded audio despite arriving RTP", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/media-encryption-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<button id="start">Start</button><script type="module" src="/harness.js"></script>',
    }),
  );
  await page.route("**/harness.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: harness }),
  );
  await page.route("**/sframe.worker.ts", (route) =>
    route.fulfill({ contentType: "application/javascript", body: worker }),
  );
  await page.goto("/media-encryption-harness");
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { runMediaEncryptionTest?: unknown })
        .runMediaEncryptionTest === "function",
  );
  await page.click("#start");
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        runMediaEncryptionTest: (
          legacy: boolean,
          wrongKey: boolean,
        ) => Promise<{
          a: { framesEncrypted: number; framesDecrypted: number };
          b: { framesEncrypted: number; framesDecrypted: number };
          pa: { received: number };
          pb: { received: number };
          samples: { rms: number }[];
        }>;
      }
    ).runMediaEncryptionTest(false, true),
  );
  for (const stats of [result.a, result.b]) {
    expect(stats.framesEncrypted).toBeGreaterThan(0);
    expect(stats.framesDecrypted).toBe(0);
  }
  expect(result.pa.received).toBeGreaterThan(0);
  expect(result.pb.received).toBeGreaterThan(0);
  for (const sample of result.samples) expect(sample.rms).toBe(0);
  expect(errors).toEqual([]);
  mkdirSync(resolve("test-results/media-encryption-proof"), {
    recursive: true,
  });
  writeFileSync(
    resolve("test-results/media-encryption-proof/wrong-key.json"),
    JSON.stringify(result, null, 2),
  );
});

for (const dropPercent of [0, 1, 3, 5])
  test(`same voice fixture with ${dropPercent}% encoded-frame impairment and 8ms jitter`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const impairment = `let frameNumber=0;Object.defineProperty(globalThis,"onrtctransform",{configurable:true,set(handler){globalThis.addEventListener("rtctransform",event=>{const transformer=event.transformer;if(transformer.options.operation!=="encrypt"){handler(event);return;}const impaired=transformer.readable.pipeThrough(new TransformStream({async transform(frame,controller){frameNumber++;if((frameNumber*37)%100<${dropPercent})return;await new Promise(resolve=>setTimeout(resolve,(frameNumber*13)%9));controller.enqueue(frame);}}));handler({transformer:{options:transformer.options,readable:impaired,writable:transformer.writable}});});}});`;
    await page.route("**/media-encryption-harness", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<button id="start">Start</button><script type="module" src="/harness.js"></script>',
      }),
    );
    await page.route("**/harness.js", (route) =>
      route.fulfill({ contentType: "application/javascript", body: harness }),
    );
    await page.route("**/sframe.worker.ts", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: impairment + worker,
      }),
    );
    await page.route("**/voice-fixture.wav", (route) =>
      route.fulfill({
        contentType: "audio/wav",
        body: readFileSync(resolve("e2e/fixtures/audio/noisy_2s_48k.wav")),
      }),
    );
    await page.goto("/media-encryption-harness");
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { runMediaQualityTest?: unknown })
          .runMediaQualityTest === "function",
    );
    await page.click("#start");
    const result = await page.evaluate(() =>
      (
        window as unknown as {
          runMediaQualityTest: () => Promise<{
            cipher: { framesEncrypted: number };
            decoder: { framesDecrypted: number };
            codec: string;
            pair: unknown;
            inbound: { bytesReceived: number };
            latencyMs: number;
            correlation: number;
            recordings: { source: string; received: string };
          }>;
        }
      ).runMediaQualityTest(),
    );
    const path = resolve("test-results/media-encryption-proof");
    mkdirSync(path, { recursive: true });
    writeFileSync(
      resolve(path, `encoded-impairment-${dropPercent}-source.wav`),
      Buffer.from(result.recordings.source, "base64"),
    );
    writeFileSync(
      resolve(path, `encoded-impairment-${dropPercent}-received.wav`),
      Buffer.from(result.recordings.received, "base64"),
    );
    const { recordings, ...proof } = result;
    writeFileSync(
      resolve(path, `encoded-impairment-${dropPercent}.json`),
      JSON.stringify(
        { ...proof, dropPercent, transformJitterMaxMs: 8 },
        null,
        2,
      ),
    );
    expect(result.cipher.framesEncrypted).toBeGreaterThan(0);
    expect(result.decoder.framesDecrypted).toBeGreaterThan(0);
    expect(result.inbound.bytesReceived).toBeGreaterThan(0);
    expect(result.codec).toBe("audio/opus");
    expect(result.pair).toBeTruthy();
    expect(result.correlation).toBeGreaterThan(0.1);
    expect(errors).toEqual([]);
  });

for (const requestedCodec of ["h264", "vp8", "vp9", "av1"])
  test(`encrypted ${requestedCodec.toUpperCase()} video decrypts into real decoded pixels`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/media-video-harness", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<script type="module" src="/harness.js"></script>',
      }),
    );
    await page.route("**/harness.js", (route) =>
      route.fulfill({ contentType: "application/javascript", body: harness }),
    );
    await page.route("**/sframe.worker.ts", (route) =>
      route.fulfill({ contentType: "application/javascript", body: worker }),
    );
    await page.goto("/media-video-harness");
    await page.waitForFunction(
      () => typeof (window as any).runEncryptedVideoTest === "function",
    );
    const proof = (await page.evaluate(
      (codec) => (window as any).runEncryptedVideoTest(codec),
      requestedCodec,
    )) as {
      sender: { framesEncrypted: number };
      receiver: { framesDecrypted: number };
      received: number;
      framesDecoded: number;
      repair: { codec: boolean; separateSsrc: boolean };
      codec: string;
      pair: unknown;
      width: number;
      height: number;
      pixel: number[];
    };
    expect(proof.sender.framesEncrypted).toBeGreaterThan(0);
    expect(proof.receiver.framesDecrypted).toBeGreaterThan(0);
    expect(proof.received).toBeGreaterThan(0);
    expect(proof.framesDecoded).toBeGreaterThan(5);
    expect(proof.repair).toEqual({ codec: true, separateSsrc: true });
    expect(proof.codec.toLowerCase()).toBe(`video/${requestedCodec}`);
    expect(proof.pair).toBeTruthy();
    expect([proof.width, proof.height]).toEqual([320, 180]);
    [35, 165, 90].forEach((value, index) =>
      expect(Math.abs(proof.pixel[index] - value)).toBeLessThan(12),
    );
    expect(errors).toEqual([]);
    const body = JSON.stringify(proof, null, 2);
    mkdirSync(resolve("test-results/media-encryption-proof"), {
      recursive: true,
    });
    writeFileSync(
      resolve(
        `test-results/media-encryption-proof/video-${requestedCodec}.json`,
      ),
      body,
    );
    await testInfo.attach("encrypted-video-proof.json", {
      body,
      contentType: "application/json",
    });
  });
