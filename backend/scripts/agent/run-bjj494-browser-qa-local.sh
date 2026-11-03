#!/usr/bin/env bash
# BJJ494 only. Real auth/tenant/action paths, fresh guarded PG16, deterministic
# external models/vendors. Ctrl-C stops owned Next groups before restoring URL.
# Usage: bash backend/scripts/agent/run-bjj494-browser-qa-local.sh --mode agent --role admin
# Restart after full shutdown with --mode legacy --role admin (then --role user).
# After forced kill: stop recorded owned groups/cluster, verify ports closed,
# then invoke this runner with --recover before attempting another start.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$BACKEND_DIR"
# No inherited secrets, credentials, NODE_OPTIONS, test mapping or provider keys.
# Typechecking ts-node is deliberate; never add --transpile-only.
exec env -i \
  PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH" \
  HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" USER="${USER:-local}" LANG="${LANG:-en_US.UTF-8}" \
  NODE_PATH=. \
  pnpm exec ts-node scripts/agent/bjj494-browser-qa.ts "$@"
