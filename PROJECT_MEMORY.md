# Project Memory — jingyang-sales-app

Last verified: 2026-09-24 13:45 CST
Source of truth: PROJECT_LOCATION.md + AGENTS.md + PROJECT_BOUNDARIES.md + docs/stages/CURRENT_HANDOFF.md

## Identity

- Purpose: 配貨與出貨資料自動化管理助手 (Sales Assistant / Admin Core Operation)
- Owner: 陳豪安 (sgdhf2003@gmail.com)
- Canonical Drive folder ID: 12nYuQzqwJyg9Jf97R7J4-_f2tVgm9wBn
- Canonical relative path: 我的雲端硬碟/jingyang-sales-app
- Git remote: https://github.com/sgdhf2003-ai/-.git
- Default branch: main
- Project-specific IDs:
  - Backend Apps Script ID: 1vRepq_HNkjbs8vRQvbkkDE8unGPHfksfhOTrkrNZthFZHs2GSHO8Gasc
  - Backend Deployment ID: AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw (Version 103)
  - LINE Bot Apps Script ID: 1C_5hZKIlWl_B9pdRrzcrA9ZAWD2Xuqwd0ZetQ-lIt2CFlxZ8yELcTLJf
  - LINE Bot Deployment ID: AKfycbwskF_c2VpW6Cv3yR-wUevRXdrG754ZzxyYMorroqjwkjJZT10wp3DqIZ2kA-GrKK0a (Version 1)
  - Vercel Web App URL: https://brown-phi.vercel.app/

## Scope and boundaries

- This repository owns:
  - PWA frontend (`index.html`, `app.js`, etc.) serving the administrative allocation interface.
  - Backend Google Apps Script (`google-apps-script/`) serving REST API endpoints.
  - Official LINE Bot Apps Script (`line-bot-apps-script/src/`) handling customer inquiries and webhook routing.
- This repository does not own:
  - `Sales_Dashboard` (standalone web app repository; Script ID: `166wpq2TnSsbB1NwdZcbCAm2iVEH7B_CpsyGbvBPjzrwUZpGqfmncMmtO`).
  - `JYAI-Platform` (documentation, product planning bibles, and historical package archives).
  - Deprecated LINE Bot legacy codebase (`line-bot-apps-script/legacy/`).
- Cross-project restrictions:
  - Deployments must only be performed from this canonical repository using `deploy.py` after explicit Owner approval.
  - Cross-project pushing, code merging, or deploying across independent repos is strictly forbidden.

## Current state

- Current stage/release: Stage 42-E Phase 2 (Projection Worker Architecture & Security Audit Complete)
- Current handoff: docs/stages/CURRENT_HANDOFF.md
- Last verified commit: e126b3d21ac87510b3bb278a026d7ad101e02dbe
- Upstream state: 1 commit ahead vs origin/main (`1fadee47f8db000308c639a653b0bc912f2722b0`)
- Working-tree state: clean code baseline (governance documentation updates only)
- Production/deployment state: Backend Web App Version 103, LINE Bot Version 1
- Known blockers: None blocking main axis. Formal Projection Worker, Cloud Functions, and live Sheet projection tab remain unapproved and not implemented.

## Verification commands

- Context gate: `./scripts/workbench-context-gate.sh --check`
- Tests: `npm run simulate:all` (55 Suites, 378 / 378 PASS)
- Dry-run commands: `python3 deploy.py backend --check`, `python3 deploy.py line-bot --check`
- Production checks: `npm run check`, `git diff --check`

## External side-effect policy

- Spreadsheet writes: Forbidden without explicit stage authorization and Owner approval; all normal inspection must remain read-only.
- Deployment: Forbidden without explicit stage authorization and Owner approval; `deploy.py --check` is dry-run only.
- Scheduled triggers: Forbidden without explicit Owner authorization.
- External APIs: Never call LINE Push/Reply APIs unless explicitly authorized. Fail closed on missing tokens.
- Required approval point: Stop for Owner confirmation before `git commit`, `git push`, `clasp push`, or `clasp deploy`.

## Recent durable decisions

- 2026-08-08 (JYAI-REPO-LOCATION.md): Formalized canonical repository location at `我的雲端硬碟/jingyang-sales-app`. All edits, tests, commits, and pushes must occur here.
- 2026-08-01 ~ 2026-08-06: Formal hold writeback and fulfillment lifecycle verified on live Google Spreadsheets (`RES-20260801-001`, `RES-20260801-002`, `RES-20260805-PILOT88`, `RES-20260806-CHAIN35`).
- 2026-08-08 (PROJECT_BOUNDARIES.md): Entrypoint responsibility formalized. Vercel (`https://brown-phi.vercel.app/`) is primary user entrypoint; Apps Script `/exec` serves backend API and `BackendLandingView.html`.
- 2026-08-09 (AGENTS.md): Fail-closed atomic cancel-release contract established (`CANCEL_TRANSACTION_ADAPTER_MISSING`).
- 2026-08-11: Stage 42-D Firestore Emulator ACID integration certified (`2eeac70`).
- 2026-08-12: Stage 42-E Phase 1 Projection Worker isolation contract certified (`da11d2b`).
- 2026-08-13: Stage 42-E Phase 2 Projection Worker architecture and security audit certified (`846e688`).
- 2026-09-24: Location and Project Memory Governance formalized across JYAI ecosystem.

## Recovery procedure

1. Resolve the Drive folder ID (`12nYuQzqwJyg9Jf97R7J4-_f2tVgm9wBn`) and canonical relative path (`我的雲端硬碟/jingyang-sales-app`).
2. Verify the Git origin (`https://github.com/sgdhf2003-ai/-.git`) and canonical marker (`.workbench/canonical-root`).
3. Read `AGENTS.md`, `PROJECT_LOCATION.md`, this file, `PROJECT_BOUNDARIES.md`, and `docs/stages/CURRENT_HANDOFF.md`.
4. Run the project's context gate (`./scripts/workbench-context-gate.sh --check`) and simulation tests (`npm run simulate:all`).
5. Stop on drift or conflicting identifiers.
