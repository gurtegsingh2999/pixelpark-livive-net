// Wave 0 timing page for Kokoro. Throwaway: deleted after the go/no-go call.
// Query switches: ?device=auto|webgpu|wasm  ?model=auto|q8f16|q8|fp16  ?coi=1
//                 ?voices=af_heart,bm_george (benchmark voices)

const params = new URLSearchParams(location.search);
const settings = {
  device: params.get('device') || 'auto',
  model: params.get('model') || 'auto',
  coi: params.get('coi') === '1',
  voices: (params.get('voices') || 'af_heart,am_michael,bf_emma,bm_george').split(',').map((v) => v.trim()).filter(Boolean)
};

const LINES = [
  "hi, i'm thistle! want to play a round of tic-tac-toe by the pond?",
  "oh nice, you found my ball. thanks a bunch, you're a real pal.",
  'checkers sounds fun, but i warn you, i never lose on sunny days.',
  'hey neighbour, have you seen the ducks near the old willow tree today?',
  "that was a great game! let's play again tomorrow after lunch, okay?"
];
const GALLERY_LINE = "hi there, neighbour! it's a lovely day in the park.";

const $ = (id) => document.getElementById(id);
const words = (text) => text.trim().split(/\s+/).length;
const fmt = (n, digits = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toFixed(digits));

const worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let nextId = 1;
let audioCtx = null;
let currentSource = null;
let probe = null;
let loaded = null;
let lastRequests = null;
const results = [];
const tries = [];
const fileProgress = new Map();

function setStatus(text) { $('status').textContent = text; }

// One job at a time, so a benchmark row never waits behind a manual line.
const JOB_BUTTONS = ['bench', 'speak', 'gallery'];
let busy = false;
async function exclusive(fn) {
  if (busy) return;
  busy = true;
  for (const id of JOB_BUTTONS) $(id).disabled = true;
  try { await fn(); } finally {
    busy = false;
    for (const id of JOB_BUTTONS) $(id).disabled = !loaded;
  }
}

function row(cells) {
  const tr = document.createElement('tr');
  for (const cell of cells) {
    const td = document.createElement('td');
    if (cell instanceof Node) td.append(cell); else td.textContent = cell;
    tr.append(td);
  }
  return tr;
}

function fillTable(tbody, pairs) {
  tbody.replaceChildren(...pairs.map(([k, v]) => row([k, String(v)])));
}

function ensureAudio() {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function play(pcm, sampleRate) {
  const ctx = ensureAudio();
  stopAudio();
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  buffer.copyToChannel(pcm, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  currentSource = source;
  return new Promise((resolve) => { source.onended = resolve; });
}

function stopAudio() {
  try { currentSource?.stop(); } catch { /* already stopped */ }
  currentSource = null;
}

function playButton(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '▶';
  button.setAttribute('aria-label', `play ${entry.voice}`);
  button.addEventListener('click', () => play(entry.pcm, entry.sampleRate));
  return button;
}

function call(message) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, sent: performance.now() });
    worker.postMessage({ ...message, id });
  });
}

let loadResolve = null;
let loadReject = null;

worker.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'probe') {
    probe = msg;
    renderEnv();
  } else if (msg.type === 'progress') {
    const prev = fileProgress.get(msg.file) || { loaded: 0, total: 0 };
    if (msg.status === 'progress') fileProgress.set(msg.file, { loaded: msg.loaded, total: msg.total });
    else if (msg.status === 'done') fileProgress.set(msg.file, { loaded: prev.total, total: prev.total });
    else fileProgress.set(msg.file, prev);
    let done = 0; let total = 0;
    for (const f of fileProgress.values()) { done += f.loaded; total += f.total; }
    $('progress').value = total ? done / total : 0;
    $('progress-text').textContent = [...fileProgress].map(([f, p]) => `${f}: ${fmt(p.loaded / 1e6, 1)}/${fmt(p.total / 1e6, 1)} MB`).join(' · ');
  } else if (msg.type === 'loaded') {
    loadResolve?.(msg);
  } else if (msg.type === 'audio') {
    const job = pending.get(msg.id);
    pending.delete(msg.id);
    job?.resolve({ ...msg, firstAudioMs: performance.now() - job.sent });
  } else if (msg.type === 'requests') {
    lastRequests = msg;
    renderRequests();
  } else if (msg.type === 'error') {
    if (msg.during === 'load') { loadReject?.(new Error(msg.message)); return; }
    const job = pending.get(msg.id);
    pending.delete(msg.id);
    if (job) job.reject(new Error(msg.message)); else setStatus(`error: ${msg.message}`);
  }
});
worker.addEventListener('error', (event) => setStatus(`worker error: ${event.message || 'failed to start'}`));

function renderEnv() {
  const gpu = probe?.gpu ?? {};
  fillTable($('env'), [
    ['user agent', navigator.userAgent],
    ['secure context', window.isSecureContext],
    ['cross-origin isolated (page / worker)', `${window.crossOriginIsolated} / ${probe?.crossOriginIsolated ?? '…'}`],
    ['coi service worker', settings.coi ? (navigator.serviceWorker?.controller ? 'active' : 'registering…') : 'off'],
    ['cpu cores', navigator.hardwareConcurrency ?? '?'],
    ['device memory (GB)', navigator.deviceMemory ?? 'not exposed'],
    ['webgpu', gpu.available ? `yes: ${[gpu.vendor, gpu.architecture, gpu.description].filter(Boolean).join(' ') || 'adapter ok'}` : `no (${gpu.reason ?? '…'})`],
    ['shader-f16', gpu.available ? gpu.shaderF16 : '—'],
    ['requested', `device=${settings.device} model=${settings.model}`],
    ['site base', probe?.siteBase ?? '…']
  ]);
}

function renderLoad() {
  if (!loaded) return;
  fillTable($('load-info'), [
    ['backend used', loaded.device + (loaded.fallback ? ` (fallback: ${loaded.fallback})` : '')],
    ['model file', `${loaded.modelFile}${loaded.requestedModel === 'auto' ? ' (picked by auto)' : ''}`],
    ['bundle', loaded.bundle],
    ['ort wasm threads', loaded.runtime?.wasmThreads ?? '?'],
    ['versions', `transformers ${loaded.runtime?.transformers} · ort ${loaded.runtime?.ort}`],
    ['import vendor/kokoro.js', `${fmt(loaded.importMs)} ms`],
    ['model + tokenizer load (fetch or cache, session create)', `${fmt(loaded.loadMs)} ms`],
    ['total until ready', `${fmt(loaded.totalMs)} ms`]
  ]);
}

function renderRequests() {
  if (!lastRequests) return;
  const { entries, offSite, blocked } = lastRequests;
  const bytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  const box = $('requests');
  box.replaceChildren();
  const p = document.createElement('p');
  p.textContent = `${entries.length} requests, ${fmt(bytes / 1e6, 1)} MB over the network · off-site: ${offSite.length} · blocked by guard: ${blocked.length}`;
  p.className = offSite.length || blocked.length ? 'fail' : 'pass';
  box.append(p);
  const list = document.createElement('div');
  list.className = 'mono';
  list.textContent = [...entries.map((e) => `${e.url}  (${fmt(e.bytes / 1e3)} kB, ${e.ms} ms)`), ...blocked.map((u) => `BLOCKED ${u}`)].join('\n');
  list.style.whiteSpace = 'pre-wrap';
  box.append(list);
  box.append(Object.assign(document.createElement('p'), {
    className: 'muted',
    textContent: 'files read back from the browser cache (Cache API) do not appear here.'
  }));
}

async function loadModel() {
  ensureAudio();
  $('load').disabled = true;
  setStatus('loading…');
  const t0 = performance.now();
  try {
    loaded = await new Promise((resolve, reject) => {
      loadResolve = resolve; loadReject = reject;
      worker.postMessage({
        type: 'load',
        device: settings.device,
        model: settings.model,
        // With ?coi=1, load the bundle copy inside this folder (the service worker's scope).
        ...(settings.coi ? { vendorUrl: new URL('vendor/kokoro.js', import.meta.url).href } : {})
      });
    });
    loaded.totalMs = performance.now() - t0;
    $('progress').value = 1;
    renderLoad();
    setStatus(`ready on ${loaded.device}`);
    for (const id of ['bench', 'speak', 'gallery', 'copy']) $(id).disabled = false;
  } catch (error) {
    setStatus(`load failed: ${error.message}`);
    $('load').disabled = false;
  }
  worker.postMessage({ type: 'requests' });
}

function targetMs() { return loaded?.device === 'webgpu' ? 1500 : 4000; }

async function speakOnce(text, voice, speed = 1) {
  const r = await call({ type: 'generate', text, voice, speed });
  const audioS = r.pcm.length / r.sampleRate;
  return {
    voice, text, words: words(text), voiceMs: r.voiceMs, genMs: r.genMs, firstAudioMs: r.firstAudioMs,
    audioS, rtf: r.genMs / 1000 / audioS, pass: r.firstAudioMs <= targetMs(), pcm: r.pcm, sampleRate: r.sampleRate
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summary() {
  if (!results.length) return null;
  const warm = results.slice(1);
  return {
    target: targetMs(),
    coldFirstAudioMs: results[0].firstAudioMs,
    warmMedianFirstAudioMs: median(warm.map((r) => r.firstAudioMs)),
    warmWorstFirstAudioMs: warm.length ? Math.max(...warm.map((r) => r.firstAudioMs)) : null,
    medianRtf: median(results.map((r) => r.rtf)),
    passed: results.filter((r) => r.pass).length,
    total: results.length
  };
}

function renderSummary() {
  const s = summary();
  if (!s) return;
  $('summary').textContent = `target ${s.target} ms · cold (first line after load) ${fmt(s.coldFirstAudioMs)} ms · warm median ${fmt(s.warmMedianFirstAudioMs)} ms · warm worst ${fmt(s.warmWorstFirstAudioMs)} ms · median rtf ${fmt(s.medianRtf, 2)} · ${s.passed}/${s.total} within target`;
}

async function runBenchmark() {
  results.length = 0;
  $('results').replaceChildren();
  const jobs = [];
  for (const voice of settings.voices) for (const line of LINES) jobs.push({ voice, line });
  for (const [index, job] of jobs.entries()) {
    setStatus(`benchmark ${index + 1}/${jobs.length}…`);
    try {
      const r = await speakOnce(job.line, job.voice);
      results.push(r);
      const verdict = Object.assign(document.createElement('span'), {
        className: r.pass ? 'pass' : 'fail', textContent: r.pass ? 'pass' : 'slow'
      });
      $('results').append(row([
        index === 0 ? '1 (cold)' : String(index + 1), r.voice, r.text, r.words, fmt(r.voiceMs), fmt(r.genMs),
        fmt(r.firstAudioMs), fmt(r.audioS, 2), fmt(r.rtf, 2), verdict, playButton(r)
      ]));
      renderSummary();
    } catch (error) {
      $('results').append(row([String(index + 1), job.voice, job.line, '', '', '', '', '', '', `error: ${error.message}`, '']));
    }
  }
  setStatus('benchmark done');
  worker.postMessage({ type: 'requests' });
}

async function speakTry(text, voice) {
  const r = await speakOnce(text, voice, Number($('speed').value) || 1);
  tries.push(r);
  $('tries').prepend(row([r.voice, r.text, `${fmt(r.firstAudioMs)} ms`, `${fmt(r.audioS, 2)} s`, playButton(r)]));
  await play(r.pcm, r.sampleRate);
}

async function loadPool() {
  try {
    const data = await (await fetch(new URL('../../data/voices.json', import.meta.url))).json();
    return data.pool.map((v) => ({ id: v.engineVoice, label: `${v.engineVoice} · ${v.gender} · ${v.accent}` }));
  } catch {
    return settings.voices.map((id) => ({ id, label: id }));
  }
}

async function init() {
  $('device').value = settings.device;
  $('model').value = settings.model;
  $('coi').checked = settings.coi;
  const pool = await loadPool();
  $('voice').replaceChildren(...pool.map((v) => Object.assign(document.createElement('option'), { value: v.id, textContent: v.label })));
  renderEnv();
  worker.postMessage({ type: 'probe' });

  $('apply').addEventListener('click', () => {
    const next = new URLSearchParams(location.search);
    next.set('device', $('device').value);
    next.set('model', $('model').value);
    if ($('coi').checked) next.set('coi', '1'); else next.delete('coi');
    location.search = next.toString();
  });
  $('load').addEventListener('click', loadModel);
  $('bench').addEventListener('click', () => exclusive(runBenchmark));
  $('stop').addEventListener('click', stopAudio);
  $('clear').addEventListener('click', async () => {
    const removed = await caches.delete('transformers-cache').catch(() => false);
    setStatus(removed ? 'model cache cleared; reload for a cold load' : 'no model cache to clear');
  });
  $('speak').addEventListener('click', () => exclusive(async () => {
    try { await speakTry($('text').value, $('voice').value); } catch (error) { setStatus(`error: ${error.message}`); }
  }));
  $('gallery').addEventListener('click', () => exclusive(async () => {
    for (const v of pool) {
      setStatus(`playing ${v.id}`);
      $('voice').value = v.id;
      try { await speakTry(GALLERY_LINE, v.id); } catch (error) { setStatus(`error: ${error.message}`); break; }
    }
    setStatus('gallery done');
  }));
  $('copy').addEventListener('click', async () => {
    const report = {
      when: new Date().toISOString(),
      page: location.href,
      settings,
      env: {
        userAgent: navigator.userAgent,
        crossOriginIsolated: { page: window.crossOriginIsolated, worker: probe?.crossOriginIsolated },
        cores: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory ?? null,
        gpu: probe?.gpu ?? null
      },
      load: loaded,
      summary: summary(),
      results: results.map(({ pcm, ...rest }) => rest),
      requests: lastRequests && { count: lastRequests.entries.length, offSite: lastRequests.offSite, blocked: lastRequests.blocked }
    };
    const text = JSON.stringify(report, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('results copied');
    } catch {
      const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
      area.style.minHeight = '200px';
      $('summary').after(area);
      area.select();
      setStatus('clipboard blocked; results shown below the summary');
    }
  });
}

init();
