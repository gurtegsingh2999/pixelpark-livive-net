// Kokoro TTS worker (module worker). Loads vendor/kokoro.js and the model
// files from this site only. Every URL is built from import.meta.url so the
// worker works at the domain root and under a subpath such as
// /pixelpark-livive-net/.
//
// Messages in:  { type: 'probe' }
//               { type: 'load', device: 'auto'|'webgpu'|'wasm', model: 'auto'|'q8f16'|'q8'|'fp16', vendorUrl? }
//               { type: 'generate', id, text, voice, speed }
//               { type: 'requests' }
// Messages out: probe | progress | loaded | audio | requests | error

const SITE_BASE = new URL('../../', import.meta.url).href;
const VENDOR_URL = new URL('../../vendor/kokoro.js', import.meta.url).href;
const MODEL_ROOT = new URL('../../assets/tts/', import.meta.url).href;
const WASM_URL = new URL('../../vendor/ort/ort-wasm-simd-threaded.jsep.wasm', import.meta.url).href;

const MODEL_FILES = Object.freeze({
  q8f16: 'model_q8f16',
  q8: 'model_quantized',
  fp16: 'model_fp16'
});

// Fetch guard: anything outside this site's base path is refused. Installed
// before vendor/kokoro.js is imported, so the libraries only ever see it.
const blocked = [];
const nativeFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, SITE_BASE).href;
  if (!url.startsWith(SITE_BASE)) {
    blocked.push(url);
    return Promise.reject(new TypeError(`blocked off-site request: ${url}`));
  }
  return nativeFetch(input, init);
};

let lib = null;
let tts = null;
let loadedInfo = null;

async function probeGpu() {
  if (!self.navigator?.gpu) return { available: false, reason: 'navigator.gpu missing' };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { available: false, reason: 'no adapter' };
    const info = adapter.info ?? {};
    return {
      available: true,
      vendor: info.vendor || '',
      architecture: info.architecture || '',
      description: info.description || '',
      shaderF16: adapter.features.has('shader-f16')
    };
  } catch (error) {
    return { available: false, reason: String(error?.message || error) };
  }
}

function post(message, transfer) {
  self.postMessage(message, transfer || []);
}

// vendorUrl lets the test page load a copy of the bundle from inside its
// service worker scope, so ORT's thread workers are cross-origin isolated too.
// model 'auto': fp16 on WebGPU with shader-f16, otherwise q8f16. In the Wave 0
// test, q8f16 on WebGPU produced garbled, ~10x-too-long audio, and q8 on WebGPU
// ran at CPU speed; fp16 was the only WebGPU file that was both correct and fast.
function pickModel(model, device, gpu) {
  if (model !== 'auto') return model;
  return device === 'webgpu' && gpu.shaderF16 ? 'fp16' : 'q8f16';
}

// vendorUrl lets the test page load a copy of the bundle from inside its
// service worker scope, so ORT's thread workers are cross-origin isolated too.
async function load({ device = 'auto', model = 'auto', vendorUrl = VENDOR_URL }) {
  if (model !== 'auto' && !MODEL_FILES[model]) throw new Error(`unknown model ${model}`);
  const bundleUrl = new URL(vendorUrl, SITE_BASE).href;
  if (!bundleUrl.startsWith(SITE_BASE)) throw new Error(`vendor bundle must be on this site: ${bundleUrl}`);
  const gpu = await probeGpu();
  const wanted = device === 'auto' ? (gpu.available ? 'webgpu' : 'wasm') : device;
  const t0 = performance.now();
  lib ??= await import(bundleUrl);
  const tImport = performance.now();
  const progress = (info) => {
    if (info.status === 'progress' || info.status === 'done' || info.status === 'initiate') {
      post({ type: 'progress', status: info.status, file: info.file, loaded: info.loaded ?? 0, total: info.total ?? 0 });
    }
  };
  const attempt = (dev) => {
    const chosen = pickModel(model, dev, gpu);
    return lib.loadKokoro({ modelRoot: MODEL_ROOT, wasmUrl: WASM_URL, modelFile: MODEL_FILES[chosen], device: dev, progress })
      .then((engine) => ({ engine, chosen }));
  };
  let used = wanted;
  let fallback = null;
  let loadedModel;
  try {
    ({ engine: tts, chosen: loadedModel } = await attempt(wanted));
  } catch (error) {
    if (device !== 'auto' || wanted === 'wasm') throw error;
    fallback = `webgpu failed: ${error?.message || error}`;
    used = 'wasm';
    ({ engine: tts, chosen: loadedModel } = await attempt('wasm'));
  }
  const tLoad = performance.now();
  loadedInfo = {
    device: used,
    requestedDevice: device,
    fallback,
    model: loadedModel,
    requestedModel: model,
    modelFile: `${MODEL_FILES[loadedModel]}.onnx`,
    bundle: bundleUrl,
    importMs: tImport - t0,
    loadMs: tLoad - tImport,
    gpu,
    runtime: lib.runtimeInfo(),
    crossOriginIsolated: self.crossOriginIsolated === true
  };
  return loadedInfo;
}

async function generate({ text, voice, speed = 1 }) {
  if (!tts) throw new Error('model not loaded');
  const t0 = performance.now();
  await tts.loadVoice(voice);
  const tVoice = performance.now();
  const audio = await tts.generate(text, { voice, speed });
  const tGen = performance.now();
  const pcm = new Float32Array(audio.audio);
  return { pcm, sampleRate: audio.sampling_rate, voiceMs: tVoice - t0, genMs: tGen - tVoice };
}

function requestLog() {
  const entries = performance.getEntriesByType('resource').map((entry) => ({
    url: entry.name,
    bytes: entry.transferSize || entry.encodedBodySize || 0,
    ms: Math.round(entry.duration)
  }));
  return {
    siteBase: SITE_BASE,
    entries,
    offSite: entries.filter((entry) => !entry.url.startsWith(SITE_BASE)).map((entry) => entry.url),
    blocked: [...blocked]
  };
}

self.addEventListener('message', async (event) => {
  const message = event.data || {};
  try {
    if (message.type === 'probe') {
      post({
        type: 'probe',
        siteBase: SITE_BASE,
        crossOriginIsolated: self.crossOriginIsolated === true,
        hardwareConcurrency: self.navigator?.hardwareConcurrency ?? null,
        gpu: await probeGpu()
      });
    } else if (message.type === 'load') {
      post({ type: 'loaded', ...(await load(message)) });
    } else if (message.type === 'generate') {
      const result = await generate(message);
      post({ type: 'audio', id: message.id, ...result }, [result.pcm.buffer]);
    } else if (message.type === 'requests') {
      post({ type: 'requests', ...requestLog() });
    }
  } catch (error) {
    post({ type: 'error', id: message.id ?? null, during: message.type, message: String(error?.message || error) });
  }
});
