#include <node_api.h>
#include <math.h>
#include <stdlib.h>
#include "rnnoise.h"

static void destroy_state(napi_env env, void *data, void *hint) {
  (void)env; (void)hint;
  if (data) rnnoise_destroy((DenoiseState *)data);
}

static napi_value create_state(napi_env env, napi_callback_info info) {
  (void)info;
  DenoiseState *state = rnnoise_create(NULL);
  if (!state) { napi_throw_error(env, NULL, "RNNoise allocation failed"); return NULL; }
  napi_value result;
  if (napi_create_external(env, state, destroy_state, NULL, &result) != napi_ok) {
    rnnoise_destroy(state);
    napi_throw_error(env, NULL, "RNNoise state export failed");
    return NULL;
  }
  return result;
}

static napi_value process_frame(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != 2) {
    napi_throw_type_error(env, NULL, "Expected state and 480 Float32 samples");
    return NULL;
  }
  DenoiseState *state = NULL;
  if (napi_get_value_external(env, args[0], (void **)&state) != napi_ok || !state) {
    napi_throw_type_error(env, NULL, "Invalid RNNoise state");
    return NULL;
  }
  napi_typedarray_type type;
  size_t length = 0;
  void *data = NULL;
  if (napi_get_typedarray_info(env, args[1], &type, &length, &data, NULL, NULL) != napi_ok ||
      type != napi_float32_array || length != 480 || !data) {
    napi_throw_type_error(env, NULL, "RNNoise requires exactly 480 Float32 samples");
    return NULL;
  }
  float scaled[480], denoised[480];
  const float *input = (const float *)data;
  for (size_t i = 0; i < 480; i++) {
    if (!isfinite(input[i])) {
      napi_throw_range_error(env, NULL, "Non-finite PCM input");
      return NULL;
    }
    float value = input[i] * 32767.0f;
    scaled[i] = fmaxf(-32768.0f, fminf(32767.0f, value));
  }
  rnnoise_process_frame(state, denoised, scaled);
  napi_value buffer, result;
  float *output = NULL;
  if (napi_create_arraybuffer(env, sizeof(denoised), (void **)&output, &buffer) != napi_ok ||
      napi_create_typedarray(env, napi_float32_array, 480, buffer, 0, &result) != napi_ok) {
    napi_throw_error(env, NULL, "RNNoise output allocation failed");
    return NULL;
  }
  for (size_t i = 0; i < 480; i++) output[i] = denoised[i] / 32767.0f;
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"createState", NULL, create_state, NULL, NULL, NULL, napi_default, NULL},
    {"processFrame", NULL, process_frame, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
