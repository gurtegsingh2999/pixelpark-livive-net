import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanForSpeech, clampForSpeech, splitSentences, hasSpeakableText, TEXT_RULES } from '../src/tts/text.js';

const dialogues = JSON.parse(readFileSync(new URL('../data/dialogues.json', import.meta.url), 'utf8'));

test('strips the {name}: speaker prefix from abandon prompts', () => {
  for (const key of ['ttt', 'checkers', 'chess', 'fetch']) {
    const text = dialogues.dialogues[key].abandonPrompt.replace('{name}', 'Thistle');
    const spoken = cleanForSpeech(text, { speakerName: 'Thistle' });
    assert.ok(!spoken.startsWith('Thistle'), `${key}: ${spoken}`);
    assert.ok(spoken.length > 0);
  }
  assert.equal(cleanForSpeech('Sage: Leaving the board?'), 'Leaving the board?');
  assert.equal(cleanForSpeech('Big Ben: Hello there.'), 'Hello there.');
  assert.equal(cleanForSpeech('Checkmate! Good game of Chess.'), 'Checkmate! Good game of Chess.');
});

test('strips emoji, reward footers, countdowns, and odd punctuation', () => {
  assert.equal(cleanForSpeech('hi there! 🎉🎉'), 'hi there!');
  assert.equal(cleanForSpeech('👋 hello 👍🏽'), 'hello');
  assert.equal(cleanForSpeech('Great game!\nRewards: 5 coins · ribbon'), 'Great game!');
  assert.equal(cleanForSpeech('Pip and Moss are about to play. Want to watch? (4)'), 'Pip and Moss are about to play. Want to watch?');
  assert.equal(cleanForSpeech('Wow!!! ~~nice~~ ***'), 'Wow! nice');
  assert.equal(cleanForSpeech('Hmm… ok...'), 'Hmm, ok.');
  assert.equal(cleanForSpeech('TTT & chess'), 'tic tac toe and chess');
});

test('returns empty only when nothing speakable is left', () => {
  for (const glyph of ['👋', '…', '♪', '', '   ', null, undefined, '!!!']) {
    assert.equal(cleanForSpeech(glyph), '', `${glyph}`);
  }
  assert.equal(cleanForSpeech('Sage:'), 'Sage');
  assert.equal(cleanForSpeech('ok!'), 'ok!');
  for (const spec of Object.values(dialogues.dialogues)) {
    for (const field of ['text', 'win', 'loss', 'draw', 'complete']) {
      if (typeof spec[field] !== 'string') continue;
      assert.ok(hasSpeakableText(cleanForSpeech(spec[field].replace('{name}', 'Pip'))), spec[field]);
    }
  }
});

test('clamps long lines at a sentence or word boundary', () => {
  const long = `${'This is a sentence that goes on. '.repeat(10)}`;
  const clamped = cleanForSpeech(long);
  assert.ok(clamped.length <= TEXT_RULES.maxChars);
  assert.ok(clamped.endsWith('.'));
  const words = clampForSpeech('word '.repeat(60), 40);
  assert.ok(words.length <= 41);
  assert.match(words, /word\.$/);
  assert.equal(clampForSpeech('x'.repeat(50), 10).length, 11);
  assert.equal(clampForSpeech('short', 10), 'short');
});

test('splits sentences and keeps tiny fragments attached', () => {
  assert.deepEqual(splitSentences('Yay! Pip is your friend now.'), ['Yay! Pip is your friend now.']);
  assert.deepEqual(
    splitSentences('Haha, gotcha! Good match. Want another round?'),
    ['Haha, gotcha!', 'Good match. Want another round?']
  );
  assert.deepEqual(splitSentences('Bye.'), ['Bye.']);
  assert.deepEqual(splitSentences(''), []);
});
