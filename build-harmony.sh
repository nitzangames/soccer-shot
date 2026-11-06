#!/usr/bin/env bash
# Build the playharmony.ai upload.
#
#   ./build-harmony.sh          → dist/soccer-shot-harmony.zip (real Harmony loader)
#   ./build-harmony.sh --fake   → dist/harmony-fake/ (Harmony's test stand-in, for local testing)
#
# Same game files as nitzan.games; only index.html differs: Harmony's loader goes
# first in <head>, plus overlay theming to match the game. game.js detects the
# loader (window.PlayHarmony) and attaches itself.
set -euo pipefail
cd "$(dirname "$0")"

LOADER="https://cdn.playharmony.ai/v1/loader.js"
OUT="dist/harmony"
if [[ "${1:-}" == "--fake" ]]; then
  LOADER="https://cdn.playharmony.ai/v1/fake-loader.js"
  OUT="dist/harmony-fake"
fi

rm -rf "$OUT"
mkdir -p "$OUT"
cp index.html game.js "$OUT/"
cp -R fonts "$OUT/"

LOADER="$LOADER" perl -0pi -e '
  my $tag = qq{<head>\n  <script src="$ENV{LOADER}"></script>};
  s{<head>}{$tag} or die "no <head> in index.html\n";
  my $theme = join "\n", "    :root {",
    "      --mtc-accent: #ffd23f;",
    "      --mtc-surface: #1d2340;",
    "      --mtc-text: #ffffff;",
    "      --mtc-backdrop: rgba(22, 29, 69, 0.65);",
    "      --mtc-radius: 14px;",
    "    }",
    "  </style>";
  s{</style>}{$theme} or die "no </style> in index.html\n";
' "$OUT/index.html"

if [[ "$OUT" == "dist/harmony" ]]; then
  rm -f dist/soccer-shot-harmony.zip
  (cd "$OUT" && zip -qr ../soccer-shot-harmony.zip .)
  echo "Built dist/soccer-shot-harmony.zip ($(du -h dist/soccer-shot-harmony.zip | cut -f1))"
else
  echo "Built $OUT/ (fake Harmony, for local testing only)"
fi
