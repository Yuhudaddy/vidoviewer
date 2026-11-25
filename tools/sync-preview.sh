#!/bin/sh
# Rebuild the integration and mirror it into the fixed directory both previews serve.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
dest=${1:-/private/tmp/vidoviewer-preview}
out=$("$root/tools/prepare-design-integration.sh")
mkdir -p "$dest"
rsync -a --delete "$out"/ "$dest"/
rm -rf "$out"
printf '%s\n' "$dest"
