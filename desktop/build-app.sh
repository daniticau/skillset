#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
DESKTOP_DIR="$ROOT_DIR/desktop"
APP_DIR="$DESKTOP_DIR/build/Skillset.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
ICONSET_DIR="$DESKTOP_DIR/.build/Skillset.iconset"
NODE_PATH="$(command -v node)"

cd "$ROOT_DIR"
pnpm build
swift build -c release --package-path "$DESKTOP_DIR"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
cp "$DESKTOP_DIR/.build/release/Skillset" "$MACOS_DIR/Skillset"
cp "$DESKTOP_DIR/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$ROOT_DIR/dist-app/cli.cjs" "$RESOURCES_DIR/skillset-cli.cjs"
print -r -- "$NODE_PATH" > "$RESOURCES_DIR/node-path.txt"

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" "$ROOT_DIR/site/assets/skillset-logo-gpt.png" \
    --out "$ICONSET_DIR/icon_${SIZE}x${SIZE}.png" >/dev/null
  DOUBLE_SIZE=$((SIZE * 2))
  sips -z "$DOUBLE_SIZE" "$DOUBLE_SIZE" "$ROOT_DIR/site/assets/skillset-logo-gpt.png" \
    --out "$ICONSET_DIR/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/Skillset.icns"
rm -rf "$ICONSET_DIR"

codesign --force --sign - "$APP_DIR"

print -r -- "$APP_DIR"
