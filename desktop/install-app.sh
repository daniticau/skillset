#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
SOURCE_APP="$ROOT_DIR/desktop/build/Skillset.app"
INSTALL_ROOT="${SKILLSET_APP_INSTALL_DIR:-$HOME/Applications}"
DESTINATION_APP="$INSTALL_ROOT/Skillset.app"

"$ROOT_DIR/desktop/build-app.sh" >/dev/null
mkdir -p "$INSTALL_ROOT"
rm -rf "$DESTINATION_APP"
ditto "$SOURCE_APP" "$DESTINATION_APP"
open "$DESTINATION_APP"

print -r -- "$DESTINATION_APP"
