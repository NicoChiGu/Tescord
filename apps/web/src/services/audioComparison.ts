/** Small, deterministic helpers for equal-input denoiser audition clips. */

export function monoPcm(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < out.length; i++)
      out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

function envelope(pcm: Float32Array, hop: number): Float32Array {
  const out = new Float32Array(Math.ceil(pcm.length / hop));
  for (let frame = 0; frame < out.length; frame++) {
    let energy = 0;
    const start = frame * hop;
    const end = Math.min(start + hop, pcm.length);
    for (let i = start; i < end; i++) energy += pcm[i] * pcm[i];
    out[frame] = Math.sqrt(energy / Math.max(1, end - start));
  }
  return out;
}

/** Positive lag means the processed clip starts later than the raw clip. */
export function estimateComparisonLag(
  raw: Float32Array,
  processed: Float32Array,
  sampleRate: number,
): { samples: number; correlation: number } {
  const hop = Math.max(1, Math.round(sampleRate / 200)); // 5 ms
  const a = envelope(raw, hop);
  const b = envelope(processed, hop);
  const maxShift = Math.round((0.25 * sampleRate) / hop);
  let bestShift = 0;
  let bestCorrelation = 0;
  for (let shift = -maxShift; shift <= maxShift; shift++) {
    let count = 0,
      sumA = 0,
      sumB = 0,
      sumAA = 0,
      sumBB = 0,
      sumAB = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + shift;
      if (j < 0 || j >= b.length) continue;
      const av = a[i],
        bv = b[j];
      count++;
      sumA += av;
      sumB += bv;
      sumAA += av * av;
      sumBB += bv * bv;
      sumAB += av * bv;
    }
    if (count < 20) continue;
    const numerator = sumAB - (sumA * sumB) / count;
    const denominator = Math.sqrt(
      Math.max(0, sumAA - (sumA * sumA) / count) *
        Math.max(0, sumBB - (sumB * sumB) / count),
    );
    const correlation = denominator > 1e-8 ? numerator / denominator : 0;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestShift = shift;
    }
  }
  // A stationary or strongly altered clip does not carry a reliable timing
  // reference. Leave it in place rather than inventing an offset.
  return {
    samples: bestCorrelation >= 0.35 ? bestShift * hop : 0,
    correlation: bestCorrelation,
  };
}

export function alignComparisonPcm(
  processed: Float32Array,
  lagSamples: number,
  targetLength: number,
): Float32Array {
  const aligned = new Float32Array(targetLength);
  for (let i = 0; i < aligned.length; i++) {
    const at = i + lagSamples;
    if (at >= 0 && at < processed.length) aligned[i] = processed[at];
  }
  return aligned;
}

export function wavBlob(pcm: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(bytes);
  const fourcc = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(at + i, value.charCodeAt(i));
  };
  fourcc(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  fourcc(8, "WAVE");
  fourcc(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  fourcc(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const value = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}
