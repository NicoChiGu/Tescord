// WASAPI virtual process loopback; Windows build 20348 or later.
// The main process supplies a verified HWND, never a renderer-selected PID.
#include <node_api.h>
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl.h>
#include <atomic>
#include <deque>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>
using namespace Microsoft::WRL;

class Activation final : public RuntimeClass<RuntimeClassFlags<ClassicCom>,
    IActivateAudioInterfaceCompletionHandler, FtmBase> {
 public:
  HANDLE done = CreateEvent(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_PENDING;
  ComPtr<IAudioClient> client;
  ~Activation() { CloseHandle(done); }
  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
    ComPtr<IUnknown> value;
    HRESULT activationResult = E_FAIL;
    result = op->GetActivateResult(&activationResult, &value);
    if (SUCCEEDED(result)) result = activationResult;
    if (SUCCEEDED(result)) result = value.As(&client);
    SetEvent(done);
    return S_OK;
  }
};
struct Capture {
  std::atomic<bool> stop{false};
  std::atomic<HRESULT> status{E_PENDING};
  std::mutex mutex;
  std::deque<std::vector<float>> queue;
  std::thread thread;
  ~Capture() { stop = true; if (thread.joinable()) thread.join(); }
};
static std::map<uint32_t, std::unique_ptr<Capture>> captures;
static uint32_t nextId = 1;
static void run(Capture* capture, DWORD pid, bool exclude) {
  HRESULT init = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(init)) { capture->status = init; return; }
  auto handler = Make<Activation>();
  AUDIOCLIENT_ACTIVATION_PARAMS params{};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = exclude
      ? PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
      : PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT variant{};
  variant.vt = VT_BLOB;
  variant.blob.cbSize = sizeof(params);
  variant.blob.pBlobData = reinterpret_cast<BYTE*>(&params);
  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
      __uuidof(IAudioClient), &variant, handler.Get(), &operation);
  if (SUCCEEDED(hr)) {
    DWORD wait = WaitForSingleObject(handler->done, 5000);
    hr = wait == WAIT_OBJECT_0 ? handler->result : HRESULT_FROM_WIN32(ERROR_TIMEOUT);
  }
  ComPtr<IAudioCaptureClient> reader;
  HANDLE event = CreateEvent(nullptr, FALSE, FALSE, nullptr);
  WAVEFORMATEX format{};
  format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
  format.nChannels = 2;
  format.nSamplesPerSec = 48000;
  format.wBitsPerSample = 32;
  format.nBlockAlign = 8;
  format.nAvgBytesPerSec = 384000;
  if (SUCCEEDED(hr)) hr = handler->client->Initialize(AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
      AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, 200000, 0, &format, nullptr);
  if (SUCCEEDED(hr)) hr = handler->client->SetEventHandle(event);
  if (SUCCEEDED(hr)) hr = handler->client->GetService(IID_PPV_ARGS(&reader));
  if (SUCCEEDED(hr)) hr = handler->client->Start();
  capture->status = hr;
  while (SUCCEEDED(hr) && !capture->stop) {
    WaitForSingleObject(event, 20);
    UINT32 frames = 0;
    hr = reader->GetNextPacketSize(&frames);
    while (SUCCEEDED(hr) && frames && !capture->stop) {
      BYTE* bytes = nullptr; DWORD flags = 0;
      hr = reader->GetBuffer(&bytes, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) break;
      std::vector<float> samples(frames * 2, 0.0f);
      if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && bytes)
        memcpy(samples.data(), bytes, samples.size() * sizeof(float));
      reader->ReleaseBuffer(frames);
      { std::lock_guard<std::mutex> lock(capture->mutex);
        // Drop stale PCM if renderer is suspended; never accumulate seconds of lag.
        if (capture->queue.size() >= 12) capture->queue.pop_front();
        capture->queue.push_back(std::move(samples)); }
      hr = reader->GetNextPacketSize(&frames);
    }
  }
  if (FAILED(hr)) capture->status = hr;
  if (handler->client) handler->client->Stop();
  reader.Reset(); handler->client.Reset(); operation.Reset(); handler.Reset();
  CloseHandle(event); CoUninitialize();
}
static napi_value number(napi_env env, double value) {
  napi_value result; napi_create_double(env, value, &result); return result;
}
static napi_value start(napi_env env, napi_callback_info info) {
  size_t argc=2; napi_value args[2]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  double hwndValue=0; bool exclude=false;
  if (argc!=2 || napi_get_value_double(env,args[0],&hwndValue)!=napi_ok ||
      napi_get_value_bool(env,args[1],&exclude)!=napi_ok) {
    napi_throw_type_error(env,nullptr,"Invalid loopback arguments"); return nullptr;
  }
  DWORD pid = GetCurrentProcessId();
  if (!exclude) {
    HWND hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(hwndValue));
    if (!IsWindow(hwnd) || !GetWindowThreadProcessId(hwnd,&pid) || !pid || pid==GetCurrentProcessId()) {
      napi_throw_error(env,nullptr,"Capture window no longer exists"); return nullptr;
    }
  }
  auto capture=std::make_unique<Capture>(); auto* raw=capture.get();
  uint32_t id=nextId++; captures[id]=std::move(capture);
  raw->thread=std::thread(run,raw,pid,exclude);
  return number(env,id);
}
static napi_value poll(napi_env env,napi_callback_info info) {
  size_t argc=1; napi_value arg; napi_get_cb_info(env,info,&argc,&arg,nullptr,nullptr);
  uint32_t id=0; napi_get_value_uint32(env,arg,&id);
  napi_value result; napi_create_object(env,&result);
  auto found=captures.find(id);
  if(found==captures.end()) { napi_set_named_property(env,result,"status",number(env,-1)); return result; }
  auto* capture=found->second.get();
  napi_set_named_property(env,result,"status",number(env,static_cast<long>(capture->status.load())));
  std::lock_guard<std::mutex> lock(capture->mutex);
  if(!capture->queue.empty()) {
    std::vector<float> samples;
    for(auto& block:capture->queue) samples.insert(samples.end(),block.begin(),block.end());
    capture->queue.clear();
    void* data; napi_value buffer,array;
    napi_create_arraybuffer(env,samples.size()*sizeof(float),&data,&buffer);
    memcpy(data,samples.data(),samples.size()*sizeof(float));
    napi_create_typedarray(env,napi_float32_array,samples.size(),buffer,0,&array);
    napi_set_named_property(env,result,"samples",array);
  }
  return result;
}
static napi_value stop(napi_env env,napi_callback_info info) {
  size_t argc=1; napi_value arg; napi_get_cb_info(env,info,&argc,&arg,nullptr,nullptr);
  uint32_t id=0; napi_get_value_uint32(env,arg,&id); captures.erase(id);
  napi_value result; napi_get_undefined(env,&result); return result;
}
static napi_value init(napi_env env,napi_value exports) {
  napi_property_descriptor descriptors[] = {
    {"start",nullptr,start,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"poll",nullptr,poll,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"stop",nullptr,stop,nullptr,nullptr,nullptr,napi_default,nullptr}};
  napi_define_properties(env,exports,3,descriptors);
  napi_add_env_cleanup_hook(env,[](void*) { captures.clear(); },nullptr);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
