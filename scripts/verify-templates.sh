#!/usr/bin/env bash
# Verify every template offline: generate types, typecheck, bundle with a dry-run deploy.
# Needs no Cloudflare account, makes no deploy, costs nothing.
# Usage: npm run verify            (from the repo root)
#        bash scripts/verify-templates.sh worker-api durable-object
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund || exit 1
fi

verify_one() {
  local dir="$1"
  cd "$dir" || return 1
  npx --no-install wrangler types >/dev/null || return 1
  npx --no-install tsc --noEmit || return 1
  npx --no-install wrangler deploy --dry-run --outdir .verify-out >/dev/null || return 1
  rm -rf .verify-out
}

if [ "$#" -gt 0 ]; then
  names=("$@")
else
  names=()
  for dir in templates/*/; do names+=("$(basename "$dir")"); done
fi

fail=0
for name in "${names[@]}"; do
  # A dry run builds the container image, so templates with a Dockerfile need Docker.
  if [ -f "$ROOT/templates/$name/Dockerfile" ] && ! docker info >/dev/null 2>&1; then
    echo "SKIP  $name (Docker is not running)"
    continue
  fi
  if (verify_one "$ROOT/templates/$name"); then
    echo "PASS  $name"
  else
    echo "FAIL  $name"
    fail=1
  fi
done
exit "$fail"
