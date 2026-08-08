#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/workbench-context-gate.sh [--check] [--remote-check]

--check          Validate the current checkout locally (default).
--remote-check   Also query origin/main with git ls-remote; read-only network call.
USAGE
}

remote_check=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) ;;
    --remote-check) remote_check=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "CONTEXT_GATE=BLOCKED"
  echo "REASON=not_a_git_repository"
  exit 10
fi

repo_root="$(cd "$repo_root" && pwd -P)"
branch="$(git -C "$repo_root" branch --show-current)"
head="$(git -C "$repo_root" rev-parse HEAD)"
origin="$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)"
dirty="$(git -C "$repo_root" status --porcelain=v1)"

if [[ ! -f "$repo_root/AGENTS.md" ]]; then
  echo "CONTEXT_GATE=BLOCKED"
  echo "REASON=missing_AGENTS.md"
  exit 11
fi

canonical_root="${JYAI_CANONICAL_REPO_ROOT:-}"
if [[ -z "$canonical_root" && -f "$repo_root/.workbench/canonical-root" ]]; then
  canonical_root="$(sed -n '1p' "$repo_root/.workbench/canonical-root")"
fi
if [[ -n "$canonical_root" ]]; then
  canonical_root="$(cd "$canonical_root" 2>/dev/null && pwd -P || true)"
fi

if [[ -n "$canonical_root" && "$repo_root" == "$canonical_root" ]]; then
  checkout_kind="CANONICAL"
else
  checkout_kind="RECOVERY_OR_UNKNOWN"
fi

if [[ -n "$dirty" ]]; then
  working_tree="DIRTY"
else
  working_tree="CLEAN"
fi

status="PASS"
reason=""
if [[ "$branch" != "main" ]]; then
  status="BLOCKED"
  reason="branch_is_not_main"
elif [[ -z "$origin" ]]; then
  status="BLOCKED"
  reason="origin_remote_missing"
fi

echo "CONTEXT_GATE=$status"
echo "CHECKOUT_KIND=$checkout_kind"
echo "REPO_ROOT=$repo_root"
echo "BRANCH=$branch"
echo "HEAD=$head"
echo "ORIGIN=$origin"
echo "WORKING_TREE=$working_tree"
if [[ -n "$canonical_root" ]]; then
  echo "EXPECTED_CANONICAL_ROOT=$canonical_root"
fi
if [[ -n "$reason" ]]; then
  echo "REASON=$reason"
fi

if [[ "$remote_check" == 1 && -n "$origin" ]]; then
  remote_head="$(git ls-remote "$origin" refs/heads/main | awk 'NR == 1 {print $1}')"
  if [[ -z "$remote_head" ]]; then
    echo "REMOTE_PARITY=BLOCKED"
    echo "REMOTE_REASON=origin_main_not_readable"
    exit 12
  fi
  echo "ORIGIN_MAIN=$remote_head"
  if [[ "$head" == "$remote_head" ]]; then
    echo "REMOTE_PARITY=0_ahead_0_behind"
  else
    echo "REMOTE_PARITY=DIFFERENT"
    exit 13
  fi
fi

if [[ "$status" != PASS ]]; then
  exit 14
fi
