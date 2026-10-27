# Play Park — Neighbour Voices (TTS)

**Status:** Proposed — engine choice pending  
**Baseline:** `ab22683`, 289/289 tests passing  
**Theme:** Neighbours speak their dialogue lines out loud, generated on demand in the browser, with distinct English voices.

---

## 1. Goals and constraints

**Goals**

- Speak NPC dialogue beats (stranger / friend / accepted / declined / game results / abandon prompts) when they open.
- Optionally speak short world speech bubbles (`say` action barks like "hi!") for NPCs near the player.
- Each neighbour has a stable voice. The pool has male and female English voices, with some accent variety.
- Generated on demand from the text. No pre-recorded audio files.

**Constraints from `AGENTS.md`**

- **No runtime calls to third parties.** Model weights, WASM runtimes, and voice files must be served from this repo (same origin), never from Hugging Face or a CDN.
- **Data-driven.** The voice pool, per-voice tuning, and which dialogue keys get spoken belong in `data/voices.json`.
- **Saves stay compatible.** Any new character field is optional and additive.
- **Pure logic is testable in Node.** Voice assignment, text cleanup, and queue/cancel rules live in DOM-free modules.

**Non-goals**

- Speaking the player's own lines, menus, or debug panels.
- Voice cloning, or voices uploaded by the player.
- Lip-sync. The existing `talk` avatar animation is good enough to trigger while audio plays.

---

## 2. Options

### Option A: Web Speech API (`speechSynthesis`)

The browser's built-in synthesizer.

| | |
| --- | --- |
| Download | 0 bytes |
| Latency | Near instant |
| Voices | Whatever the OS ships with. macOS, Windows, iOS, and Android all have several English voices, but the set differs on every device. |
| Male/female | Not exposed by the API. Has to be guessed from voice names. |
| Offline | Local voices yes. Chrome also lists Google network voices (`localService: false`), so they must be filtered out to keep the no-third-party-calls rule. |
| Quality | Ranges from robotic to decent, depending on the OS |
| Control | `pitch` and `rate` per utterance, which gives cheap per-NPC variety even with only 2–3 voices |
| License | None needed |

**Pros:** trivial to build (~150 lines), zero payload, works everywhere, and is a natural fallback.
**Cons:** you can't control which voices exist, so a neighbour sounds different on different devices. Voice lists load asynchronously (`voiceschanged`), and some Linux setups have no voices at all. The rendering isn't ours, so the audio can't go through Web Audio for volume or effects.

### Option B: Kokoro-82M via `kokoro-js` (recommended)

An open 82M-parameter StyleTTS2-style model running on ONNX Runtime Web through Transformers.js, with WebGPU when available and WASM otherwise.

| | |
| --- | --- |
| Download | One-time: model ~86 MB (`model_q8f16.onnx`) or 92.4 MB (`model_quantized.onnx`), plus the ORT WASM runtime and one small style file per voice (~0.5 MB each). Cached by the browser after the first load. |
| Latency | Seconds per line on WASM and much faster on WebGPU. **Must be benchmarked on target devices (Wave 0).** |
| Voices | 28 English voices: 11 American female, 9 American male, 4 British female, 4 British male (`af_*`, `am_*`, `bf_*`, `bm_*`) |
| Male/female | Encoded in the voice id prefix |
| Offline | Yes, once cached, if Transformers.js is set to local-only (`env.allowRemoteModels = false`, local `wasmPaths`) |
| Quality | The best of the three. Natural and expressive. |
| License | Model and `kokoro-js` are Apache-2.0. See the **phonemizer caveat** below. |

**Pros:** the quality jump is the whole point of the feature. There are plenty of voices with clear gender and accent labels, the output is the same on every device, and the audio comes back as a PCM buffer, so it plays through Web Audio with volume and spatial falloff.
**Cons:** a heavy first download. It must run in a Web Worker to keep the game loop smooth. CPU-only WASM devices may be too slow for live lines. The 86 MB file sits just under GitHub's 100 MB per-file limit and will make every clone bigger.

### Option C: KittenTTS nano 0.8 (int8)

A tiny StyleTTS2-style model from KittenML, running on ONNX Runtime Web through the community `kitten-tts-js` port.

| | |
| --- | --- |
| Download | ~25 MB (int8), or 56 MB for fp32 |
| Latency | Faster than Kokoro on CPU (15M parameters). Still to be benchmarked. |
| Voices | 8: Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo. These are reported as 4 female and 4 male, but upstream doesn't label them, so check by ear. |
| Offline | Yes, once self-hosted. The port fetches from Hugging Face by default, so it has to be patched or wrapped. |
| Quality | Clearly below Kokoro and a bit flat, but well above most OS voices |
| License | Apache-2.0 on code and repo. Same phonemizer caveat. |

**Pros:** about a third of Kokoro's download and CPU-friendly, so it's the better pick if mobile matters most.
**Cons:** only 8 voices, all American, so a park of 40 neighbours repeats voices quickly. Pitch and rate offsets help. The JS port is an unofficial hobby project (`kitten-tts-js@0.1.2`), so we'd own fixes.

**Also considered:** Piper `en_US-libritts_r-medium` (78.6 MB, MIT, 900+ LibriTTS speakers). It has huge variety but lower and uneven quality, and many speakers aren't labelled by gender. Kokoro is about the same size and better.

### Phonemizer caveat (B and C)

Both ML options turn text into phonemes with the `phonemizer` npm package. Its `LICENSE` is Apache-2.0, but its README says it is built on **eSpeak NG**, which is GPL-3.0. The 1.3 MB bundle includes that compiled code. Vendoring it into an MIT repo needs a decision:

- accept it and add an attribution and GPL note for that one vendored file,
- confirm with the package author how the eSpeak part is licensed, or
- swap in a dictionary-based English phonemizer (CMUdict plus fallback rules). That's more work and gives worse handling of names like "Thistle" and "Yarrow".

Do this before Wave 1 ships. It doesn't block the benchmark spike.

---

## 3. Recommendation

**Use Kokoro (B) as the main engine, with Web Speech (A) as the fallback, and keep voices off by default.**

- The player turns on **voices** in a new settings section. The first time, a "downloading voices (86 MB)…" progress pill appears, and Web Speech speaks lines until Kokoro is ready.
- If WebGPU is missing and the Wave 0 benchmark shows WASM is too slow, the device stays on Web Speech. Show "hd voices need a faster device" instead of lagging.
- The engine sits behind one interface, so swapping Kokoro for Kitten later is a data and config change, not a rewrite. If the benchmark kills Kokoro on mid-range hardware, Kitten (C) is the fallback plan.

Why not A alone? Inconsistent voices work against "each neighbour has their own voice", and quality varies a lot by OS. Why not C first? Eight American voices for a 40-neighbour park is thin, and Kokoro's 28 voices with gender and accent labels fit this game better.

---

## 4. Design

### 4.1 Modules

| Path | Responsibility |
| --- | --- |
| `data/voices.json` | Engine config, voice pool (id, engine voice, gender, accent, pitch/rate), spoken dialogue keys, bubble rules |
| `src/tts/voices.js` | **Pure.** `assignVoice(character, pool)` (deterministic from seed), `resolveVoice(character)`, gender and accent filters |
| `src/tts/text.js` | **Pure.** Strip `{name}:` speaker prefixes, emoji, and ellipses. Expand "TTT"-style shorthand. Clamp length. |
| `src/tts/speaker.js` | **Pure state machine.** Queue, priority (dialogue > bubble), cancel-on-new-beat, per-actor dedupe, LRU audio cache keyed by `voice|text`. The engine is injected. |
| `src/tts/engines/webspeech.js` | `speechSynthesis` adapter. Filters to `localService` voices and maps pool entries to the nearest local voice by language and name. |
| `src/tts/engines/kokoro.js` | Main-thread proxy that posts to the worker and plays the returned PCM through a shared `AudioContext` |
| `src/tts/kokoro.worker.js` | Loads `vendor/kokoro.js` with local paths. `load` / `generate` / `cancel` messages. Picks WebGPU vs WASM. |
| `vendor-src/kokoro.js` → `vendor/kokoro.js` | esbuild bundle (new `npm run vendor:tts`), like the DiceBear bundle |
| `vendor/ort/` | ORT WASM binaries, copied and committed |
| `assets/tts/kokoro/` | `model_q8f16.onnx`, `config.json`, tokenizer files, and `voices/<id>.bin` for pool voices only |

Engine interface:

```js
{
  id: 'kokoro' | 'webspeech',
  status(): 'idle' | 'loading' | 'ready' | 'unsupported',
  load(onProgress): Promise<void>,
  synth(text, voice): Promise<AudioBuffer | null>, // null = engine plays it itself (webspeech)
  stop(): void
}
```

### 4.2 Voice assignment

- Characters don't have a gender field today. Voices are picked independently of looks, which matches the gender-neutral names.
- `assignVoice` hashes the character's `seed` into the pool and spreads choices so neighbours get distinct voices until the pool runs out. After that, repeats get a ±pitch/±rate offset.
- Each NPC stores an optional `voice: "am_puck"` field once assigned, so adding to the pool later doesn't reshuffle existing neighbours. Older saves without the field fall back to the seeded pick. This is additive and needs no version bump.
- Companions don't speak at first. Creatures could later get a pitched-up or pitched-down effect.
- Later: a voice picker with a "preview" button in the customizer for the player and in the NPC character card.

### 4.3 What gets spoken

`data/voices.json` lists dialogue keys explicitly:

```json
"speak": {
  "dialogue": ["stranger", "friend", "accepted", "declined",
               "ttt.*", "checkers.*", "chess.*", "fetch.*"],
  "skip": ["playerMenu", "debugMenu", "companion"],
  "bubbles": { "enabled": false, "maxDistanceTiles": 8, "maxPerMinute": 6 }
}
```

- `DialogueManager.setBeat` calls into a small hook (`onBeat(npc, text, key)`) instead of importing TTS directly, so dialogue stays testable.
- A new beat or `close()` cancels speech that's playing. Picking a choice mid-line cuts it off immediately.
- Bubbles are off at launch. When on, only NPCs within range of the player speak, with a rate cap, at lower volume and panned by screen x.

### 4.4 Settings

The new key `playpark.settings.v1` is separate from the save, since settings are per device:

```json
{ "voices": "off" | "basic" | "hd", "volume": 0.8, "bubbles": false }
```

- `basic` = Web Speech, `hd` = Kokoro. These are lower-case labels in the UI.
- Add a 🔊 entry to the player menu, and a mute shortcut (`M`).
- The `AudioContext` starts on the toggle's click, which satisfies browser autoplay rules.

### 4.5 Performance rules

- The model loads only when `hd` is chosen, never at startup.
- At most one generation is in flight at a time. Bubble requests are dropped, not queued, when the engine is busy.
- Generate sentence by sentence and play the first sentence while the rest generate.
- Pre-warm the common lines ("Hi, I'm {name}…") for the nearest NPC the moment the player starts walking toward them.
- LRU cache of about 40 decoded buffers. Lines are short (≤ ~3 s), so memory stays small.

### 4.6 Hosting

- Commit the `.onnx` directly. It's under GitHub's 100 MB hard limit, and GitHub Pages serves it from the same origin. Don't use Git LFS: Pages doesn't serve LFS objects reliably (verify before relying on it).
- Every clone grows by ~90 MB. If that matters, move model assets to an orphan `tts-assets` branch, or a second Pages repo under the same custom domain (`pp.livive.net/tts/…`).
- Update `AGENTS.md`: "no runtime network requests" becomes "no requests to third-party hosts; large same-origin assets load only on opt-in."

---

## 5. Delivery waves

| Wave | Scope | Exit criteria |
| --- | --- | --- |
| **0: Spike** | A throwaway page loads Kokoro q8f16 from local files in a worker. Time first-audio on M-series Mac/Chrome (WebGPU), Mac/Safari, a mid-range Windows laptop (WASM), and an iPhone and Android phone. Repeat with Kitten nano int8. | Go if a 10–15 word line starts within **≤ 1.5 s on WebGPU** and **≤ 4 s on WASM**. Otherwise switch to Kitten. Settle the phonemizer license question. |
| **1: Basic voices** | `voices.js`, `text.js`, `speaker.js`, the Web Speech engine, the settings key and menu toggle, and the dialogue hook | Dialogue beats speak with per-NPC pitch and rate on a local voice. Tests pass. |
| **2: HD voices** | Kokoro worker and vendor bundle, local assets, download progress UI, fallback to basic while loading, Web Audio playback | Fully offline after first load (DevTools offline check). No frame drops while generating. |
| **3: Polish** | Voice picker and preview in the customizer and character card, the `voice` field persisted on NPCs, pre-warm, optional bubbles with distance falloff | A save made before Wave 3 loads and keeps its voices. |

---

## 6. Tests (`test/`)

- `tts-voices.test.js`: assignment is deterministic per seed. Distinct voices until the pool runs out, then variant offsets. A stored `voice` wins. Unknown voice ids fall back.
- `tts-text.test.js`: strips `{name}:` prefixes and emoji, clamps length, never returns empty for real text.
- `tts-speaker.test.js` (fake engine): a new beat cancels the current one, dialogue beats out bubbles, busy drops bubbles, cache hits skip `synth`, `close()` stops audio.
- `data-validation.test.js`: every `voices.json` pool entry has a valid gender and accent and an asset file. Every key in `speak.dialogue` exists in `dialogues.json`.
- `storage.test.js`: an old save without `voice` loads, and a save with `voice` round-trips.

---

## 7. Open questions

1. Is the ~90 MB repo growth OK, or should model assets go on a separate branch or repo from day one?
2. Should voices be gender-balanced when assigned (alternating pools), or fully random?
3. Should British voices be in the pool, or just American?
4. Should companions and creatures get voice effects later, or stay silent?
