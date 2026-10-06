/**
 * 音频波形峰值提取与内存缓存工具
 * 用于生成类似 SoundCloud / Discord 语音条的紧凑波形柱状图
 */

const DEFAULT_BARS = 40;
const MAX_WAVEFORM_CACHE_SIZE = 200;
const waveformCache = new Map<string, number[]>();

function setWaveformCache(key: string, data: number[]): void {
  if (waveformCache.has(key)) {
    waveformCache.delete(key);
  } else if (waveformCache.size >= MAX_WAVEFORM_CACHE_SIZE) {
    const firstKey = waveformCache.keys().next().value;
    if (firstKey !== undefined) {
      waveformCache.delete(firstKey);
    }
  }
  waveformCache.set(key, data);
}

/**
 * 基于字符串生成稳定的伪随机波形（平滑曲线降级）
 */
function generateFallbackPeaks(seed: string, count: number): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  const raw: number[] = [];
  let prev = 0.5;
  for (let i = 0; i < count; i++) {
    const x = Math.sin(hash + i * 1.3) * 10000;
    const rand = x - Math.floor(x);
    // 做平滑滤波，让相邻柱子起伏自然
    prev = prev * 0.4 + rand * 0.6;
    raw.push(Math.max(0.18, Math.min(1.0, 0.2 + prev * 0.8)));
  }
  return raw;
}

/**
 * 获取音频波形峰值数据（归一化为 0.15 - 1.0 范围浮点数数组）
 */
export async function getAudioPeaks(
  url: string,
  cacheKey: string,
  barsCount: number = DEFAULT_BARS,
): Promise<number[]> {
  const cached = waveformCache.get(cacheKey);
  if (cached && cached.length === barsCount) {
    waveformCache.delete(cacheKey);
    waveformCache.set(cacheKey, cached);
    return cached;
  }

  // 环境检查
  if (
    typeof window === "undefined" ||
    (!window.AudioContext && !(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  ) {
    const fallback = generateFallbackPeaks(cacheKey, barsCount);
    setWaveformCache(cacheKey, fallback);
    return fallback;
  }

  let audioCtx: AudioContext | null = null;
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();

    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const pcm = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(pcm.length / barsCount);

    if (blockSize <= 0) {
      throw new Error("Audio buffer too short");
    }

    const peaks: number[] = [];
    let maxRms = 0;

    for (let i = 0; i < barsCount; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, pcm.length);
      let sumSquares = 0;
      let count = 0;

      // 适当降采样步长以提高计算速度
      const step = Math.max(1, Math.floor(blockSize / 200));
      for (let j = start; j < end; j += step) {
        sumSquares += pcm[j] * pcm[j];
        count++;
      }

      const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
      peaks.push(rms);
      if (rms > maxRms) {
        maxRms = rms;
      }
    }

    // 归一化到 [0.18, 1.0]
    const normalized = peaks.map((p) => {
      if (maxRms <= 0.0001) return 0.25;
      const ratio = p / maxRms;
      return Math.max(0.18, Math.min(1.0, 0.18 + ratio * 0.82));
    });

    setWaveformCache(cacheKey, normalized);
    return normalized;
  } catch (err) {
    // 解码失败或受跨域保护，优雅降级为平滑伪随机波形
    const fallback = generateFallbackPeaks(cacheKey, barsCount);
    setWaveformCache(cacheKey, fallback);
    return fallback;
  } finally {
    if (audioCtx && audioCtx.state !== "closed") {
      void audioCtx.close().catch(() => {});
    }
  }
}

/**
 * 同步获取已缓存的波形，未缓存时返回稳定的初始降级波形
 */
export function getInitialAudioPeaks(cacheKey: string, barsCount: number = DEFAULT_BARS): number[] {
  const cached = waveformCache.get(cacheKey);
  if (cached && cached.length === barsCount) {
    return cached;
  }
  return generateFallbackPeaks(cacheKey, barsCount);
}

/**
 * 格式化播放时间（秒 -> mm:ss）
 */
export function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
