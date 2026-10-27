// Pure helpers for which engine speaks and how the voices pill and menu read.

/**
 * The engine that should speak right now. hd uses Kokoro once it is ready and
 * basic voices until then; basic only ever uses Web Speech.
 *
 * @param {'off'|'basic'|'hd'} mode
 * @param {{ kokoro?: string, webspeech?: string }} statuses engine `status()` values
 * @returns {'kokoro'|'webspeech'|null}
 */
export function chooseEngine(mode, { kokoro = 'idle', webspeech = 'idle' } = {}) {
  if (mode !== 'basic' && mode !== 'hd') return null;
  if (mode === 'hd' && kokoro === 'ready') return 'kokoro';
  if (webspeech === 'ready') return 'webspeech';
  return null;
}

/**
 * One status for the pill and the menu title.
 *
 * @param {{ mode, engine, kokoro, webspeech, progress }} state controller state
 * @returns {{ status: 'off'|'loading'|'hd'|'basic'|'none'|'starting', percent: number }}
 */
export function voicesStatus({ mode = 'off', engine = null, kokoro = 'idle', webspeech = 'idle', progress = null } = {}) {
  const percent = Math.max(0, Math.min(100, Math.floor((Number(progress) || 0) * 100)));
  if (mode === 'off') return { status: 'off', percent };
  if (mode === 'hd' && kokoro === 'loading') return { status: 'loading', percent };
  if (engine === 'kokoro') return { status: 'hd', percent };
  if (engine === 'webspeech') return { status: 'basic', percent };
  if (webspeech === 'unsupported') return { status: 'none', percent };
  return { status: 'starting', percent };
}

function fill(template, values) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) => (values[key] === undefined ? match : String(values[key])));
}

/**
 * Text for the 🔊 topbar pill.
 *
 * @param {object} state controller state
 * @param {object} copy data/dialogues.json `voicesMenu`
 * @returns {{ icon: string, label: string, title: string, loading: boolean }}
 */
export function describePill(state, copy) {
  const { status, percent } = voicesStatus(state);
  const pill = copy.pill || {};
  const values = { percent };
  return {
    icon: status === 'off' || status === 'none' ? (pill.offIcon || '🔇') : (pill.onIcon || '🔊'),
    label: fill(pill[status] ?? status, values),
    title: fill(copy.status?.[status] ?? status, values),
    loading: status === 'loading'
  };
}

/**
 * The voices beat: a title plus one choice per item, the current mode marked.
 *
 * @returns {{ text: string, items: Array<{ id, label, className }> }}
 */
export function voicesMenu(state, copy) {
  const { status, percent } = voicesStatus(state);
  const volume = Math.round((Number(state?.volume) || 0) * 100);
  const values = { percent, volume };
  const text = fill(copy.title, { status: fill(copy.status?.[status] ?? status, values) });
  const items = (copy.items || []).map(item => ({
    id: item.id,
    label: fill(item.label, values),
    className: item.id === state?.mode ? 'primary' : (item.id === 'back' ? 'pill quiet' : 'pill')
  }));
  return { text, items };
}
