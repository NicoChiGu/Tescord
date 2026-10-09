import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export async function buildAudioOutputHarness(): Promise<string> {
  const require = createRequire(resolve("apps/server/package.json"));
  const { build } = require(
    require.resolve("esbuild", { paths: [dirname(require.resolve("tsx"))] }),
  );
  const worker = await build({
    entryPoints: [
      require.resolve("livekit-client/e2ee-worker", {
        paths: [resolve("apps/web")],
      }),
    ],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    logLevel: "silent",
  });
  const result = await build({
    stdin: {
      contents: script,
      resolveDir: process.cwd(),
      sourcefile: "audio-output-acceptance.ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
    nodePaths: [resolve("apps/web/node_modules")],
    logLevel: "silent",
    plugins: [
      {
        name: "vite-worker-import",
        setup(builder: {
          onResolve: (
            filter: { filter: RegExp },
            callback: () => unknown,
          ) => void;
          onLoad: (
            filter: { filter: RegExp; namespace: string },
            callback: () => unknown,
          ) => void;
        }) {
          builder.onResolve({ filter: /\?worker$/ }, () => ({
            path: "livekit-worker",
            namespace: "worker-wrapper",
          }));
          builder.onLoad({ filter: /.*/, namespace: "worker-wrapper" }, () => ({
            contents: `export default class extends Worker { constructor() { super(URL.createObjectURL(new Blob([${JSON.stringify(worker.outputFiles[0].text)}], { type: "text/javascript" }))); } }`,
            loader: "js",
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

const script = `
import { audioOutput } from "./apps/web/src/services/audioOutput.ts";
import { audioEngine } from "./apps/web/src/services/audioEngine.ts";
import { voiceMeshManager } from "./apps/web/src/services/p2p/VoiceMeshManager.ts";
import { livekitService } from "./apps/web/src/services/livekit.ts";
import { cloudflareRealtimeService as cf } from "./apps/web/src/services/cloudflare_realtime/index.ts";
import { useSettingsStore } from "./apps/web/src/stores/useSettingsStore.ts";
import { SFrameManager } from "./apps/web/src/services/sframe.ts";
import { Room, RemoteAudioTrack } from "livekit-client";
import React from "react";
import { createRoot } from "react-dom/client";
import { UserContextMenu } from "./apps/web/src/components/context-menu/UserContextMenu.tsx";
import i18n from "./apps/web/src/i18n/index.ts";

window.audioOutputTest = { audioOutput, audioEngine, livekitService, voiceMeshManager, cf, settings: useSettingsStore };
window.mountAudioOutputUserMenu = async () => {
  await i18n.changeLanguage("zh-CN");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  root.render(React.createElement(UserContextMenu, { targetUser: { id: "target", username: "Audio target" }, isInVoice: true }, React.createElement("button", { id: "audio-target-menu" }, "Audio target")));
};
window.runAudioOutputAcceptance = async (mode) => {
  const isLiveKit = mode.startsWith("livekit"), isScreen = mode === "screen" || mode === "livekit-screen";
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ctx = new AudioContext(), oscillators = [], pcs = [], ciphers = [], nodes = [], received = [], elements = [];
  const sdkRoom = isLiveKit ? new Room() : null;
  const subscribeLiveKit = (connection, identity) => {
    const mediaTrack = connection.stream.getAudioTracks()[0];
    const track = new RemoteAudioTrack(mediaTrack, mediaTrack.id, connection.receiver.getReceivers()[0]);
    track.source = isScreen ? "screen_share_audio" : "microphone";
    sdkRoom.remoteParticipants.set(identity, { audioTrackPublications: new Map([[track.sid, { track }]]) });
    livekitService.handleRemoteAudioSubscribed(track, { identity });
    return livekitService.participantAudioMap.get(identity).tracks.get(track.sid);
  };
  const originalTransform = window.RTCRtpScriptTransform;
  const originalSink = AudioContext.prototype.setSinkId;
  if(mode === "mesh-fallback") Object.defineProperty(AudioContext.prototype, "setSinkId", { configurable: true, value: undefined });
  Object.defineProperty(window, "RTCRtpScriptTransform", { value: undefined, configurable: true, writable: true });
  const makeConnection = async (frequency) => {
    const oscillator = ctx.createOscillator(), low = ctx.createGain(), destination = ctx.createMediaStreamDestination();
    oscillator.frequency.value = frequency; low.gain.value = .025;
    oscillator.connect(low).connect(destination); oscillator.start(); oscillators.push(oscillator); nodes.push(low);
    const sender = new RTCPeerConnection({ encodedInsertableStreams: true }), receiver = new RTCPeerConnection({ encodedInsertableStreams: true });
    pcs.push(sender, receiver);
    const cipher = new SFrameManager(), decipher = new SFrameManager(), key = crypto.getRandomValues(new Uint8Array(32));
    cipher.beginContext(async streamId => ({ streamId, key, keyId: frequency }));
    decipher.beginContext(async streamId => ({ streamId, key, keyId: frequency + 1 }));
    decipher.addReceiverKey(frequency, key); ciphers.push(cipher, decipher);
    let remote;
    receiver.ontrack = event => { decipher.attachReceiver(event.receiver); remote = event.streams[0] || new MediaStream([event.track]); };
    cipher.attachSender(sender.addTrack(destination.stream.getAudioTracks()[0], destination.stream));
    const gather = async pc => { const deadline = Date.now() + 5000; while(pc.iceGatheringState !== "complete") { if(Date.now() > deadline) throw Error("ICE timeout"); await wait(25); } };
    await sender.setLocalDescription(await sender.createOffer()); await gather(sender); await receiver.setRemoteDescription(sender.localDescription);
    await receiver.setLocalDescription(await receiver.createAnswer()); await gather(receiver); await sender.setRemoteDescription(receiver.localDescription);
    const deadline = Date.now() + 10000;
    while(!remote || receiver.connectionState !== "connected") { if(Date.now() > deadline) throw Error("Media timeout"); await wait(25); }
    const decoder = document.createElement("audio"); decoder.muted = true; decoder.srcObject = remote; document.body.append(decoder); await decoder.play(); elements.push(decoder);
    received.push(remote);
    return { stream: remote, localStream: destination.stream, sender, receiver, cipher, decipher };
  };
  const rms = analyser => { const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values); return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length); };
  let playbackContext, output, analyser, own, independent, releaseScreen;
  try {
    await ctx.resume();
    useSettingsStore.getState().setOutputVolume(100);
    useSettingsStore.getState().setUserVolume("target", 100);
    audioOutput.setDeafened(false);
    const connection = await makeConnection(440), other = await makeConnection(660);
    if(mode.startsWith("mesh")) {
      voiceMeshManager.attachRemoteAudio("target", connection.stream);
      playbackContext = voiceMeshManager.sharedAudioContext; output = voiceMeshManager.masterGain;
      own = voiceMeshManager.participantAudioMap.get("target").gainNode;
    } else if(isLiveKit) {
      const entry = subscribeLiveKit(connection, "target");
      playbackContext = livekitService.playbackAudioContext; output = livekitService.masterGainNode;
      own = entry.gainNode;
    } else {
      playbackContext = cf.getOrCreatePlaybackContext(); output = cf.masterGain;
      const source = playbackContext.createMediaStreamSource(connection.stream), gain = playbackContext.createGain();
      source.connect(gain).connect(output); nodes.push(source, gain); own = gain;
      const track = connection.stream.getAudioTracks()[0];
      cf.audioRoutes.set(track.id, { source, gain, track, publication: { userId: "target", source: mode === "screen" ? "screen-audio" : "microphone" } });
      cf.updatePlaybackGains();
    }
    await audioOutput.queue;
    await playbackContext.resume();
    analyser = playbackContext.createAnalyser(); analyser.fftSize = 4096; output.connect(analyser);
    let independentGain;
    if(mode.startsWith("mesh")) {
      voiceMeshManager.attachRemoteAudio("other", other.stream);
      independentGain = voiceMeshManager.participantAudioMap.get("other").gainNode;
    } else if(isLiveKit) {
      independentGain = subscribeLiveKit(other, "other").gainNode;
    } else {
      const source = playbackContext.createMediaStreamSource(other.stream), gain = playbackContext.createGain(), track = other.stream.getAudioTracks()[0];
      source.connect(gain).connect(output);
      cf.audioRoutes.set(track.id, { source, gain, track, publication: { userId: "other", source: mode === "screen" ? "screen-audio" : "microphone" } }); cf.updatePlaybackGains(); independentGain = gain;
    }
    independentGain.disconnect();
    const independentAnalyser = playbackContext.createAnalyser(); independentGain.connect(independentAnalyser);
    const silence = playbackContext.createGain(); silence.gain.value = 0; independentGain.connect(silence).connect(playbackContext.destination);
    independent = independentAnalyser; nodes.push(independentAnalyser, silence);
    const sample = async () => { await wait(350); return { output: rms(analyser), independent: rms(independent) }; };
    await wait(1200);
    const volumes = {};
    for(const value of [100, 50, 200]) {
      if(isScreen) cf.setStreamVolume("target", value); else livekitService.setParticipantVolume("target", value);
      volumes[value] = await sample();
    }
    livekitService.setParticipantMuted("target", true);
    if(isScreen) cf.setStreamVolume("target", 150); else livekitService.setParticipantVolume("target", 150);
    const participantMuted = await sample();
    livekitService.setParticipantMuted("target", false);
    if(isScreen) cf.setStreamVolume("target", 200); else livekitService.setParticipantVolume("target", 200);
    const participantRestored = await sample();
    useSettingsStore.getState().setOutputVolume(50); const masterHalf = await sample();
    useSettingsStore.getState().setOutputVolume(0); const zero = await sample();
    audioOutput.setDeafened(true); useSettingsStore.getState().setOutputVolume(200);
    const deaf = await sample();
    let sdkResume;
    if(isLiveKit) {
      await sdkRoom.startAudio();
      const entries = [...livekitService.participantAudioMap.values()].flatMap(control => [...control.tracks.values()]);
      sdkResume = { decoderMuted: entries.every(entry => entry.element.muted), attachedElements: entries.reduce((count, entry) => count + entry.track.attachedElements.length, 0) };
      livekitService.room = sdkRoom;
      sdkResume.resumed = await livekitService.resumeAudio();
      sdkResume.output = (await sample()).output;
      livekitService.room = null;
    }
    let removeLate;
    if(mode.startsWith("mesh")) {
      voiceMeshManager.attachRemoteAudio("late-peer", other.stream);
      removeLate = () => voiceMeshManager.closePeer("late-peer");
    } else if(isLiveKit) {
      subscribeLiveKit(other, "late-peer");
      removeLate = () => livekitService.handleRemoteAudioUnsubscribed("late-peer");
    } else {
      const source = playbackContext.createMediaStreamSource(other.stream), gain = playbackContext.createGain(), track = other.stream.getAudioTracks()[0];
      source.connect(gain).connect(output);
      cf.audioRoutes.set("late-peer", { source, gain, track, publication: { userId: "late-peer", source: mode === "screen" ? "screen-audio" : "microphone" } }); cf.updatePlaybackGains();
      removeLate = () => { source.disconnect(); gain.disconnect(); cf.audioRoutes.delete("late-peer"); };
    }
    const lateRoute = (await sample()).output; removeLate();
    // Newly attached nodes must inherit refusal before their first audible sample.
    const lateGain = playbackContext.createGain(), lateSource = playbackContext.createMediaStreamSource(other.stream), lateAnalyser = playbackContext.createAnalyser();
    const lateBinding = audioOutput.register(playbackContext, lateGain);
    lateSource.connect(lateGain); lateGain.connect(lateAnalyser); await lateBinding.ready;
    await wait(350); const late = rms(lateAnalyser);
    lateSource.disconnect(); lateAnalyser.disconnect(); lateBinding.dispose();
    audioEngine.setMute(true); audioOutput.setDeafened(false); useSettingsStore.getState().setOutputVolume(100);
    const restored = await sample();
    // Exercise the actual capture-output track gate across encrypted RTP.
    audioEngine.processedStream = other.localStream;
    audioEngine.setMute(true); const microphoneMuted = await sample();
    audioEngine.setMute(false); const microphoneRestored = await sample();
    audioEngine.processedStream = null;
    const reports = await connection.receiver.getStats();
    const transport = [...reports.values()].find(report => report.type === "transport" && report.selectedCandidatePairId);
    const pair = transport ? reports.get(transport.selectedCandidatePairId) : [...reports.values()].find(report => report.type === "candidate-pair" && report.nominated && report.state === "succeeded");
    const inbound = [...reports.values()].find(report => report.type === "inbound-rtp" && report.kind === "audio");
    const sent = await connection.sender.getStats(), outbound = [...sent.values()].find(report => report.type === "outbound-rtp" && report.kind === "audio");
    const local = reports.get(pair?.localCandidateId), remote = reports.get(pair?.remoteCandidateId);
    return { mode, volumes, participantMuted, participantRestored, masterHalf, zero, deaf, sdkResume, late, lateRoute, restored, microphoneMuted, microphoneRestored, rtp: { bytesSent: outbound?.bytesSent, bytesReceived: inbound?.bytesReceived, codec: reports.get(inbound?.codecId)?.mimeType, candidate: local?.candidateType, selectedPair: { id: pair?.id, state: pair?.state, nominated: pair?.nominated, local: { type: local?.candidateType, protocol: local?.protocol, address: local?.address, port: local?.port }, remote: { type: remote?.candidateType, protocol: remote?.protocol, address: remote?.address, port: remote?.port } } }, crypto: { send: connection.cipher.getStats(), receive: connection.decipher.getStats() } };
  } finally {
    Object.defineProperty(window, "RTCRtpScriptTransform", { value: originalTransform, configurable: true, writable: true });
    Object.defineProperty(AudioContext.prototype, "setSinkId", { value: originalSink, configurable: true, writable: true });
    audioOutput.setDeafened(false); livekitService.setParticipantMuted("target", false); audioEngine.setMute(false); audioEngine.processedStream = null;
    livekitService.room = null;
    if(sdkRoom) { sdkRoom.remoteParticipants.clear(); await sdkRoom.audioContext?.close(); }
    for(const pc of pcs) pc.close(); for(const cipher of ciphers) cipher.disable();
    for(const oscillator of oscillators) oscillator.stop();
    for(const stream of received) stream.getTracks().forEach(track => track.stop());
    for(const node of nodes) node.disconnect();
    for(const element of elements) { element.pause(); element.srcObject = null; element.remove(); }
    analyser?.disconnect(); voiceMeshManager.stopAll(); await livekitService.leaveRoom(); await cf.disconnect();
    await ctx.close();
  }
};
`;
