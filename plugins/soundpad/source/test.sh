#!/bin/sh
# Builds, packages, then runs all tests on Node 20 (NODE20 = node binary) and PowerShell 7 (PWSH).
set -e
cd "$(dirname "$0")"
./package.sh >/dev/null
NODE=${NODE20:-node}
NODE20=$NODE "$NODE" --test test/patch.test.js
./test/installer-test.sh
