#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-4173}"

echo "==> Starting Play Park local server on http://localhost:${PORT}"
echo "    Press Ctrl+C to stop."

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "${PORT}"
elif command -v python >/dev/null 2>&1; then
  exec python -m http.server "${PORT}"
elif command -v npx >/dev/null 2>&1; then
  exec npx serve -p "${PORT}" .
else
  echo "Error: Neither python3, python, nor npx is available to serve static files." >&2
  exit 1
fi
