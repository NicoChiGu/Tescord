import { expect, test } from "@playwright/test";

test("真实 Chromium PeerConnection 直连产生媒体字节、解码帧和一致编解码", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const sender = new RTCPeerConnection({ iceServers: [] });
    const receiver = new RTCPeerConnection({ iceServers: [] });
    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { width: 320, height: 240, frameRate: 15 },
    });
    const remoteVideo = document.createElement("video");
    remoteVideo.autoplay = true;
    remoteVideo.muted = true;
    remoteVideo.playsInline = true;
    const remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;
    document.body.appendChild(remoteVideo);

    const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 12_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Timed out waiting for real WebRTC media flow");
    };
    const waitForIceGathering = async (pc: RTCPeerConnection) => {
      if (pc.iceGatheringState === "complete") return;
      await new Promise<void>((resolve) => {
        const listener = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", listener);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", listener);
      });
    };

    try {
      receiver.ontrack = (event) => {
        remoteStream.addTrack(event.track);
        void remoteVideo.play().catch(() => undefined);
      };
      localStream.getTracks().forEach((track) => sender.addTrack(track, localStream));

      await sender.setLocalDescription(await sender.createOffer());
      await waitForIceGathering(sender);
      await receiver.setRemoteDescription(sender.localDescription!);
      await receiver.setLocalDescription(await receiver.createAnswer());
      await waitForIceGathering(receiver);
      await sender.setRemoteDescription(receiver.localDescription!);

      await waitFor(
        () =>
          sender.connectionState === "connected" &&
          receiver.connectionState === "connected",
      );

      let outbound: RTCOutboundRtpStreamStats | undefined;
      let inbound: RTCInboundRtpStreamStats | undefined;
      let sendCodec = "";
      let receiveCodec = "";
      let localCandidateType = "";
      let remoteCandidateType = "";
      let protocol = "";

      await waitFor(async () => {
        const [sendReport, receiveReport] = await Promise.all([
          sender.getStats(),
          receiver.getStats(),
        ]);
        outbound = Array.from(sendReport.values()).find(
          (stat) =>
            stat.type === "outbound-rtp" &&
            stat.kind === "video" &&
            !stat.isRemote,
        ) as RTCOutboundRtpStreamStats | undefined;
        inbound = Array.from(receiveReport.values()).find(
          (stat) =>
            stat.type === "inbound-rtp" &&
            stat.kind === "video" &&
            !stat.isRemote,
        ) as RTCInboundRtpStreamStats | undefined;

        const sendCodecStat = outbound?.codecId
          ? sendReport.get(outbound.codecId)
          : undefined;
        const receiveCodecStat = inbound?.codecId
          ? receiveReport.get(inbound.codecId)
          : undefined;
        sendCodec = sendCodecStat?.mimeType || "";
        receiveCodec = receiveCodecStat?.mimeType || "";

        let selectedPairId = "";
        sendReport.forEach((stat) => {
          if (stat.type === "transport" && stat.selectedCandidatePairId) {
            selectedPairId = stat.selectedCandidatePairId;
          }
        });
        const pair = selectedPairId
          ? sendReport.get(selectedPairId)
          : Array.from(sendReport.values()).find(
              (stat) =>
                stat.type === "candidate-pair" &&
                stat.nominated &&
                stat.state === "succeeded",
            );
        if (pair) {
          const local = sendReport.get(pair.localCandidateId);
          const remote = sendReport.get(pair.remoteCandidateId);
          localCandidateType = local?.candidateType || "";
          remoteCandidateType = remote?.candidateType || "";
          protocol = (local?.protocol || remote?.protocol || "").toUpperCase();
        }

        return Boolean(
          outbound &&
            inbound &&
            outbound.bytesSent > 0 &&
            inbound.bytesReceived > 0 &&
            (inbound.framesDecoded || 0) > 0 &&
            sendCodec &&
            receiveCodec &&
            localCandidateType &&
            remoteCandidateType,
        );
      });

      return {
        bytesSent: outbound!.bytesSent,
        bytesReceived: inbound!.bytesReceived,
        framesEncoded: outbound!.framesEncoded || 0,
        framesDecoded: inbound!.framesDecoded || 0,
        sendCodec,
        receiveCodec,
        localCandidateType,
        remoteCandidateType,
        protocol,
      };
    } finally {
      sender.close();
      receiver.close();
      localStream.getTracks().forEach((track) => track.stop());
      remoteStream.getTracks().forEach((track) => track.stop());
      remoteVideo.remove();
    }
  });

  expect(result.bytesSent).toBeGreaterThan(0);
  expect(result.bytesReceived).toBeGreaterThan(0);
  expect(result.framesEncoded).toBeGreaterThan(0);
  expect(result.framesDecoded).toBeGreaterThan(0);
  expect(result.sendCodec).toBe(result.receiveCodec);
  expect(result.sendCodec).toMatch(/^video\/(VP8|VP9|H264|AV1|H265)$/i);
  expect(result.sendCodec).not.toMatch(/rtx|red|ulpfec|flexfec/i);
  expect(result.localCandidateType).toBe("host");
  expect(result.remoteCandidateType).toBe("host");
  expect(["UDP", "TCP"]).toContain(result.protocol);
});
