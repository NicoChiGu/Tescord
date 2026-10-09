/** Codec routing headers remain visible and are authenticated as SFrame metadata.
 * The encrypted payload is an RFC 9605 packet; H26x ciphertext uses RBSP escaping
 * so the WebRTC packetizer cannot mistake random ciphertext for NAL boundaries. */
export interface EncodedFrameLayout {
  header: Uint8Array;
  payload: Uint8Array;
  rbsp: boolean;
  wrapper?: boolean;
}
export type MediaTransformControl =
  | { type: "sender-key"; keyId: number; key: Uint8Array; generation: number }
  | { type: "receiver-key"; keyId: number; key: Uint8Array; requestId?: number }
  | { type: "pause" | "resume" | "clear-keys" }
  | { type: "codecs"; codecs: { payloadType: number; mimeType: string }[] };
export type MediaTransformEvent =
  | { type: "key-installed"; requestId: number }
  | { type: "stats"; encrypted: number; decrypted: number; replay: number }
  | { type: "fatal"; error: string }
  | { type: "codecs-needed" };
function av1Prefix(data: Uint8Array): { header: Uint8Array; offset: number } {
  const prefix: number[] = [];
  let offset = 0;
  while (offset < data.length) {
    const start = offset,
      first = data[offset],
      type = (first >> 3) & 15;
    if (first & 0x81 || ![1, 2, 15].includes(type) || !(first & 2)) break;
    offset++;
    if (first & 4) offset++;
    let length = 0,
      shift = 0,
      complete = false;
    for (; offset < data.length && shift < 35; shift += 7) {
      const byte = data[offset++];
      length += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) {
        complete = true;
        break;
      }
    }
    if (!complete || offset + length > data.length)
      throw new Error("MEDIA_KEY_INVALID");
    offset += length;
    // Temporal delimiters and padding are discarded by WebRTC packetization.
    if (type === 1) prefix.push(...data.slice(start, offset));
  }
  return { header: new Uint8Array(prefix), offset };
}
/** Preserve the three variable-length UE fields read by WebRTC's H264
 * depacketizer: first_mb_in_slice, slice_type, pic_parameter_set_id. */
function h264SliceHeaderEnd(data: Uint8Array, nalStart: number): number {
  const bytes: number[] = [],
    positions: number[] = [];
  for (let at = nalStart + 1; at < Math.min(data.length, nalStart + 65); at++) {
    if (
      at >= nalStart + 3 &&
      data[at - 2] === 0 &&
      data[at - 1] === 0 &&
      data[at] === 3 &&
      data[at + 1] <= 3
    )
      continue;
    bytes.push(data[at]);
    positions.push(at);
  }
  let bit = 0;
  const readBit = (): number => {
    if (bit >= bytes.length * 8) throw new Error("MEDIA_KEY_INVALID");
    const value = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
    bit++;
    return value;
  };
  for (let field = 0; field < 3; field++) {
    let zeros = 0;
    while (readBit() === 0) {
      if (++zeros > 31) throw new Error("MEDIA_KEY_INVALID");
    }
    for (let suffix = 0; suffix < zeros; suffix++) readBit();
  }
  return positions[Math.ceil(bit / 8) - 1] + 1;
}
export function encodedFrameLayout(
  data: Uint8Array,
  kind: "audio" | "video",
  codec?: string,
  frameType?: string,
  decoding = false,
): EncodedFrameLayout {
  if (kind === "audio")
    return { header: new Uint8Array(0), payload: data, rbsp: false };
  const name = codec?.toLowerCase().replace("video/", "");
  if (name === "av1") {
    // A single OBU_FRAME transports the opaque SFrame packet. Depacketizers may
    // restore an OBU size field, which is transport framing, not SFrame metadata.
    const prefix = av1Prefix(data);
    let payload = data;
    if (decoding) {
      if ((data[prefix.offset] & 0xfd) !== 0x30)
        throw new Error("MEDIA_KEY_INVALID");
      let offset = prefix.offset + 1;
      if (data[prefix.offset] & 2) {
        let length = 0,
          shift = 0,
          complete = false;
        for (; offset < data.length && shift < 35; shift += 7) {
          const byte = data[offset++];
          length += (byte & 127) * 2 ** shift;
          if (!(byte & 128)) {
            complete = true;
            break;
          }
        }
        if (!complete || length !== data.length - offset)
          throw new Error("MEDIA_KEY_INVALID");
      }
      payload = data.slice(offset);
    }
    return {
      header: joinMediaFrame(prefix.header, new Uint8Array([0x30])),
      payload,
      rbsp: false,
      wrapper: true,
    };
  }
  let length = 0,
    rbsp = false;
  if (name === "h264" || name === "h265" || name === "hevc") {
    rbsp = true;
    for (let offset = 0; offset + 5 < data.length; offset++) {
      if (data[offset] || data[offset + 1]) continue;
      const start =
        data[offset + 2] === 1
          ? offset + 3
          : data[offset + 2] === 0 && data[offset + 3] === 1
            ? offset + 4
            : -1;
      if (start < 0) continue;
      const type = name === "h264" ? data[start] & 31 : (data[start] >> 1) & 63;
      if (name === "h264" ? type === 1 || type === 5 : type <= 31) {
        length = name === "h264" ? h264SliceHeaderEnd(data, start) : start + 2;
        break;
      }
    }
    if (!length) throw new Error("MEDIA_E2EE_UNSUPPORTED");
  } else if (name === "vp8") length = frameType === "key" ? 10 : 3;
  else if (name !== "vp9") throw new Error("MEDIA_E2EE_UNSUPPORTED");
  if (data.length <= length) throw new Error("MEDIA_KEY_INVALID");
  return { header: data.slice(0, length), payload: data.slice(length), rbsp };
}
export function escapeMediaRbsp(data: Uint8Array): Uint8Array {
  const result: number[] = [];
  let zeros = 0;
  for (const byte of data) {
    if (zeros >= 2 && byte <= 3) {
      result.push(3);
      zeros = 0;
    }
    result.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return new Uint8Array(result);
}
export function unescapeMediaRbsp(data: Uint8Array): Uint8Array {
  const result: number[] = [];
  for (let index = 0; index < data.length; index++) {
    if (
      index + 3 < data.length &&
      data[index] === 0 &&
      data[index + 1] === 0 &&
      data[index + 2] === 3 &&
      data[index + 3] <= 3
    ) {
      result.push(0, 0);
      index += 2;
    } else result.push(data[index]);
  }
  return new Uint8Array(result);
}
export function joinMediaFrame(
  header: Uint8Array,
  payload: Uint8Array,
): Uint8Array {
  const result = new Uint8Array(header.length + payload.length);
  result.set(header);
  result.set(payload, header.length);
  return result;
}
