import type { ModelLoadProgress, NoiseSuppressionMode } from "@tescord/types";
import { fetchVerifiedAsset } from "../workers/verifyModelAsset.js";

const files: Record<"dtln" | "dfn3", Array<[string, string]>> = {
  dtln: [
    [
      "models/dtln/model_1.onnx",
      "22b91cae3855e5a0620e66a917ca6c82c58db0e842c770f58d86751c5e8d4ae3",
    ],
    [
      "models/dtln/model_2.onnx",
      "e20c92f9233fccf29cddf86970d0d0161a03aebccc26d6f4d5639c4d5ec2e639",
    ],
  ],
  dfn3: [
    [
      "models/dfn3/denoiser_model.onnx",
      "b758c49d6708a5b7979e3de185705a8a4915076c862fb17b1b304d9a72b75cdc",
    ],
    [
      "models/dfn3/meta.json",
      "e3a8fefd13c43747b97471bf889d54608465198a58c2b99006483b1b4bad2962",
    ],
    [
      "models/dfn3/initial-state-layout.json",
      "d8a85a81e2b869ae979050d88398890716ba07f6dcd92ae923b13d6a82b787cf",
    ],
    [
      "models/dfn3/initial-states.f32",
      "7664728d90e7b17655cf4d308d46d42fdea6c3a69c374e494164c7cb44d783fc",
    ],
  ],
};
export const supportsWasmSimd = () =>
  WebAssembly.validate(
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10,
      1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]),
  );

export async function downloadNoiseModel(
  mode: NoiseSuppressionMode,
  onProgress: (progress: ModelLoadProgress) => void,
  signal?: AbortSignal,
) {
  if (mode === "off") return;
  const assets: Array<[string, string]> =
    mode === "rnnoise"
      ? [
          [
            supportsWasmSimd()
              ? "rnnoise/rnnoise_simd.wasm"
              : "rnnoise/rnnoise.wasm",
            supportsWasmSimd()
              ? "378fd17c294db15ee4e818ba5ef072242a21c8ad7445b483f7f46d7dc4f2c253"
              : "8b60a2ab88fdae2d1a9f940249d0eb072f28ba8e796f7304347b4e07839c8853",
          ],
        ]
      : files[mode];
  const base = new URL(import.meta.env.BASE_URL || "./", window.location.href);
  await Promise.all(
    assets.map(([path, hash]) =>
      fetchVerifiedAsset(new URL(path, base), hash, onProgress, signal),
    ),
  );
}
