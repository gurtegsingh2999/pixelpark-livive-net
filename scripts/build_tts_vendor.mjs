// `npm run vendor:tts`: rebuild the Kokoro vendor files from node_modules.
//
//   vendor/kokoro.js                          esbuild bundle of vendor-src/kokoro.js
//   vendor/espeak-ng/phonemizer.js            phonemizer dist, kept as its own file (GPL-3.0, see COPYING)
//   vendor/ort/ort-wasm-simd-threaded.jsep.wasm  ONNX Runtime Web runtime (MIT)
//   spike/tts/coi-serviceworker.js            COOP/COEP service worker for the test page (MIT)
//   spike/tts/vendor/                         copy of the two JS files above, used by the test
//                                             page with ?coi=1 (ORT starts its thread workers from
//                                             the bundle's own URL, which must sit inside the
//                                             service worker's spike/tts/ scope)
//
// The model, tokenizer and voice files are not built here; `npm run tts:model` fetches them.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (...p) => join(root, ...p);
// Find a package folder the way Node does (walk up node_modules), without
// needing `package.json` in its exports map.
function pkgDir(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) throw new Error(`${name} not found from ${from}; run npm install`);
  }
}

// Resolve each package the way the bundle does (kokoro-js -> transformers -> onnxruntime-web).
const kokoroDir = pkgDir('kokoro-js', root);
const transformersDir = pkgDir('@huggingface/transformers', kokoroDir);
const ortDir = pkgDir('onnxruntime-web', transformersDir);
const phonemizerDir = pkgDir('phonemizer', kokoroDir);
const coiDir = pkgDir('coi-serviceworker', root);

const version = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;

await build({
  entryPoints: [out('vendor-src/kokoro.js')],
  outfile: out('vendor/kokoro.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  legalComments: 'eof',
  logLevel: 'warning',
  plugins: [{
    name: 'external-phonemizer',
    setup(b) {
      b.onResolve({ filter: /^phonemizer$/ }, () => ({ path: './espeak-ng/phonemizer.js', external: true }));
    }
  }]
});

mkdirSync(out('vendor/espeak-ng'), { recursive: true });
mkdirSync(out('vendor/ort'), { recursive: true });
copyFileSync(join(phonemizerDir, 'dist/phonemizer.js'), out('vendor/espeak-ng/phonemizer.js'));
copyFileSync(join(ortDir, 'dist/ort-wasm-simd-threaded.jsep.wasm'), out('vendor/ort/ort-wasm-simd-threaded.jsep.wasm'));
copyFileSync(join(coiDir, 'coi-serviceworker.js'), out('spike/tts/coi-serviceworker.js'));
mkdirSync(out('spike/tts/vendor/espeak-ng'), { recursive: true });
copyFileSync(out('vendor/kokoro.js'), out('spike/tts/vendor/kokoro.js'));
copyFileSync(out('vendor/espeak-ng/phonemizer.js'), out('spike/tts/vendor/espeak-ng/phonemizer.js'));
for (const notice of ['COPYING', 'SOURCE.md']) {
  copyFileSync(out('vendor/espeak-ng', notice), out('spike/tts/vendor/espeak-ng', notice));
}

console.log([
  `kokoro-js ${version(kokoroDir)}`,
  `@huggingface/transformers ${version(transformersDir)}`,
  `onnxruntime-web ${version(ortDir)}`,
  `phonemizer ${version(phonemizerDir)}`,
  `coi-serviceworker ${version(coiDir)}`
].join('\n'));
