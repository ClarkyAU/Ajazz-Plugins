#!/bin/sh
# Runs the real install.ps1 / uninstall.ps1 under PowerShell 7 against a copy of the store
# plugin's manifest (PWSH = path to pwsh). Run package.sh first.
set -e
cd "$(dirname "$0")/.."
PWSH=${PWSH:-pwsh}
OUT=test/out/installer; rm -rf $OUT; mkdir -p $OUT/rel $OUT/plugins/com.hotspot.soundpad.sdPlugin
unzip -q dist/releases/com.hotspot.soundpad-patch-*[0-9].zip -d $OUT/rel
P=$OUT/plugins/com.hotspot.soundpad.sdPlugin
cp test/fixtures/manifest.store-1.0.260929.json $P/manifest.json
ORIG=$(sha1sum < $P/manifest.json)
fail() { echo "FAIL: $1"; exit 1; }
run() { $PWSH -NoProfile -File $OUT/rel/$1 -PluginsDir $OUT/plugins -NoRestart; }
run install.ps1 >/dev/null || fail "install exit code"
grep -q '"CodePathWin": "patch/index.js"' $P/manifest.json || fail "manifest not patched"
node -e "JSON.parse(require('fs').readFileSync('$P/manifest.json','utf8'))" || fail "manifest not valid JSON"
[ "$(sha1sum < $P/manifest.json)" = "$(sha1sum < test/fixtures/manifest.patched-hw.json)" ] || fail "patched manifest differs from the one confirmed on the PC"
cmp -s $P/patch/index.js dist/patch/index.js || fail "helper not copied"
[ "$(sha1sum < $P/manifest.original.json)" = "$ORIG" ] || fail "backup differs"
echo "ok install"
run install.ps1 >/dev/null || fail "second install"
[ "$(grep -c CodePathWin $P/manifest.json)" = 1 ] || fail "second install patched twice"
[ "$(sha1sum < $P/manifest.original.json)" = "$ORIG" ] || fail "second install overwrote the backup"
echo "ok install twice"
run uninstall.ps1 >/dev/null || fail "uninstall exit code"
[ "$(sha1sum < $P/manifest.json)" = "$ORIG" ] || fail "uninstall did not restore the manifest"
[ ! -e $P/patch ] && [ ! -e $P/manifest.original.json ] || fail "uninstall left patch files"
echo "ok uninstall"
sed 's/"CodePath": "SoundpadPlugin.exe",/"CodePath": "SoundpadPlugin2.exe",/' test/fixtures/manifest.store-1.0.260929.json > $P/manifest.json
B=$(sha1sum < $P/manifest.json)
if run install.ps1 >/dev/null; then fail "installed on an unknown plugin version"; fi
[ "$(sha1sum < $P/manifest.json)" = "$B" ] && [ ! -e $P/patch ] || fail "changed files on an unknown version"
echo "ok refuses an unknown version"
rm -rf $OUT/plugins/com.hotspot.soundpad.sdPlugin
if run install.ps1 >/dev/null; then fail "installed without the store plugin"; fi
echo "ok refuses without the store plugin"
echo "installer tests passed"
