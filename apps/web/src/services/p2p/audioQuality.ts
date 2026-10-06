import type { AudioReceiveQuality } from "@tescord/types";
interface AudioRtpSnapshot {
  id: string;
  timestamp: number;
  packetsReceived?: number;
  packetsLost?: number;
  jitter?: number;
  jitterBufferDelay?: number;
  jitterBufferEmittedCount?: number;
  concealedSamples?: number;
  totalSamplesReceived?: number;
  bytesReceived?: number;
}
const delta = (
  current: number | undefined,
  prior: number | undefined,
): number => Math.max(0, (current || 0) - (prior || 0));
export class AudioQualitySampler {
  private prior = new Map<string, AudioRtpSnapshot>();
  private last = new Map<string, AudioReceiveQuality>();
  sample(snapshot: AudioRtpSnapshot): AudioReceiveQuality {
    const previous = this.prior.get(snapshot.id),
      latest = this.last.get(snapshot.id);
    if (previous && latest && snapshot.timestamp - previous.timestamp < 500)
      return latest;
    const monotonic =
      previous &&
      snapshot.timestamp > previous.timestamp &&
      (snapshot.bytesReceived || 0) >= (previous.bytesReceived || 0) &&
      (snapshot.packetsReceived || 0) >= (previous.packetsReceived || 0);
    const received = monotonic
      ? delta(snapshot.packetsReceived, previous.packetsReceived)
      : 0;
    const lost = monotonic
      ? delta(snapshot.packetsLost, previous.packetsLost)
      : 0;
    const emitted = monotonic
      ? delta(
          snapshot.jitterBufferEmittedCount,
          previous.jitterBufferEmittedCount,
        )
      : 0;
    const concealed = monotonic
      ? delta(snapshot.concealedSamples, previous.concealedSamples)
      : 0;
    const samples = monotonic
      ? delta(snapshot.totalSamplesReceived, previous.totalSamplesReceived)
      : 0;
    const quality: AudioReceiveQuality = {
      trackId: snapshot.id,
      timestamp: snapshot.timestamp,
      intervalMs: monotonic ? snapshot.timestamp - previous.timestamp : 0,
      packetsReceived: received,
      packetsLost: lost,
      packetLossPercent:
        received + lost ? (lost / (received + lost)) * 100 : undefined,
      jitterMs:
        typeof snapshot.jitter === "number"
          ? snapshot.jitter * 1000
          : undefined,
      jitterBufferDelayMs: emitted
        ? (delta(snapshot.jitterBufferDelay, previous?.jitterBufferDelay) /
            emitted) *
          1000
        : undefined,
      concealedSamples: concealed,
      concealmentPercent: samples ? (concealed / samples) * 100 : undefined,
      bytesReceived: monotonic
        ? delta(snapshot.bytesReceived, previous.bytesReceived)
        : 0,
    };
    this.prior.set(snapshot.id, { ...snapshot });
    this.last.set(snapshot.id, quality);
    return quality;
  }
  clear(): void {
    this.prior.clear();
    this.last.clear();
  }
}
/** Request Opus FEC and 20 ms speech frames without changing video negotiation. */
export function tuneOpusDescription<T extends RTCSessionDescriptionInit>(
  description: T,
): T {
  if (!description.sdp) return description;
  const sections = description.sdp.split(/(?=m=)/);
  description.sdp = sections
    .map((section) => {
      if (!section.startsWith("m=audio ")) return section;
      const opus = /a=rtpmap:(\d+) opus\/48000(?:\/2)?/i.exec(section);
      if (!opus) return section;
      const payload = opus[1],
        expression = new RegExp(`a=fmtp:${payload} ([^\\r\\n]*)`);
      const current = expression.exec(section)?.[1] || "";
      const parameters = new Map(
        current
          .split(";")
          .filter(Boolean)
          .map((item) => {
            const [name, ...value] = item.trim().split("=");
            return [name.toLowerCase(), value.join("=")];
          }),
      );
      for (const [name, value] of [
        ["useinbandfec", "1"],
        ["stereo", "0"],
        ["sprop-stereo", "0"],
        ["minptime", "20"],
      ])
        parameters.set(name, value);
      const fmtp = `a=fmtp:${payload} ${[...parameters].map(([name, value]) => `${name}=${value}`).join(";")}`;
      section = expression.test(section)
        ? section.replace(expression, fmtp)
        : section.replace(
            new RegExp(`(a=rtpmap:${payload} [^\\r\\n]*\\r?\\n)`),
            `$1${fmtp}\r\n`,
          );
      section = section.replace(/a=(?:maxptime|ptime):[^\r\n]*\r?\n/g, "");
      return `${section}a=ptime:20\r\na=maxptime:20\r\n`;
    })
    .join("");
  return description;
}
export async function adaptOpusSender(
  sender: RTCRtpSender,
  lossPercent: number | undefined,
): Promise<void> {
  if (sender.track?.kind !== "audio" || lossPercent === undefined) return;
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return;
  const maxBitrate =
    lossPercent >= 5
      ? 24_000
      : lossPercent >= 3
        ? 32_000
        : lossPercent >= 1
          ? 48_000
          : 64_000;
  if (parameters.encodings[0].maxBitrate === maxBitrate) return;
  parameters.encodings[0].maxBitrate = maxBitrate;
  try {
    await sender.setParameters(parameters);
  } catch {
    /* A renegotiating sender may temporarily reject parameters. */
  }
}
export function adaptReceiverBuffer(
  receiver: RTCRtpReceiver,
  quality: AudioReceiveQuality,
): void {
  const extended = receiver as RTCRtpReceiver & {
    jitterBufferTarget?: number;
    playoutDelayHint?: number;
  };
  const target = Math.min(
    80,
    Math.max(
      20,
      (quality.jitterMs || 0) * 2 +
        ((quality.packetLossPercent || 0) > 1 ? 30 : 20),
    ),
  );
  try {
    if ("jitterBufferTarget" in receiver) {
      extended.jitterBufferTarget = target;
      quality.receiverBufferTargetMs = target;
    } else if ("playoutDelayHint" in receiver) {
      extended.playoutDelayHint = target / 1000;
      quality.receiverBufferTargetMs = target;
    }
  } catch {
    /* Unsupported or clamped receiver hints do not prevent playback. */
  }
}
