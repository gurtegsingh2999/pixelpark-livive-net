#!/usr/bin/env bash
set -euo pipefail

echo "==> Setting up Play Park..."

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
    echo "Warning: Node.js 20+ is recommended (found $(node -v))."
  else
    echo "Node.js $(node -v) detected."
  fi
else
  echo "Warning: Node.js is not installed. You will need it to run tests ('npm test') or dev tooling."
fi

# Install dependencies if npm is available
if command -v npm >/dev/null 2>&1; then
  echo "==> Installing dev dependencies (npm install)..."
  npm install
fi

echo "==> Setup complete! Run './run.sh' or 'npm start' to start the local server."
