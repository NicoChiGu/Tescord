import { chromium } from "playwright";

const appId = process.env.CLOUDFLARE_CALLS_APP_ID;
const appSecret = process.env.CLOUDFLARE_CALLS_APP_SECRET;
const turnKeyId = process.env.CLOUDFLARE_CALLS_TURN_KEY_ID;
const turnToken = process.env.CLOUDFLARE_CALLS_TURN_API_TOKEN;
if (!appId || !appSecret || !turnKeyId || !turnToken) {
  throw new Error("Set Cloudflare SFU and TURN credentials in the process environment");
}
const origin = process.env.TESCORD_MEDIA_TEST_ORIGIN || "https://tescord.terata.top/";
const base = "https://rtc.live.cloudflare.com/v1";

async function api(path, token, method = "POST", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.errorCode || result.tracks?.some((track) => track.errorCode)) {
    throw new Error(`Cloudflare ${path.split("/").at(-1)} failed: HTTP ${response.status}, code ${result.errorCode || result.tracks?.find((track) => track.errorCode)?.errorCode || "unknown"}`);
  }
  return result;
}

async function gather(page) {
  await page.waitForFunction(() => window.mediaPc.localDescription?.sdp?.includes("a=candidate:") || window.mediaPc.iceGatheringState === "complete", null, { timeout: 15_000 });
  if (!(await page.evaluate(() => window.mediaPc.localDescription?.sdp?.includes("a=candidate:")))) {
    throw new Error("No ICE candidates gathered");
  }
}

async function stats(page) {
  return page.evaluate(async () => {
    const report = await window.mediaPc.getStats();
    let outboundBytes = 0, inboundBytes = 0, codec = null, candidateType = null;
    for (const value of report.values()) {
      if (value.type === "outbound-rtp" && value.kind === "audio") { outboundBytes += value.bytesSent || 0; codec = report.get(value.codecId)?.mimeType || codec; }
      if (value.type === "inbound-rtp" && value.kind === "audio") { inboundBytes += value.bytesReceived || 0; codec = report.get(value.codecId)?.mimeType || codec; }
      if (value.type === "candidate-pair" && value.state === "succeeded" && value.nominated) {
        candidateType = report.get(value.localCandidateId)?.candidateType || null;
      }
    }
    return { state: window.mediaPc.connectionState, outboundBytes, inboundBytes, codec, candidateType };
  });
}

const browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const sender = await browser.newPage({ permissions: ["microphone"] });
const receiver = await browser.newPage({ permissions: ["microphone", "camera"] });
let senderSession;
let receiverSession;
try {
  const turn = await api(`/turn/keys/${turnKeyId}/credentials/generate-ice-servers`, turnToken, "POST", { ttl: 3600 });
  if (!Array.isArray(turn.iceServers) || turn.iceServers.length === 0) throw new Error("TURN returned no ICE servers");
  await Promise.all([sender.goto(origin), receiver.goto(origin)]);
  senderSession = (await api(`/apps/${appId}/sessions/new`, appSecret)).sessionId;
  receiverSession = (await api(`/apps/${appId}/sessions/new`, appSecret)).sessionId;
  if (!senderSession || !receiverSession) throw new Error("SFU returned no session ID");

  const publish = await sender.evaluate(async (iceServers) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" });
    window.mediaPc = pc;
    const transceiver = pc.addTransceiver(stream.getAudioTracks()[0], { direction: "sendonly", streams: [stream] });
    await pc.setLocalDescription(await pc.createOffer());
    return { mid: transceiver.mid };
  }, turn.iceServers);
  await gather(sender);
  const senderOffer = await sender.evaluate(() => window.mediaPc.localDescription.sdp);
  const trackName = `acceptance-${crypto.randomUUID()}`;
  const published = await api(`/apps/${appId}/sessions/${senderSession}/tracks/new`, appSecret, "POST", {
    sessionDescription: { type: "offer", sdp: senderOffer }, tracks: [{ location: "local", mid: publish.mid, trackName }],
  });
  await sender.evaluate((sdp) => window.mediaPc.setRemoteDescription({ type: "answer", sdp }), published.sessionDescription?.sdp);
  await sender.waitForFunction(() => window.mediaPc.connectionState === "connected", null, { timeout: 15_000 });

  await receiver.evaluate((iceServers) => {
    window.mediaPc = new RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" });
    window.mediaPc.ontrack = (event) => { window.receivedTrack = event.track; };
  }, turn.iceServers);
  const subscribed = await api(`/apps/${appId}/sessions/${receiverSession}/tracks/new`, appSecret, "POST", {
    tracks: [{ location: "remote", sessionId: senderSession, trackName }],
  });
  if (!subscribed.sessionDescription?.sdp) throw new Error("SFU returned no subscription offer");
  await receiver.evaluate(async (sdp) => {
    await window.mediaPc.setRemoteDescription({ type: "offer", sdp });
    await window.mediaPc.setLocalDescription(await window.mediaPc.createAnswer());
  }, subscribed.sessionDescription.sdp);
  await gather(receiver);
  const answer = await receiver.evaluate(() => window.mediaPc.localDescription.sdp);
  await api(`/apps/${appId}/sessions/${receiverSession}/renegotiate`, appSecret, "PUT", { sessionDescription: { type: "answer", sdp: answer } });
  await receiver.waitForFunction(() => window.mediaPc.connectionState === "connected" && window.receivedTrack?.readyState === "live", null, { timeout: 15_000 });
  await receiver.waitForFunction(async () => {
    const report = await window.mediaPc.getStats();
    return [...report.values()].some((value) => value.type === "inbound-rtp" && value.kind === "audio" && value.bytesReceived > 1000);
  }, null, { timeout: 15_000 });
  const firstSender = await stats(sender);
  const firstReceiver = await stats(receiver);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const secondSender = await stats(sender);
  const secondReceiver = await stats(receiver);
  if (secondSender.outboundBytes <= firstSender.outboundBytes || secondReceiver.inboundBytes <= firstReceiver.inboundBytes || secondReceiver.candidateType !== "relay") {
    throw new Error("Media bytes did not advance over a selected TURN relay pair");
  }
  const reverseTracks = await receiver.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    const audio = window.mediaPc.addTransceiver(stream.getAudioTracks()[0], { direction: "sendonly", streams: [stream] });
    const video = window.mediaPc.addTransceiver(stream.getVideoTracks()[0], { direction: "sendonly", streams: [stream] });
    await window.mediaPc.setLocalDescription(await window.mediaPc.createOffer());
    return { audioMid: audio.mid, videoMid: video.mid };
  });
  await gather(receiver);
  const reverseOffer = await receiver.evaluate(() => window.mediaPc.localDescription.sdp);
  const reverseAudioName = `acceptance-audio-${crypto.randomUUID()}`;
  const reverseVideoName = `acceptance-video-${crypto.randomUUID()}`;
  const reversePublished = await api(`/apps/${appId}/sessions/${receiverSession}/tracks/new`, appSecret, "POST", {
    sessionDescription: { type: "offer", sdp: reverseOffer },
    tracks: [
      { location: "local", mid: reverseTracks.audioMid, trackName: reverseAudioName },
      { location: "local", mid: reverseTracks.videoMid, trackName: reverseVideoName },
    ],
  });
  await receiver.evaluate((sdp) => window.mediaPc.setRemoteDescription({ type: "answer", sdp }), reversePublished.sessionDescription?.sdp);

  await sender.evaluate(() => { window.mediaPc.ontrack = (event) => { (window.receivedTracks ||= []).push(event.track); }; });
  const reverseSubscribed = await api(`/apps/${appId}/sessions/${senderSession}/tracks/new`, appSecret, "POST", {
    tracks: [
      { location: "remote", sessionId: receiverSession, trackName: reverseAudioName },
      { location: "remote", sessionId: receiverSession, trackName: reverseVideoName },
    ],
  });
  await sender.evaluate(async (sdp) => {
    await window.mediaPc.setRemoteDescription({ type: "offer", sdp });
    await window.mediaPc.setLocalDescription(await window.mediaPc.createAnswer());
  }, reverseSubscribed.sessionDescription?.sdp);
  await gather(sender);
  const reverseAnswer = await sender.evaluate(() => window.mediaPc.localDescription.sdp);
  await api(`/apps/${appId}/sessions/${senderSession}/renegotiate`, appSecret, "PUT", { sessionDescription: { type: "answer", sdp: reverseAnswer } });
  await sender.waitForFunction(async () => {
    const report = await window.mediaPc.getStats();
    const inbound = [...report.values()].filter((value) => value.type === "inbound-rtp");
    return inbound.some((value) => value.kind === "audio" && value.bytesReceived > 1000) && inbound.some((value) => value.kind === "video" && value.framesDecoded > 0);
  }, null, { timeout: 20_000 });
  const reverseFirst = await sender.evaluate(async () => {
    const report = await window.mediaPc.getStats();
    return [...report.values()].filter((value) => value.type === "inbound-rtp").map((value) => ({ kind: value.kind, bytes: value.bytesReceived || 0, frames: value.framesDecoded || 0, codec: report.get(value.codecId)?.mimeType || null }));
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const reverseSecond = await sender.evaluate(async () => {
    const report = await window.mediaPc.getStats();
    return [...report.values()].filter((value) => value.type === "inbound-rtp").map((value) => ({ kind: value.kind, bytes: value.bytesReceived || 0, frames: value.framesDecoded || 0, codec: report.get(value.codecId)?.mimeType || null }));
  });
  for (const kind of ["audio", "video"]) {
    if ((reverseSecond.find((value) => value.kind === kind)?.bytes || 0) <= (reverseFirst.find((value) => value.kind === kind)?.bytes || 0)) throw new Error(`Reverse ${kind} bytes did not increase`);
  }
  process.stdout.write(`${JSON.stringify({ result: "PASS", sender: secondSender, receiver: secondReceiver, deltas: { outbound: secondSender.outboundBytes - firstSender.outboundBytes, inbound: secondReceiver.inboundBytes - firstReceiver.inboundBytes }, reverse: reverseSecond })}\n`);
} finally {
  await sender.close();
  await receiver.close();
  await browser.close();
  // Closing the peer connections ends media; Cloudflare expires the temporary sessions.
}
