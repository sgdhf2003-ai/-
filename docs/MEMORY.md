# Project Memory

This file is the project-local memory index for durable context that future agents should read from the canonical cloud-drive checkout.

It is not a secret store and must not contain tokens, credentials, private deployment URLs, or live customer identifiers.

All durable JYAI project data, generated docs, stage notes, handoff notes, specs, plans, tasks, and memory records must live inside the canonical local cloud-drive-backed project checkout. Scratch workspace and chat memory are temporary transfer surfaces only, not official storage.

## Canonical Context

- Canonical checkout: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
- Stale or backup locations: old Developer checkout, Documents checkouts, scratch workspaces, and exported copies unless the Owner explicitly reassigns the project root.
- Scratch workspace and chat memory are non-authoritative; copy any durable project material into the canonical checkout before relying on it as project state.
- Product North Star: Sales Assistant / Admin users, 配貨與出貨資料自動化管理助手, Inbound 去保留 -> Outbound 待出貨銷扣.

## Current Stage Memory

- Stage 24-B3/B3C commit on `stage-24-b3-production-contract-spec`: production allocation persistence contract and cloud-drive boundary alignment.
- Stage 24-B3E local governance drift alignment: `docs/DECISIONS.md` and `scripts/preflight-check.sh` now point at the cloud-drive checkout.
- Stage 24-DOCS-A: AI project docs structure, document map, and stale-path governance cleanup. No B4 implementation, deploy, Sheet write, LINE API call, token/secret access, commit, or push.

## Durable References

| Topic | File |
| --- | --- |
| Cross-agent operating rules | `AGENTS.md` |
| Source and deploy boundaries | `PROJECT_BOUNDARIES.md` |
| Durable decisions | `docs/DECISIONS.md` |
| Current stage state | `docs/stages/CURRENT_HANDOFF.md` |
| Allocation Assistant handoff | `docs/allocation-assistant/CURRENT_HANDOFF.md` |
| Production persistence contract | `docs/stages/stage-24-b3-production-contract-spec.md` |
| AI navigation and workflow | `docs/ai/README.md`, `docs/ai/SKILL.md` |
| Architecture and product design | `ARCHITECTURE.md`, `DESIGN.md` |

## Verification Memory

Safe local checks for documentation/governance stages:

```bash
npm run simulate:all
python3 deploy.py backend --check
python3 deploy.py line-bot --check
git diff --check
git diff --cached --stat
git status -sb
```

`deploy.py --check` must report dry-run behavior and no clasp command execution. These checks do not prove live Sheet, LINE, Apps Script wrapper, or deployment state.

## Open Decisions

- `CANCEL_RELEASE` ledger semantics before B4.
- Whether and when to merge/push Stage 24-DOCS-A after commit readiness review.
