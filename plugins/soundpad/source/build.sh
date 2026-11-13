#!/bin/sh
# Bundles the helper (and the ws library) into one file: patch/index.js
set -e
cd "$(dirname "$0")"
npx esbuild src/main.js --bundle --platform=node --target=node20 --format=cjs --outfile=dist/patch/index.js \
  --external:bufferutil --external:utf-8-validate --log-level=warning
echo built dist/patch/index.js
