#!/bin/zsh
# Builds Skillset.app for download: universal, signed with Developer ID,
# notarized, and stapled inside a DMG. Then uploads it to the GitHub release
# for the package version, which the site's Download button points at.
#
# Needs, once per Mac:
#   - a "Developer ID Application" certificate in the keychain
#     (Xcode > Settings > Accounts > Manage Certificates > + > Developer ID Application)
#   - notary credentials saved under the profile name below:
#     xcrun notarytool store-credentials skillset-notary --apple-id <apple-id> --team-id <team-id>
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
APP="$ROOT_DIR/desktop/build/Skillset.app"
OUT_DIR="$ROOT_DIR/desktop/build/release"
DMG="$OUT_DIR/Skillset.dmg"
PROFILE="${SKILLSET_NOTARY_PROFILE:-skillset-notary}"
VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT_DIR/package.json")"

IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1)"
if [[ -z "$IDENTITY" ]]; then
  print -r -- "No Developer ID Application certificate in the keychain. See the top of this script." >&2
  exit 1
fi

"$ROOT_DIR/desktop/build-app.sh" --release >/dev/null

# Hardened runtime and a secure timestamp are what the notary service checks.
codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
codesign --verify --strict "$APP"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/dmg"
ditto "$APP" "$OUT_DIR/dmg/Skillset.app"
ln -s /Applications "$OUT_DIR/dmg/Applications"
hdiutil create -quiet -volname Skillset -srcfolder "$OUT_DIR/dmg" -format UDZO "$DMG"
codesign --sign "$IDENTITY" --timestamp "$DMG"

xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature -v "$DMG"

TAG="v$VERSION"
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$DMG" --clobber
else
  gh release create "$TAG" "$DMG" --title "Skillset $VERSION" --notes "Download Skillset.dmg, open it, and drag Skillset to Applications. The app needs Node.js 20 or newer."
fi

print -r -- "$DMG"
