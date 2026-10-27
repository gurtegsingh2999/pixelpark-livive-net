// Entry for the test page's worker. It lives in spike/tts/ so that, with ?coi=1,
// the worker sits inside the COOP/COEP service worker's scope and is
// cross-origin isolated too. All logic is in src/tts/kokoro.worker.js.
import '../../src/tts/kokoro.worker.js';
