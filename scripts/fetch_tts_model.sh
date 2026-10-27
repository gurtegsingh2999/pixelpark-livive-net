#!/bin/sh
# Fetch the pinned Kokoro files listed in scripts/kokoro.lock into
# assets/tts/kokoro/ (git-ignored). Used by `npm run tts:model` locally and by
# .github/workflows/pages.yml at build time, so both trees are identical.
#
#   TTS_SETS="core"        sets to fetch (default "core": the game's q8 model, tokenizer,
#                          voices; add "wasm" for q8f16 and "spike" for fp16, test page only)
#   --check                verify only, never download; exit 1 if anything is missing or wrong
#
# Every file is checked against its size and sha256. A file already on disk that
# fails the check is deleted and fetched again; a download that fails the check
# stops the script with exit 1 (nothing unverified is left in place).
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOCK="$ROOT/scripts/kokoro.lock"
DEST="$ROOT/assets/tts/kokoro"
BASE="https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231"
SETS=" ${TTS_SETS:-core} "
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

if command -v sha256sum >/dev/null 2>&1; then
  hash_of() { sha256sum "$1" | cut -d' ' -f1; }
else
  hash_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
fi
size_of() { wc -c < "$1" | tr -d ' '; }
valid() { [ -f "$1" ] && [ "$(size_of "$1")" = "$2" ] && [ "$(hash_of "$1")" = "$3" ]; }

fetched=0; kept=0; failed=0
while read -r sha size set path; do
  case "$sha" in ''|'#'*) continue ;; esac
  case "$SETS" in *" $set "*) ;; *) continue ;; esac
  case "$path" in /*|*..*) echo "bad path in lock: $path" >&2; exit 1 ;; esac
  file="$DEST/$path"
  if valid "$file" "$size" "$sha"; then
    kept=$((kept + 1)); continue
  fi
  if [ "$CHECK_ONLY" = 1 ]; then
    echo "FAIL $path (missing or sha256/size mismatch)" >&2
    failed=$((failed + 1)); continue
  fi
  [ -f "$file" ] && echo "re-fetching $path (did not match the lock)"
  rm -f "$file"
  mkdir -p "$(dirname "$file")"
  echo "fetching $path ($size bytes)"
  curl --fail --silent --show-error --location --proto '=https' --retry 3 \
    --output "$file.part" "$BASE/$path"
  if valid "$file.part" "$size" "$sha"; then
    mv "$file.part" "$file"
    fetched=$((fetched + 1))
  else
    rm -f "$file.part"
    echo "FAIL $path: downloaded file does not match the lock" >&2
    exit 1
  fi
done < "$LOCK"

if [ "$failed" -gt 0 ]; then
  echo "$failed file(s) failed verification" >&2
  exit 1
fi
echo "kokoro assets ok (sets:$SETS) fetched $fetched, already verified $kept"
