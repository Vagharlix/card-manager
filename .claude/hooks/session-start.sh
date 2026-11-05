#!/bin/bash
# Sessions Claude Code cloud : installe les deps du front (app/) pour que
# typecheck, test:unit et generate soient utilisables dès le départ.
# Pas d'E2E ici (WebKit + tauri-driver + build Rust) : c'est le rôle de la CI.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}/app"

# ne réinstalle que si le script, le manifeste ou le lockfile a changé
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  pnpm install --ignore-workspace --frozen-lockfile
  sha256sum ../.claude/hooks/session-start.sh package.json pnpm-lock.yaml > "$hashes"
fi
