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
