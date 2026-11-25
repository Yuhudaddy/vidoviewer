#!/bin/sh
# Assemble a disposable local integration without modifying the designer's worktree.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
design="$root/../liya-design/styles"
out=$(mktemp -d "${TMPDIR:-/tmp}/vidoviewer-design.XXXXXX")
mkdir -p "$out/styles" "$out/core" "$out/vendor"
cp "$root"/index.html "$root"/design-bridge.css "$root"/readout-adjustments.css "$root"/app.js "$root"/home.js "$root"/library.js "$root"/renderer.js "$root"/demo.js "$root"/parse-lifecycle.js "$root"/sw.js "$root"/manifest.webmanifest "$root"/_headers "$out/"
cp -R "$root/example" "$root/icons" "$out/"
cp "$root"/../yunobo-core/core/*.js "$out/core/"
cp "$root"/../yunobo-core/vendor/acad-ts-3.9.0.min.js "$out/vendor/"
mkdir -p "$out/tests"
cp "$root"/tests/*.html "$root"/tests/*.js "$root"/tests/*.dxf "$out/tests/"
cp "$design/tokens.css" "$design/components.css" "$out/styles/"
# One cache per sync (timestamp), so a browser that already cached the shell never serves stale files after an edit.
sed -i '' "s/vidoviewer-shell-/vidoviewer-design-$(date +%s)-/" "$out/sw.js"
printf '%s\n' "$out"
