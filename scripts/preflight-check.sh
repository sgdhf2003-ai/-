#!/usr/bin/env bash
set -euo pipefail

EXPECTED_ROOT="/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app"

echo "[preflight] pwd=$(pwd)"
ROOT="$(git rev-parse --show-toplevel)"
echo "[preflight] root=${ROOT}"
if [[ "${ROOT}" != "${EXPECTED_ROOT}" ]]; then
  echo "[preflight] ERROR: unexpected repo root" >&2
  exit 1
fi

BRANCH="$(git branch --show-current)"
echo "[preflight] branch=${BRANCH}"
if [[ "${BRANCH}" != "main" ]]; then
  echo "[preflight] ERROR: expected main branch" >&2
  exit 1
fi

echo "[preflight] status-short:"
git status --short

git fetch origin

HEAD="$(git rev-parse HEAD)"
ORIGIN="$(git rev-parse origin/main)"
RELATION="$(git rev-list --left-right --count origin/main...HEAD)"

echo "[preflight] HEAD=${HEAD}"
echo "[preflight] origin/main=${ORIGIN}"
echo "[preflight] ahead-behind=${RELATION}"

git diff --check

python3 deploy.py backend --check
python3 deploy.py line-bot --check
