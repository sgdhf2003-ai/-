#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
RECOVERY="$REPO_ROOT/recovery-jingyang-sales-app"
REMOTE="https://github.com/sgdhf2003-ai/-.git"

if [[ ! -d "$RECOVERY/.git" ]]; then
  git clone --branch main --single-branch "$REMOTE" "$RECOVERY"
else
  git -C "$RECOVERY" fetch origin main
  git -C "$RECOVERY" status -sb
fi

git -C "$RECOVERY" checkout --quiet main
git -C "$RECOVERY" rev-parse HEAD
git -C "$RECOVERY" rev-parse origin/main

cd "$RECOVERY"
scripts/workbench-context-gate.sh --check --remote-check

printf '%s\n' \
  'Required reads:' \
  '  AGENTS.md' \
  '  README.md' \
  '  PROJECT_BOUNDARIES.md' \
  '  docs/stages/CURRENT_HANDOFF.md' \
  '  docs/allocation-assistant/CURRENT_HANDOFF.md' \
  '  docs/allocation-assistant/CHANGELOG.md' \
  '  docs/allocation-assistant/ROADMAP.md'
