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

- Current stage/release: Stage 42-F Erratum 1 & Stage 42-G TDD Plans Approved (Stage 42-F: `APPROVED WITH ERRATUM 1`; Stage 42-G: `TDD IMPLEMENTATION PLANS APPROVED — IMPLEMENTATION NOT STARTED`; Implementation Authorization: `NOT AUTHORIZED`; Next Step: `Stage 42-G implementation awaits separate Owner authorization`)
- Current handoff: docs/stages/CURRENT_HANDOFF.md
- Last verified commit: 5b2f7e4e8a16735d534e82d1337999c739f049e2
- Upstream state: HEAD == origin/main (5b2f7e4e8a16735d534e82d1337999c739f049e2)
- Working-tree state: Stage 42-F Erratum 1 and Stage 42-G TDD Plans approved, undergoing final verification, staging, commit and push (1 spec with Erratum 1, 7 plan files in docs/superpowers/plans/, 3 updated governance files; 0 code changes, clean code baseline)
- Production/deployment state: Backend Web App Version 103, LINE Bot Version 1
- Known blockers: None blocking main axis. Formal Projection Worker, Cloud Functions, and live Sheet projection tab remain unapproved and not implemented. Implementation strictly NOT AUTHORIZED. Stage 42-H Pilot requires separate Owner authorization. Production spreadsheets remain 0 writes.

## Verification commands

- Context gate: `./scripts/workbench-context-gate.sh --check`
- Tests: `npm run simulate:all` (59 Suites, 479 / 479 PASS)
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
- 2026-09-24: Location and Project Memory Governance formalized across JYAI ecosystem (`59d8926`).
- 2026-09-29: Stage 42-F Architecture Specification approved with Erratum 1 (`APPROVED WITH ERRATUM 1`) and Stage 42-G Master & Six Subplans approved (`TDD IMPLEMENTATION PLANS APPROVED — IMPLEMENTATION NOT STARTED`) in accordance with Owner Authorization Token `OWNER FINAL APPROVAL — STAGE 42-F ERRATUM 1 AND STAGE 42-G PLANS COMMIT AND PUSH`. Erratum 1 formalizes `projectionSnapshot` (minimal 12-column source: reservationNumber, eventType, storeId, productCode, quantity, pseudonymousActorId, occurredAt, payloadHash; Fail-Closed validation strictly forbidding fictional "N/A", "USR_ANONYMOUS", or 0 fallbacks) and `projectionSnapshotExpiresAt` (90-day retention after completedAt) to provide authoritative source for Reconciler row reconstruction without relying on Outbox. Reconciler dedicated lease fields (`reconciliationLeaseOwner`, `reconciliationLeaseExpiresAt`, `reconciliationClaimVersion`, etc.) established with 10 concurrency rules. Stage 42-G TDD plans feature true Firestore Timestamp Clock abstraction, real Acceptance Test Registry, true test execution, full 10-identity IAM allowlist (5 Runtime, 4 Trigger, 1 System, forbidding secretmanager everywhere), stable compound pagination, isolated stub self-check runner, non-destructive rollback rules, strict Transport CloudEvent unpacking, duplicate payloadHash format validation & rejectedDuplicateCount defense, and preWriteCheck authoritative re-verification. Implementation remains strictly NOT AUTHORIZED; Next Step: `Stage 42-G implementation awaits separate Owner authorization`. 0 GCP resources created, 0 code changes, 0 Sheet writes.

## Recovery procedure

1. Resolve the Drive folder ID (`12nYuQzqwJyg9Jf97R7J4-_f2tVgm9wBn`) and canonical relative path (`我的雲端硬碟/jingyang-sales-app`).
2. Verify the Git origin (`https://github.com/sgdhf2003-ai/-.git`) and canonical marker (`.workbench/canonical-root`).
3. Read `AGENTS.md`, `PROJECT_LOCATION.md`, this file, `PROJECT_BOUNDARIES.md`, and `docs/stages/CURRENT_HANDOFF.md`.
4. Run the project's context gate (`./scripts/workbench-context-gate.sh --check`) and simulation tests (`npm run simulate:all`).
5. Stop on drift or conflicting identifiers.
