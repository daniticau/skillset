#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
DESKTOP_DIR="$ROOT_DIR/desktop"
APP_DIR="$DESKTOP_DIR/build/Skillset.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
BUILD_DIR="$DESKTOP_DIR/.build"
ROOT_MARKER="$BUILD_DIR/.skillset-root"
ICONSET_DIR="$BUILD_DIR/Skillset.iconset"
# Pin the node the user's login shell resolves. Under `pnpm app:install` the
# PATH carries pnpm's own bundled node, which may not exist later.
NODE_PATH="$(${SHELL:-/bin/zsh} -lc 'command -v node' 2>/dev/null || command -v node)"

cd "$ROOT_DIR"
pnpm build

# SwiftPM's module cache bakes in absolute paths. If this checkout moved since
# the last build, every .pcm in it is unusable and swift build fails with
# "was compiled with module cache path ...". Detect the move and start clean.
if [[ -d "$BUILD_DIR" ]]; then
  if [[ ! -f "$ROOT_MARKER" || "$(<"$ROOT_MARKER")" != "$ROOT_DIR" ]]; then
    print -r -- "desktop/.build was built at a different path; clearing it" >&2
    rm -rf "$BUILD_DIR"
  fi
fi
mkdir -p "$BUILD_DIR"
print -r -- "$ROOT_DIR" > "$ROOT_MARKER"

# Belt and braces: a stale cache the marker did not catch still gets one clean retry.
if ! swift build -c release --package-path "$DESKTOP_DIR"; then
  print -r -- "swift build failed; clearing desktop/.build and retrying once" >&2
  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR"
  print -r -- "$ROOT_DIR" > "$ROOT_MARKER"
  swift build -c release --package-path "$DESKTOP_DIR"
fi

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
