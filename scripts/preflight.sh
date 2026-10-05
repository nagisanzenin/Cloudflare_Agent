#!/usr/bin/env bash
# Read-only pre-flight for a project that is about to be set up, deployed or operated on Cloudflare.
# Creates nothing, deploys nothing, costs nothing. Exit code 1 if any check FAILs.
#
# Usage: bash preflight.sh [project-dir]       default: current directory
# Env:   PREFLIGHT_ENV=staging                 dry-run a named wrangler environment
#        PREFLIGHT_SKIP_AUTH=1                 skip `wrangler whoami`, the only check that calls the Cloudflare API
set -uo pipefail

dir="${1:-.}"
cd "$dir" || { echo "FAIL  cannot enter $dir"; exit 1; }

fails=0
warns=0
pass() { printf 'PASS  %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; warns=$((warns + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; fails=$((fails + 1)); }

export WRANGLER_SEND_METRICS=false

# 1. Node version (wrangler 4 declares engines.node >= 22)
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -ge 22 ]; then
  pass "node $(node -v)"
else
  fail "node >= 22 is required by wrangler 4 (found: $(node -v 2>/dev/null || echo none))"
fi

# 2. Wrangler config
config=""
for f in wrangler.jsonc wrangler.json wrangler.toml; do
  if [ -f "$f" ]; then config="$f"; break; fi
done
if [ -z "$config" ]; then
  fail "no wrangler.jsonc, wrangler.json or wrangler.toml in $(pwd)"
else
  pass "config $config"
  if grep -Eq '"?compatibility_date"?[[:space:]]*[:=]' "$config"; then
    pass "compatibility_date is set"
  else
    fail "compatibility_date is missing from $config"
  fi
  if grep -Eq '0{8}-0{4}-0{4}|"0{32}"|<[A-Za-z][A-Za-z0-9 _-]*>' "$config"; then
    warn "placeholder resource ids in $config: create the resources and fill the ids in before deploying"
  fi
fi

# 3. Wrangler is a local dev dependency (so the version is pinned by the lockfile)
if wrangler_version="$(npx --no-install wrangler --version 2>/dev/null | tail -1)"; then
  pass "wrangler $wrangler_version (local)"
  have_wrangler=1
else
  fail "wrangler is not installed in this project: npm install --save-dev wrangler"
  have_wrangler=0
fi

# 4. Secrets hygiene
if [ -f .gitignore ] && grep -Eq '^\.dev\.vars' .gitignore && grep -Eq '^\.wrangler' .gitignore; then
  pass ".gitignore covers .dev.vars and .wrangler"
else
  warn ".gitignore should list .dev.vars*, .env* and .wrangler/"
fi
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  tracked="$(git ls-files | grep -E '(^|/)(\.dev\.vars|\.env)(\.|$)' | grep -Ev '\.example$' || true)"
  if [ -n "$tracked" ]; then
    fail "secret files are tracked by git: $(echo "$tracked" | tr '\n' ' ')"
  else
    pass "no .dev.vars or .env files tracked by git"
  fi
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    warn "uncommitted changes: commit before deploying so every deployed version maps to a commit"
  else
    pass "git working tree is clean"
  fi
else
  warn "not a git repository: nothing to roll the source back to"
fi

# 5. Authentication (never prints account details)
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  pass "CLOUDFLARE_API_TOKEN is set"
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || warn "CLOUDFLARE_ACCOUNT_ID is not set: required when the token can see more than one account"
elif [ "${PREFLIGHT_SKIP_AUTH:-0}" = "1" ]; then
  warn "auth check skipped"
elif [ "$have_wrangler" = "1" ]; then
  if npx --no-install wrangler whoami 2>&1 | grep -qi "not authenticated"; then
    warn "not authenticated: fine for local dev; before deploying a human must run 'npx wrangler login' or provide CLOUDFLARE_API_TOKEN"
  else
    pass "wrangler is authenticated"
  fi
fi

# 6. The project bundles (offline, uploads nothing)
if [ "$have_wrangler" = "1" ] && [ -n "$config" ]; then
  out="$(mktemp -d)"
  if log="$(npx --no-install wrangler deploy --dry-run --outdir "$out" ${PREFLIGHT_ENV:+--env "$PREFLIGHT_ENV"} 2>&1)"; then
    pass "wrangler deploy --dry-run${PREFLIGHT_ENV:+ --env $PREFLIGHT_ENV}"
  else
    fail "wrangler deploy --dry-run failed:"
    echo "$log" | tail -15 | sed 's/^/      /'
  fi
  rm -rf "$out"
fi

echo "preflight: $fails fail, $warns warn"
[ "$fails" -eq 0 ]
