RNNoise C source and built-in model: https://github.com/shiguredo/rnnoise,
tag `2022.1.0`, commit `0aee43d89c685ccadeca5409cb7adc93462f4bc8`.

This is the source selected by `@shiguredo/rnnoise-wasm@2022.2.0`, used by
`@sapphi-red/web-noise-suppressor@0.4.1` in the browser. The Node-API adapter
in `addon.c` belongs to Tescord. Original RNNoise license is in `COPYING`.

Build on each target platform with `pnpm --filter @tescord/desktop run build:native`.
