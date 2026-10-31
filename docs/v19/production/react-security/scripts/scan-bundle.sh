#!/bin/sh
# Usage: sh scan-bundle.sh [build-dir]        (default: dist; run after `npm run build`)
# Scans a built React app for what must never ship: secret-looking strings, source maps that are served or
# referenced, and inline scripts a strict Content Security Policy will block. Prints file names and the kind
# of finding, never the matched text, so the output is safe for CI logs.
# Exit code: 0 when clean, 1 when a secret or a referenced source map was found, 2 on a usage error.
# POSIX sh, grep and find only; no dependencies.

case "${1:-}" in
  -h|--help) echo "Usage: sh scan-bundle.sh [build-dir]   (default: dist; exit 1 on a secret or a referenced source map)"; exit 0 ;;
esac

dir=${1:-dist}
if [ ! -d "$dir" ]; then
  echo "Usage: sh scan-bundle.sh [build-dir]   ($dir is not a directory; build first)" >&2
  exit 2
fi

status=0
tab=$(printf '\t')

# name<TAB>extended regular expression; read through a here-document so status changes stay in this shell
echo "Scanning $dir"
while IFS="$tab" read -r name regex; do
  [ -n "$regex" ] || continue
  files=$(grep -rIlE -- "$regex" "$dir" 2>/dev/null)
  if [ -n "$files" ]; then
    echo "SECRET  $name in:"
    echo "$files" | sed 's/^/          /'
    status=1
  fi
done <<PATTERNS
Stripe secret key${tab}sk_live_[0-9A-Za-z]{10,}
Stripe restricted key${tab}rk_live_[0-9A-Za-z]{10,}
Private key block${tab}-----BEGIN [A-Z ]*PRIVATE KEY-----
AWS access key id${tab}AKIA[0-9A-Z]{16}
GitHub token${tab}gh[pousr]_[0-9A-Za-z]{30,}
Slack token${tab}xox[abprs]-[0-9A-Za-z-]{10,}
OpenAI-style secret key${tab}sk-(proj-)?[0-9A-Za-z_-]{30,}
Database URL with password${tab}(postgres(ql)?|mysql|mongodb(\\+srv)?|redis)://[^/:@" ]+:[^@" ]+@
PATTERNS

maps=$(find "$dir" -type f -name '*.map' | head -n 20)
if [ -n "$maps" ]; then
  echo "WARN    source map files in the build (upload them to the error tracker, do not deploy them):"
  echo "$maps" | sed 's/^/          /'
fi
referenced=$(grep -rIl 'sourceMappingURL=' "$dir" --include='*.js' --include='*.css' 2>/dev/null | head -n 20)
if [ -n "$referenced" ]; then
  echo "SOURCEMAP  bundles point browsers at their maps (use build.sourcemap: 'hidden'):"
  echo "$referenced" | sed 's/^/          /'
  status=1
fi

if [ -f "$dir/index.html" ] && grep -Eq '<script>|<script( type="module")?>' "$dir/index.html"; then
  echo "WARN    index.html has an inline script: add its sha256 hash to script-src or move it to a file"
fi

[ "$status" -eq 0 ] && echo "No secrets or referenced source maps found."
exit "$status"
