#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/phosphor-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  index.html \
  main.js \
  style.css \
  background.js \
  lua-sandbox.html \
  lua-sandbox.js \
  c64-sandbox.html \
  c64-sandbox.js \
  commands/ \
  core/ \
  ui/ \
  fonts/ \
  vendor/ \
  phos16.png \
  phos48.png \
  phos128.png \
  -x "**/.DS_Store"

echo "Built $OUT ($(du -sh "$OUT" | cut -f1))"
