{
  "targets": [
    {
      "target_name": "loopback",
      "sources": ["addon.cc"],
      "defines": ["NAPI_VERSION=8", "UNICODE", "_UNICODE"],
      "libraries": ["-lole32.lib", "-lmmdevapi.lib"],
      "msvs_settings": {
        "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17", "/EHsc"] }
      }
    }
  ]
}
