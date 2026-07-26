# AI Agent Document Map

This directory contains AI-facing navigation for work on the canonical `jingyang-sales-app` checkout.

## Start Here

1. Read `AGENTS.md` from the project root first.
2. Confirm the canonical checkout path:
   `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
3. Run preflight from that checkout.
4. Read the current handoff files before audit or implementation.
5. Follow the active stage's allowed scope exactly.

## Required Reads by Work Type

| Work type | Required files |
| --- | --- |
| Any work | `AGENTS.md`, `PROJECT_BOUNDARIES.md`, `docs/DECISIONS.md` |
| Stage continuation | `docs/stages/CURRENT_HANDOFF.md`, active stage spec |
| Allocation Assistant | `docs/allocation-assistant/CURRENT_HANDOFF.md`, `docs/allocation-assistant/ROADMAP.md`, relevant allocation source/tests |
| Persistence work | `docs/stages/stage-24-b3-production-contract-spec.md`, `ARCHITECTURE.md`, `DESIGN.md` |
| Commit readiness | `git diff --stat`, scoped diff, safe verification results |

## Canonical Files

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Cross-agent operating rules and safety gates |
| `ARCHITECTURE.md` | System architecture and source boundaries |
| `DESIGN.md` | Product design and assistant workflow principles |
| `docs/MEMORY.md` | Project-local memory index |
| `docs/DECISIONS.md` | Durable governance decisions |
| `PROJECT_BOUNDARIES.md` | Canonical path and deployment boundary rules |
| `scripts/preflight-check.sh` | Local preflight helper |

## Stale Path Rule

Do not treat Developer, Documents, scratch, or exported copies as official storage. If a workbench cannot access the cloud-drive checkout, create only a transfer-ready draft and clearly say it must be copied into the proper project path.

All durable JYAI project data, generated docs, stage notes, handoff notes, specs, plans, tasks, and memory records must be saved inside the canonical local cloud-drive-backed checkout. Scratch workspace and chat memory are temporary only and must not be treated as durable source of truth.

## Safe Verification

Allowed for documentation/governance stages when the stage permits it:

```bash
npm run simulate:all
python3 deploy.py backend --check
python3 deploy.py line-bot --check
git diff --check
git diff --cached --stat
git status -sb
```

No deploy, Sheet write, LINE API call, token/secret access, Apps Script production wrapper execution, commit, or push is implied by these checks.
