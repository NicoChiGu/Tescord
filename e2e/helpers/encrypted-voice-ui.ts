import type { Page } from "@playwright/test";

/** UI fixtures use the real signed Gateway/device/context path in a single-peer
 * P2P room. Separate RTP tests prove the media; no fabricated LiveKit token is
 * treated as a successful unencrypted connection here. */
export async function installEncryptedVoiceUi(page: Page): Promise<void> {
  await page.routeWebSocket("**/gateway", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (typeof message !== "string") return socket.send(message);
      const event = JSON.parse(message);
      if (event.t === "READY" && Array.isArray(event.d?.guilds)) {
        event.d.guilds = event.d.guilds.map(
          (guild: { channels?: { type: string; voiceMode?: string }[] }) => ({
            ...guild,
            channels: guild.channels?.map((channel) =>
              channel.type === "VOICE"
                ? { ...channel, voiceMode: "p2p_mesh" }
                : channel,
            ),
          }),
        );
        socket.send(JSON.stringify(event));
      } else socket.send(message);
    });
  });
  await page.addInitScript(() => {
    const api = (
      window as unknown as {
        electronAPI?: {
          getDesktopSources?: () => Promise<{ id: string }[]>;
          prepareDisplayCapture?: unknown;
        };
      }
    ).electronAPI;
    if (api?.getDesktopSources && !api.prepareDisplayCapture) {
      api.prepareDisplayCapture = async ({
        sourceId,
        captureAudio,
      }: {
        sourceId: string;
        captureAudio: boolean;
      }) => {
        if (
          !(await api.getDesktopSources!()).some(
            (source) => source.id === sourceId,
          )
        )
          throw new Error("Unknown display source");
        return {
          grantId: crypto.randomUUID(),
          sourceId,
          audioScope: "none",
          reason: captureAudio ? "unsupported" : undefined,
        };
      };
    }
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      if (
        url.pathname !== "/api/guilds" ||
        !response.ok ||
        (init?.method || "GET") !== "GET"
      )
        return response;
      const guilds: unknown = await response.clone().json();
      if (!Array.isArray(guilds)) return response;
      const updated = guilds.map((guild) => ({
        ...guild,
        channels: guild.channels?.map((channel: { type: string }) =>
          channel.type === "VOICE"
            ? { ...channel, voiceMode: "p2p_mesh" }
            : channel,
        ),
      }));
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(JSON.stringify(updated), {
        status: response.status,
        headers,
      });
    };
    const originalCapture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await originalCapture(constraints);
      if (
        !constraints?.audio ||
        constraints.video ||
        stream.getAudioTracks().length
      )
        return stream;
      stream.getTracks().forEach((track) => track.stop());
      const context = new AudioContext();
      const tone = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.02;
      const destination = context.createMediaStreamDestination();
      tone.connect(gain).connect(destination);
      tone.start();
      await context.resume();
      const track = destination.stream.getAudioTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => {
        stop();
        tone.stop();
        void context.close();
      };
      return destination.stream;
    };
  });
}
