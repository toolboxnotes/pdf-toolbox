#!/bin/bash
# PDF Toolbox launcher (macOS)
# Opens PDF-Toolbox.html in Chrome / Edge / Brave "app mode": its own window, with no address bar or tabs.
# Falls back to Safari when none of them is installed.
CONTENTS="$(cd "$(dirname "$0")/.." && pwd)"
HTML="$CONTENTS/Resources/PDF-Toolbox.html"
if [ ! -f "$HTML" ]; then
  # Also works with the .app placed next to PDF-Toolbox.html
  HTML="$(cd "$CONTENTS/../.." && pwd)/PDF-Toolbox.html"
fi
if [ ! -f "$HTML" ]; then
  osascript -e 'display alert "PDF Toolbox" message "PDF-Toolbox.html was not found."' >/dev/null 2>&1
  exit 1
fi
ENC="$(printf '%s' "$HTML" | sed -e 's/%/%25/g' -e 's/ /%20/g' -e 's/#/%23/g' -e 's/?/%3F/g')"
URL="file://$ENC"
PROFILE="$HOME/Library/Application Support/PDF Toolbox/Browser"
for NAME in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium"; do
  for ROOT in "/Applications" "$HOME/Applications"; do
    BIN="$ROOT/$NAME.app/Contents/MacOS/$NAME"
    if [ -x "$BIN" ]; then
      mkdir -p "$PROFILE"
      "$BIN" --app="$URL" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check --window-size=1280,860 >/dev/null 2>&1 &
      exit 0
    fi
  done
done
open -a Safari "$HTML" 2>/dev/null || open "$HTML"
