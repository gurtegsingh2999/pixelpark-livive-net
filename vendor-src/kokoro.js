// Source entry for vendor/kokoro.js (`npm run vendor:tts`).
//
// Wraps kokoro-js so every file comes from this site: the model and tokenizer
// from `modelRoot`, the ORT wasm from `wasmUrl`, and voice style files from
// `voiceBase`. kokoro-js hardcodes a huggingface.co URL for voices, so the
// subclass below replaces the one method that uses it. The `phonemizer`
// import is left external and resolves to vendor/espeak-ng/phonemizer.js.
import { KokoroTTS } from 'kokoro-js';
import { env, StyleTextToSpeech2Model, AutoTokenizer, Tensor, RawAudio } from '@huggingface/transformers';

const STYLE_DIM = 256;
const MAX_TOKENS = 509;

class LocalKokoro extends KokoroTTS {
  constructor(model, tokenizer, voiceBase) {
    super(model, tokenizer);
    this.voiceBase = voiceBase;
    this.voiceData = new Map();
  }

  async loadVoice(id) {
    if (!this.voiceData.has(id)) {
      const response = await fetch(new URL(`${id}.bin`, this.voiceBase));
      if (!response.ok) throw new Error(`voice ${id}: HTTP ${response.status}`);
      this.voiceData.set(id, new Float32Array(await response.arrayBuffer()));
    }
    return this.voiceData.get(id);
  }

  // Same maths as kokoro-js 1.2.1, but the style vector comes from loadVoice().
  async generate_from_ids(input_ids, { voice = 'af_heart', speed = 1 } = {}) {
    const offset = STYLE_DIM * Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), MAX_TOKENS);
    const style = (await this.loadVoice(voice)).slice(offset, offset + STYLE_DIM);
    const { waveform } = await this.model({
      input_ids,
      style: new Tensor('float32', style, [1, STYLE_DIM]),
      speed: new Tensor('float32', [speed], [1])
    });
    return new RawAudio(waveform.data, 24000);
  }
}

/**
 * @param {object} options
 * @param {string} options.modelRoot absolute URL of the folder that holds `kokoro/`
 * @param {string} options.wasmUrl absolute URL of ort-wasm-simd-threaded.jsep.wasm
 * @param {string} options.modelFile onnx file name without extension, e.g. 'model_q8f16'
 * @param {'webgpu'|'wasm'} options.device
 * @param {(info: object) => void} [options.progress]
 */
export async function loadKokoro({ modelRoot, wasmUrl, modelFile, device, progress }) {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = modelRoot;
  env.backends.onnx.wasm.wasmPaths = { wasm: wasmUrl };
  // Transformers 3.x has no 'q8f16' dtype, so name the file directly. dtype
  // 'fp32' only means "no filename suffix" here.
  const options = { progress_callback: progress };
  const [model, tokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained('kokoro', { ...options, model_file_name: modelFile, dtype: 'fp32', device }),
    AutoTokenizer.from_pretrained('kokoro', options)
  ]);
  return new LocalKokoro(model, tokenizer, new URL('kokoro/voices/', modelRoot));
}

export function runtimeInfo() {
  const onnx = env.backends.onnx;
  return {
    transformers: env.version,
    ort: onnx?.versions?.web ?? null,
    wasmThreads: onnx?.wasm?.numThreads ?? null
  };
}
