import sharp from "sharp";
import type {
  GuildIconMetadata,
  GuildIconProcessRequest,
} from "@tescord/types";

export class GuildIconProcessor {
  private running = 0;
  private waiters: Array<() => void> = [];
  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= 2) {
      if (this.waiters.length >= 8) throw new Error("RATE_LIMITED");
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter((waiter) => waiter !== ready);
          reject(new Error("RATE_LIMITED"));
        }, 30_000);
        this.waiters.push(ready);
      });
    } else this.running++;
    try {
      return await job();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.running--;
    }
  }
  async metadata(bytes: Buffer, processed = false): Promise<GuildIconMetadata> {
    if (!bytes.length || bytes.length > 10 * 1024 * 1024)
      throw new Error("FILE_TOO_LARGE");
    const pixelLimit = processed ? 512 * 512 * 300 : 40_000_000;
    const meta = await sharp(bytes, {
      animated: true,
      limitInputPixels: pixelLimit,
      failOn: "error",
    }).metadata();
    const width = meta.width || 0;
    const height = meta.pageHeight || meta.height || 0;
    const frames = meta.pages || 1;
    if (
      !width ||
      !height ||
      frames > 300 ||
      width * height * frames > pixelLimit ||
      !["gif", "png", "jpeg", "webp"].includes(meta.format || "")
    )
      throw new Error("FILE_TYPE_UNSUPPORTED");
    return {
      width,
      height,
      frames,
      delays: meta.delay || Array(frames).fill(100),
    };
  }
  async validateUpload(bytes: Buffer): Promise<void> {
    await this.metadata(bytes);
    // Force decoding before an uploaded icon can replace a bound icon.
    await sharp(bytes, {
      animated: true,
      limitInputPixels: 40_000_000,
      failOn: "error",
    })
      .timeout({ seconds: 30 })
      .raw()
      .toBuffer();
  }
  async frame(
    bytes: Buffer,
    index: number,
    processed = false,
  ): Promise<Buffer> {
    const meta = await this.metadata(bytes, processed);
    if (!Number.isSafeInteger(index) || index < 0 || index >= meta.frames)
      throw new Error("INVALID_PARAMS");
    return sharp(bytes, {
      page: index,
      pages: 1,
      limitInputPixels: 40_000_000,
      failOn: "error",
    })
      .timeout({ seconds: 30 })
      .png()
      .toBuffer();
  }
  async process(
    bytes: Buffer,
    request: GuildIconProcessRequest,
  ): Promise<{ bytes: Buffer; metadata: GuildIconMetadata }> {
    const meta = await this.metadata(bytes);
    if (request.output !== "animated" && request.output !== "frame")
      throw new Error("INVALID_PARAMS");
    const crop = request.crop || {
      left: (meta.width - Math.min(meta.width, meta.height)) / 2,
      top: (meta.height - Math.min(meta.width, meta.height)) / 2,
      size: Math.min(meta.width, meta.height),
    };
    if (
      ![crop.left, crop.top, crop.size].every(Number.isFinite) ||
      crop.size < 1 ||
      crop.left < 0 ||
      crop.top < 0 ||
      crop.left + crop.size > meta.width + 0.01 ||
      crop.top + crop.size > meta.height + 0.01
    )
      throw new Error("INVALID_PARAMS");
    const extraction = {
      left: Math.floor(crop.left),
      top: Math.floor(crop.top),
      width: Math.max(1, Math.floor(crop.size)),
      height: Math.max(1, Math.floor(crop.size)),
    };
    if (request.output === "frame") {
      const index = request.frame ?? 0;
      if (!Number.isSafeInteger(index) || index < 0 || index >= meta.frames)
        throw new Error("INVALID_PARAMS");
      const output = await sharp(bytes, {
        page: index,
        pages: 1,
        limitInputPixels: 40_000_000,
        failOn: "error",
      })
        .timeout({ seconds: 30 })
        .extract(extraction)
        .resize(512, 512)
        .png()
        .toBuffer();
      return {
        bytes: output,
        metadata: { width: 512, height: 512, frames: 1, delays: [0] },
      };
    }
    // Decode composited frames once. Each page receives the same pixel-space crop.
    const deadline = Date.now() + 30_000;
    const decoded = await sharp(bytes, {
      animated: true,
      limitInputPixels: 40_000_000,
      failOn: "error",
    })
      .timeout({ seconds: 30 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const frameSize = meta.width * meta.height * 4;
    const pages: Buffer[] = [];
    for (let index = 0; index < meta.frames; index++) {
      if (Date.now() >= deadline) throw new Error("ICON_PROCESS_TIMEOUT");
      pages.push(
        await sharp(
          decoded.data.subarray(index * frameSize, (index + 1) * frameSize),
          { raw: { width: meta.width, height: meta.height, channels: 4 } },
        )
          .timeout({
            seconds: Math.max(1, Math.ceil((deadline - Date.now()) / 1000)),
          })
          .extract(extraction)
          .resize(512, 512)
          .raw()
          .toBuffer(),
      );
    }
    const original = await sharp(bytes, { animated: true }).metadata();
    const output = await sharp(Buffer.concat(pages), {
      raw: {
        width: 512,
        height: 512 * meta.frames,
        channels: 4,
        pageHeight: 512,
      },
    })
      .timeout({
        seconds: Math.max(1, Math.ceil((deadline - Date.now()) / 1000)),
      })
      .gif({
        delay: meta.delays,
        loop: original.loop ?? 0,
        keepDuplicateFrames: true,
      })
      .toBuffer();
    if (Date.now() >= deadline) throw new Error("ICON_PROCESS_TIMEOUT");
    if (output.length > 10 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
    const encoded = await sharp(output, { animated: true }).metadata();
    return {
      bytes: output,
      metadata: {
        width: encoded.width || 512,
        height: encoded.pageHeight || encoded.height || 512,
        frames: encoded.pages || 1,
        delays: encoded.delay || meta.delays,
      },
    };
  }
}
export const guildIconProcessor = new GuildIconProcessor();
