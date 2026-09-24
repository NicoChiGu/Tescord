{
  "targets": [{
    "target_name": "rnnoise",
    "sources": [
      "addon.c",
      "src/denoise.c",
      "src/rnn.c",
      "src/rnn_data.c",
      "src/rnn_reader.c",
      "src/pitch.c",
      "src/kiss_fft.c",
      "src/celt_lpc.c"
    ],
    "include_dirs": ["include", "src"],
    "defines": ["NAPI_VERSION=8", "_USE_MATH_DEFINES"],
    "conditions": [
      ["OS=='win'", {"msvs_settings": {"VCCLCompilerTool": {"Optimization": 2}}}],
      ["OS=='mac'", {"xcode_settings": {"GCC_OPTIMIZATION_LEVEL": "2"}}]
    ]
  }]
}
