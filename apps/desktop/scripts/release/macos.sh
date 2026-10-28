#!/usr/bin/env bash
set -euo pipefail
umask 077

keychain="$RUNNER_TEMP/signing.keychain-db"
api_key="$RUNNER_TEMP/notary.p8"

notary() {
  xcrun notarytool "$@" --key "$api_key" --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER"
}

case "${1:-}" in
  keychain)
    password="$(openssl rand -base64 32)"
    security create-keychain -p "$password" "$keychain"
    security set-keychain-settings -lut 21600 "$keychain"
    security unlock-keychain -p "$password" "$keychain"
    printf '%s' "$APPLE_CERTIFICATE_P12" | base64 --decode >"$RUNNER_TEMP/certificate.p12"
    security import "$RUNNER_TEMP/certificate.p12" -k "$keychain" \
      -P "$APPLE_CERTIFICATE_PASSWORD" -x -T /usr/bin/codesign
    rm -f "$RUNNER_TEMP/certificate.p12"
    security set-key-partition-list -S apple-tool:,apple: -s -k "$password" "$keychain" >/dev/null
    security list-keychains -d user -s "$keychain"
    printf '%s' "$APPLE_API_KEY_P8" >"$api_key"
    ;;
  notarize)
    target="$2"
    upload="$target"
    if [ -d "$target" ]; then
      upload="$RUNNER_TEMP/notarize.zip"
      ditto -c -k --keepParent "$target" "$upload"
    fi
    result="$(notary submit "$upload" --wait --output-format json)" || true
    if [ "$(jq -r .status <<<"$result")" != Accepted ]; then
      notary log "$(jq -r .id <<<"$result")" || true
      echo "::error::Apple did not notarize $(basename "$target")"
      exit 1
    fi
    rm -f "$RUNNER_TEMP/notarize.zip"
    xcrun stapler staple "$target"
    xcrun stapler validate "$target"
    ;;
  sign-dmg)
    codesign --sign "$APPLE_SIGNING_IDENTITY" --keychain "$keychain" --timestamp "$2"
    ;;
  same-app)
    expected="$(codesign -dv --verbose=4 "$2" 2>&1 | sed -n 's/^CDHash=//p')"
    work="$(mktemp -d)"
    case "$3" in
      *.zip)
        ditto -x -k "$3" "$work"
        app="$work/$(basename "$2")"
        ;;
      *.dmg)
        hdiutil attach -nobrowse -readonly -mountpoint "$work/volume" "$3" >/dev/null
        app="$work/volume/$(basename "$2")"
        ;;
      *)
        echo "Usage: macos.sh same-app <signed .app> <zip or dmg>" >&2
        exit 2
        ;;
    esac
    codesign --verify --deep --strict "$app"
    actual="$(codesign -dv --verbose=4 "$app" 2>&1 | sed -n 's/^CDHash=//p')"
    if [ -d "$work/volume" ]; then
      hdiutil detach "$work/volume" -quiet
    fi
    if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
      echo "::error::$(basename "$3") doesn't hold the app that was signed"
      exit 1
    fi
    ;;
  cleanup)
    security delete-keychain "$keychain" 2>/dev/null || true
    rm -f "$api_key" "$RUNNER_TEMP/notarize.zip" "$RUNNER_TEMP/certificate.p12"
    ;;
  *)
    echo "Usage: macos.sh keychain|notarize <path>|sign-dmg <dmg>|same-app <app> <zip or dmg>|cleanup" >&2
    exit 2
    ;;
esac
