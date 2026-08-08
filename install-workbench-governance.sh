#!/usr/bin/env bash
set -euo pipefail

# One-time installer for the canonical jingyang-sales-app checkout.
# It only creates local governance files. It does not commit, push, deploy,
# write Google Sheets, call LINE, or read secrets.

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "ERROR: run this script from inside the canonical Git checkout." >&2
  exit 1
fi

if [[ ! -f "$repo_root/AGENTS.md" ]]; then
  echo "ERROR: AGENTS.md is missing; refusing to modify an unrecognised repo." >&2
  exit 1
fi

mkdir -p "$repo_root/scripts" "$repo_root/docs/workbench" "$repo_root/.workbench"

cat > "$repo_root/scripts/workbench-context-gate.sh" <<'GATE'
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
GATE

chmod +x "$repo_root/scripts/workbench-context-gate.sh"

cat > "$repo_root/.workbench/canonical-root" <<EOF
$repo_root
EOF

if ! grep -q 'WORKBENCH_CONTEXT_GATE_START' "$repo_root/AGENTS.md"; then
  cat >> "$repo_root/AGENTS.md" <<'RULES'

## Workbench Context Gate

<!-- WORKBENCH_CONTEXT_GATE_START -->

Before any project work, run:

```bash
scripts/workbench-context-gate.sh --check
```

The gate must report `CONTEXT_GATE=PASS`, `BRANCH=main`, `WORKING_TREE=CLEAN`,
and a non-empty `ORIGIN`. Run `--remote-check` when remote parity is required.

The checkout classification is authoritative:

- `CANONICAL`: the durable Mac Google Drive checkout; normal changes are allowed only with the user's explicit scope.
- `RECOVERY_OR_UNKNOWN`: a temporary checkout used when the canonical Mac path is unavailable; allow read-only inspection, tests, and dry-runs only.
- A directory without `AGENTS.md`, the expected remote, or the expected branch is not an authorised project checkout.

Never claim that a scratch directory is the canonical project. Never deploy,
write Google Sheets, call LINE APIs, access or rotate secrets, commit, or push
from a recovery checkout unless the user explicitly authorises that exact
operation and the checkout has first been reclassified and verified.

When a new workbench cannot see the Mac Google Drive path, clone the private
`origin` into a temporary recovery directory, run the gate there, and keep all
durable project files in the canonical checkout. Do not ask the user to paste
the project context again when `AGENTS.md` and the remote repository are
available.

<!-- WORKBENCH_CONTEXT_GATE_END -->
RULES
fi

cat > "$repo_root/docs/workbench/RECOVERY_WORKFLOW.md" <<'DOC'
# Workbench Recovery Workflow

The Mac Google Drive checkout remains the canonical durable project location.
Git `origin/main` is the cross-workbench recovery source when a workbench
cannot mount that path.

## Canonical checkout

From the canonical repo root:

```bash
scripts/workbench-context-gate.sh --check
scripts/workbench-context-gate.sh --remote-check
```

The expected result is `CHECKOUT_KIND=CANONICAL`, `CONTEXT_GATE=PASS`, and
`REMOTE_PARITY=0_ahead_0_behind`.

## Recovery checkout

In a workbench that cannot access the Mac path, create a temporary checkout
from the private repository URL:

```bash
git clone --branch main <PRIVATE_ORIGIN_URL> /workspace/recovery/jingyang-sales-app
cd /workspace/recovery/jingyang-sales-app
scripts/workbench-context-gate.sh --check
scripts/workbench-context-gate.sh --remote-check
```

Replace `<PRIVATE_ORIGIN_URL>` with the existing `origin` URL; do not print or
store credentials in this document. A recovery checkout is for read-only
inspection, tests, and dry-runs. Changes must be reviewed and synchronised
back in the canonical checkout before production use.

## Startup rule

Every new agent or workbench reads `AGENTS.md` and runs the context gate before
touching project files. If the gate is blocked, stop and report the exact
reason; do not infer that the current scratch directory is the project.
DOC

echo "Installed workbench governance files in: $repo_root"
echo "Created: scripts/workbench-context-gate.sh"
echo "Updated: AGENTS.md (idempotent marker section)"
echo "Created: docs/workbench/RECOVERY_WORKFLOW.md"
echo "Created: .workbench/canonical-root"
echo
echo "Next safe check:"
echo "  scripts/workbench-context-gate.sh --check"
echo "No commit, push, deploy, Sheet write, LINE call, or secret access was performed."
