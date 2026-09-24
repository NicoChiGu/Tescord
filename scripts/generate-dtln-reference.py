"""Regenerate DTLN reference PCM using the upstream real-time ONNX algorithm.

Requires numpy and onnxruntime. This deliberately mirrors the official
real_time_processing_onnx.py buffer/state flow, without using our JS DSP code.
"""

from pathlib import Path

import numpy as np
import onnxruntime


root = Path(__file__).resolve().parent.parent
model_dir = root / "apps/web/public/models/dtln"
output_dir = root / "e2e/fixtures/audio"
output_dir.mkdir(parents=True, exist_ok=True)

rng = np.random.default_rng(1337)
t = np.arange(16000, dtype=np.float32) / 16000
audio = (
    0.11 * np.sin(2 * np.pi * 187 * t)
    + 0.07 * np.sin(2 * np.pi * 730 * t)
    + 0.025 * rng.standard_normal(len(t)).astype(np.float32)
).astype(np.float32)
audio[123] += 0.35
audio[8191] -= 0.2

session1 = onnxruntime.InferenceSession(str(model_dir / "model_1.onnx"))
session2 = onnxruntime.InferenceSession(str(model_dir / "model_2.onnx"))
inputs1 = {
    item.name: np.zeros(
        [dimension if isinstance(dimension, int) else 1 for dimension in item.shape],
        dtype=np.float32,
    )
    for item in session1.get_inputs()
}
inputs2 = {
    item.name: np.zeros(
        [dimension if isinstance(dimension, int) else 1 for dimension in item.shape],
        dtype=np.float32,
    )
    for item in session2.get_inputs()
}
names1 = [item.name for item in session1.get_inputs()]
names2 = [item.name for item in session2.get_inputs()]
block_len, block_shift = 512, 128
in_buffer = np.zeros(block_len, dtype=np.float32)
out_buffer = np.zeros(block_len, dtype=np.float32)
out_file = np.zeros(len(audio), dtype=np.float32)
num_blocks = (len(audio) - (block_len - block_shift)) // block_shift
for idx in range(num_blocks):
    in_buffer[:-block_shift] = in_buffer[block_shift:]
    in_buffer[-block_shift:] = audio[idx * block_shift : (idx + 1) * block_shift]
    in_fft = np.fft.rfft(in_buffer)
    magnitude = np.abs(in_fft).reshape(1, 1, -1).astype(np.float32)
    phase = np.angle(in_fft)
    inputs1[names1[0]] = magnitude
    stage1 = session1.run(None, inputs1)
    inputs1[names1[1]] = stage1[1]
    estimated = magnitude * stage1[0] * np.exp(1j * phase)
    block = np.fft.irfft(estimated).reshape(1, 1, -1).astype(np.float32)
    inputs2[names2[0]] = block
    stage2 = session2.run(None, inputs2)
    inputs2[names2[1]] = stage2[1]
    out_buffer[:-block_shift] = out_buffer[block_shift:]
    out_buffer[-block_shift:] = 0
    out_buffer += np.squeeze(stage2[0])
    out_file[idx * block_shift : (idx + 1) * block_shift] = out_buffer[:block_shift]

(output_dir / "dtln_reference_input_16k.f32").write_bytes(audio.tobytes())
(output_dir / "dtln_reference_output_16k.f32").write_bytes(out_file.tobytes())
print(f"DTLN official algorithm reference: {num_blocks} hops, output {len(audio)} samples")
