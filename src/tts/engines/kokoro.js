// "hd" voices: main-thread proxy for src/tts/kokoro.worker.js plus the Web
// Audio output that plays its PCM. The game only runs Kokoro as fp16 on
// WebGPU with shader-f16: q8f16 is garbled on WebGPU and WASM is too slow on
// one thread (docs/tts.md), so anything else reports 'unsupported' and the
// game stays on basic voices. Nothing here touches the DOM at import time.

const WORKER_URL = new URL('../kokoro.worker.js', import.meta.url);

/** Detune in cents for a pitch multiplier (1 = unchanged, 2 = an octave up). */
export function pitchToCents(pitch) {
  const value = Number(pitch);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(1200 * Math.log2(value));
}

/** Whether a worker `probe` result can run the fp16 model on WebGPU. */
export function canRunHd(probe) {
  return Boolean(probe?.gpu?.available && probe.gpu.shaderF16);
}

/**
 * Overall download progress (0..1) from the worker's per-file progress
 * messages. Files of unknown size are left out; it stays under 1 until the
 * model has actually loaded.
 */
export function createProgressTracker() {
  const files = new Map();
  return {
    update({ status, file, loaded = 0, total = 0 } = {}) {
      if (file) {
        const entry = files.get(file) || { loaded: 0, total: 0 };
        entry.total = Math.max(entry.total, Number(total) || 0);
        entry.loaded = status === 'done' ? entry.total : Math.max(entry.loaded, Number(loaded) || 0);
        files.set(file, entry);
      }
      return this.value();
    },
    value() {
      let loaded = 0;
      let total = 0;
      for (const entry of files.values()) {
        if (!entry.total) continue;
        loaded += Math.min(entry.loaded, entry.total);
        total += entry.total;
      }
      return total ? Math.min(0.99, loaded / total) : 0;
    }
  };
}

function defaultCreateWorker() {
  if (typeof globalThis.Worker !== 'function') return null;
  return url => new globalThis.Worker(url, { type: 'module' });
}

/**
 * @param {object} [deps]
 * @param {URL|string} [deps.workerUrl]
 * @param {((url:URL|string) => Worker)|null} [deps.createWorker] null = no workers here
 * @param {{ context(): AudioContext|null }|null} [deps.output] turns PCM into AudioBuffers
 */
export function createKokoroEngine({
  workerUrl = WORKER_URL,
  createWorker = defaultCreateWorker(),
  output = null
} = {}) {
  let status = 'idle';
  let worker = null;
  let waiter = null;
  let nextId = 1;
  let info = null;
  let lastError = null;
  let tracker = null;
  let onProgress = null;
  const pending = new Map();

  function failAll(error) {
    if (waiter) {
      const current = waiter;
      waiter = null;
      current.reject(error);
    }
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  }

  function teardown() {
    worker?.terminate?.();
    worker = null;
  }

  function onMessage(event) {
    const message = event?.data || {};
    if (message.type === 'progress') {
      onProgress?.(tracker.update(message));
    } else if (message.type === 'audio') {
      const job = pending.get(message.id);
      if (!job) return;
      pending.delete(message.id);
      job.resolve(message);
    } else if (message.type === 'error') {
      const error = new Error(message.message || 'hd voices failed');
      if (message.id != null && pending.has(message.id)) {
        const job = pending.get(message.id);
        pending.delete(message.id);
        job.reject(error);
      } else if (waiter && waiter.during === message.during) {
        const current = waiter;
        waiter = null;
        current.reject(error);
      }
    } else if (waiter && message.type === waiter.reply) {
      const current = waiter;
      waiter = null;
      current.resolve(message);
    }
  }

  // The worker answers probe and load with a reply type, not an id; one at a time.
  function request(message, reply) {
    return new Promise((resolve, reject) => {
      waiter = { during: message.type, reply, resolve, reject };
      worker.postMessage(message);
    });
  }

  /** Settles without throwing; check status() afterwards. */
  async function load(progress = null) {
    if (status === 'loading' || status === 'ready' || status === 'unsupported') return;
    if (!createWorker) {
      status = 'unsupported';
      return;
    }
    status = 'loading';
    onProgress = progress;
    tracker = createProgressTracker();
    try {
      worker = createWorker(workerUrl);
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', event => {
        failAll(new Error(event?.message || 'hd voice worker failed'));
      });
      const probe = await request({ type: 'probe' }, 'probe');
      if (!canRunHd(probe)) {
        info = { probe };
        status = 'unsupported';
        teardown();
        return;
      }
      // Explicit device and model: 'auto' would pick q8f16 on a WebGPU adapter
      // without shader-f16, and an explicit device never falls back to WASM.
      info = await request({ type: 'load', device: 'webgpu', model: 'fp16' }, 'loaded');
      onProgress?.(1);
      status = 'ready';
    } catch (error) {
      lastError = error;
      status = 'error';
      failAll(error);
      teardown();
    } finally {
      onProgress = null;
    }
  }

  function toBuffer({ pcm, sampleRate }) {
    if (!pcm?.length) return null;
    const context = output?.context?.();
    if (!context) return { pcm, sampleRate };
    const buffer = context.createBuffer(1, pcm.length, sampleRate);
    buffer.copyToChannel(pcm, 0);
    return buffer;
  }

  return {
    id: 'kokoro',
    status: () => status,
    info: () => ({ ...(info || {}), error: lastError ? String(lastError.message || lastError) : null }),
    load,
    synth(text, voice) {
      if (status !== 'ready' || !worker) return Promise.reject(new Error('hd voices are not ready'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        // Rate becomes Kokoro's speed here; the player applies only pitch.
        worker.postMessage({ type: 'generate', id, text, voice: voice?.engineVoice, speed: voice?.rate ?? 1 });
      }).then(toBuffer);
    },
    // The worker cannot abort a generation (~0.4 s); the speaker ignores stale results.
    stop() {}
  };
}

/**
 * Shared AudioContext and the player the speaker drives. The context is made
 * lazily; `unlock()` from a click resumes it.
 */
export function createAudioOutput({
  createContext = () => {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    return Context ? new Context() : null;
  }
} = {}) {
  let context = null;
  let master = 1;
  const get = () => (context ??= createContext());
  const resume = target => {
    if (target?.state === 'suspended') target.resume?.()?.catch?.(() => {});
  };

  return {
    context: get,
    unlock() {
      const target = get();
      resume(target);
      return Boolean(target);
    },
    setVolume(value) {
      master = Math.min(1, Math.max(0, Number(value) || 0));
    },
    play(buffer, { volume = 1, pan = 0, pitch = 1 } = {}) {
      const target = get();
      if (!target || !buffer || typeof target.createBufferSource !== 'function') {
        return { done: Promise.resolve(), stop() {} };
      }
      resume(target);
      const source = target.createBufferSource();
      source.buffer = buffer;
      // Rate is already in the audio (Kokoro speed); pitch alone is applied here.
      if (source.detune) source.detune.value = pitchToCents(pitch);
      const gain = target.createGain();
      gain.gain.value = master * Math.min(1, Math.max(0, Number(volume) || 0));
      source.connect(gain);
      let last = gain;
      if (pan && typeof target.createStereoPanner === 'function') {
        const panner = target.createStereoPanner();
        panner.pan.value = Math.min(1, Math.max(-1, pan));
        gain.connect(panner);
        last = panner;
      }
      last.connect(target.destination);

      let finished = false;
      let resolve;
      const done = new Promise(res => { resolve = res; });
      const end = () => {
        if (finished) return;
        finished = true;
        try { source.disconnect(); } catch { /* already disconnected */ }
        resolve();
      };
      source.onended = end;
      source.start();
      return {
        done,
        stop() {
          try { source.stop(); } catch { /* not started or already stopped */ }
          end();
        }
      };
    }
  };
}
