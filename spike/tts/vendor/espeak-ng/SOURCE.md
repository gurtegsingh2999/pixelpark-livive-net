# vendor/espeak-ng/phonemizer.js — source and license

This file is a byte-for-byte copy of `dist/phonemizer.js` from the npm package
`phonemizer@1.2.1` (copied by `npm run vendor:tts`). Kokoro uses it to turn
text into phonemes.

- **Wrapper:** [xenova/phonemizer.js](https://github.com/xenova/phonemizer.js),
  commit `6835144b7ee9043129222549c1ed2f6a27216278` ("Update to v1.2.1").
  The package says Apache-2.0.
- **Bundled engine:** an Emscripten build of [eSpeak NG](https://github.com/espeak-ng/espeak-ng):
  the library, its `emscripten/espeakng_glue.cpp` bindings (`eSpeakNGWorker`), and
  the `espeak-ng-data` English dictionaries. eSpeak NG is licensed
  **GPL-3.0-or-later**; see `COPYING` in this folder. The glue file header reads
  "either version 3 of the License, or (at your option) any later version".
- **Corresponding source:** upstream's `src/espeakng.worker.js` and
  `data/espeakng.worker.data` at the commit above, built from eSpeak NG's
  `emscripten/` directory. Upstream does not record which eSpeak NG release it
  built from (the latest eSpeak NG release is 1.52.0). eSpeak NG source:
  https://github.com/espeak-ng/espeak-ng

This file stays separate from `vendor/kokoro.js`, which imports it as
`./espeak-ng/phonemizer.js`. It ships here only for the Wave 0 test. The final
license path (keep with GPL notices, or replace the phonemizer) is decided after
go/no-go; see `docs/tts.md`.
