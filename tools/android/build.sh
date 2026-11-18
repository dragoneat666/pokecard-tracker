#!/bin/bash
# Builds the signed PokeCard Tracker Android app (an APK).
#   /src      the repo (read-only)
#   /signing  pokecard-tracker.keystore + signing.env (KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD)
#   /out      gets pokecard-tracker.apk and version.json (the folder the
#             backend serves at /download)
# VERSION_CODE / VERSION_NAME come from the environment (build-app.ps1 on the
# server sets them). Mount volumes on /root/.gradle and /root/.npm to keep
# downloads between builds.
set -euo pipefail

: "${VERSION_CODE:?set VERSION_CODE}"
: "${VERSION_NAME:?set VERSION_NAME}"

# Work on a copy so nothing is written into the source folder.
rm -rf /work && mkdir -p /work/frontend
cd /src/frontend
tar --exclude=./node_modules --exclude=./dist --exclude=./public/lab-samples -cf - . | (cd /work/frontend && tar xf -)
cd /work/frontend
# No lockfile in this repo (the server images install the same way).
npm install --no-audit --no-fund --loglevel=error

set -a
# shellcheck disable=SC1091
. /signing/signing.env
set +a
export KEYSTORE_FILE=/signing/pokecard-tracker.keystore

npm run android

cd android
chmod +x gradlew
./gradlew assembleRelease --no-daemon -q

mkdir -p /out
cp app/build/outputs/apk/release/app-release.apk /out/pokecard-tracker.apk.new
mv /out/pokecard-tracker.apk.new /out/pokecard-tracker.apk
printf '{"versionCode":%s,"versionName":"%s"}\n' "$VERSION_CODE" "$VERSION_NAME" > /out/version.json
echo "Built PokeCard Tracker $VERSION_NAME (code $VERSION_CODE): $(du -h /out/pokecard-tracker.apk | cut -f1)"
