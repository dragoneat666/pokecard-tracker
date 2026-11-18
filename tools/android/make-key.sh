#!/bin/bash
# Makes the app's signing key in /signing (once, on the server). The password
# is made up here and only written to /signing/signing.env, never shown.
set -euo pipefail
if [ -e /signing/pokecard-tracker.keystore ]; then echo "A signing key already exists; keep using it." >&2; exit 1; fi
P=$(head -c 48 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 32)
keytool -genkeypair -keystore /signing/pokecard-tracker.keystore -storetype PKCS12 -alias pokecard \
  -keyalg RSA -keysize 2048 -validity 36500 -storepass "$P" -keypass "$P" -dname "CN=PokeCard Tracker" > /dev/null 2>&1
printf 'KEYSTORE_PASSWORD=%s\nKEY_ALIAS=pokecard\nKEY_PASSWORD=%s\n' "$P" "$P" > /signing/signing.env
echo "Signing key made"
