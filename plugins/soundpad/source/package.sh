#!/bin/sh
# Builds, then makes the two release zips in dist/releases:
#   com.hotspot.soundpad-patch-<version>.zip         (unzip, double-click install.bat)
#   com.hotspot.soundpad-patch-<version>-source.zip  (this source, no node_modules)
set -e
cd "$(dirname "$0")"
V=$(node -p "require('./package.json').version")
./build.sh
R=dist/release; rm -rf $R dist/releases; mkdir -p $R/com.hotspot.soundpad.sdPlugin/patch dist/releases
cp dist/patch/index.js $R/com.hotspot.soundpad.sdPlugin/patch/index.js
cp plugin-files/README-PATCH.txt plugin-files/restore-original.bat $R/com.hotspot.soundpad.sdPlugin/
cp installer/install.bat installer/uninstall.bat installer/install.ps1 installer/uninstall.ps1 installer/README.txt $R/
(cd $R && zip -qrX ../releases/com.hotspot.soundpad-patch-$V.zip .)
zip -qrX dist/releases/com.hotspot.soundpad-patch-$V-source.zip README.md package.json package-lock.json build.sh test.sh package.sh src test installer plugin-files -x 'test/out/*'
unzip -l dist/releases/com.hotspot.soundpad-patch-$V.zip
echo made dist/releases
