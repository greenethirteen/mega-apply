#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Ensure firebase CLI project is set
if ! command -v firebase >/dev/null 2>&1; then
  echo "firebase CLI not found. Install with: npm install -g firebase-tools"
  exit 1
fi

if ! firebase use >/dev/null 2>&1; then
  echo "No active Firebase project. Run: firebase use --add"
  exit 1
fi

# Build web app
cd "$ROOT_DIR/web"
rm -rf .next out
npm run build

# Deploy functions + hosting
cd "$ROOT_DIR/functions"
firebase deploy --only functions

cd "$ROOT_DIR"
firebase deploy --only hosting

echo "Deploy complete."
