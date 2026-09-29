# Project Memory — jingyang-sales-app

Last verified: 2026-09-29 15:56 CST
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
  - Backend Deployment ID: AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw (Version 122)
  - LINE Bot Apps Script ID: 1C_5hZKIlWl_B9pdRrzcrA9ZAWD2Xuqwd0ZetQ-lIt2CFlxZ8yELcTLJf
  - LINE Bot Deployment ID: AKfycbwskF_c2VpW6Cv3yR-wUevRXdrG754ZzxyYMorroqjwkjJZT10wp3DqIZ2kA-GrKK0a (Version 4)
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

- Current stage/release: Stage 42-G1 Event Contracts: APPROVED FOR COMMIT REVIEW — NOT YET COMMITTED (G1: `APPROVED FOR COMMIT REVIEW — NOT YET COMMITTED`; G2–G6: `NOT STARTED`; Implementation Authorization: `G1 AUTHORIZED ONLY, G2–G6 NOT AUTHORIZED`; Next Step: `Owner may authorize one Stage 42-G1 commit and push; G2–G6 remain NOT AUTHORIZED.`)
- Current handoff: docs/stages/CURRENT_HANDOFF.md
- Last verified commit: f8caaac197d0cd31d06f2957bd9d68ed5c650766
- Upstream state: HEAD == origin/main (f8caaac197d0cd31d06f2957bd9d68ed5c650766)
- Working-tree state: Stage 42-G1 Event Contracts implementation, blocker corrections, and governance consistency review completed; `projection-contract.js` updated with true Unicode code-point sorting, fatal UTF-8 decoding, strict envelope & PII validation, clean Timestamp clock, and circular-safe log sanitization; `stage-42-g1-event-contracts.sim.js` updated (24/24 PASS); `package.json` `simulate:all` includes G1 (60 suites / 503 cases PASS); G1 registry standalone/direct execution verified; G2–G6 not started; awaits Owner authorization to commit and push
- Production/deployment state: Backend Web App Version 122 (Deployment ID: AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw), LINE Bot Version 4 (Deployment ID: AKfycbwskF_c2VpW6Cv3yR-wUevRXdrG754ZzxyYMorroqjwkjJZT10wp3DqIZ2kA-GrKK0a)
- Known blockers: None blocking main axis. Stage 42-G1 code, test, and governance consistency review passed. G1 approved for commit review — awaiting Owner authorization to commit and push. G2–G6 remain unapproved and not started. Stage 42-H Pilot requires separate Owner authorization. Production spreadsheets remain 0 writes.

## Verification commands

- Context gate: `./scripts/workbench-context-gate.sh --check`
- Tests: `npm run simulate:all` (60 Suites, 503 / 503 PASS)
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
- 2026-09-29: Stage 42-G1 Event Contracts blocker corrections and final governance consistency correction completed under Owner authorization tokens `OWNER AUTHORIZATION — STAGE 42-G1 BLOCKER CORRECTION AND RE-REVIEW` and `OWNER AUTHORIZATION — STAGE 42-G1 FINAL GOVERNANCE CONSISTENCY CORRECTION`. Hardened `projection-contract.js`: true Unicode code-point sorting in `serializeCanonicalJson` distinguishing U+E000 from U+10000; strict fatal UTF-8 TextDecoder in `unpackTransportCloudEvent` fail-closed rejecting invalid byte sequences like [0xC3, 0x28] with `INVALID_UTF8_PAYLOAD`; full schemaVersion 1.0.0 envelope and PII validation (eventId UUIDv4, eventType, source, occurredAt, traceId, projectionKey, payloadHash, operator pseudonymousActorId with email/raw LINE ID rejection and operator extra fields forbidden, and strict payload schema forbidding any extra fields); un-monkey-patched Timestamp Clock abstraction; and circular-reference / deep-structure safe log sanitization in `sanitizeLogEntry`. 24 simulation tests implemented in `tests/simulations/stage-42-g1-event-contracts.sim.js` (24/24 PASS). `simulate:all` in `package.json` updated to include G1 (60 Suites, 503 / 503 PASS). G1 test registry (TC-02, TC-07, TC-12, TC-17) standalone/direct execution verified. Production deployment facts verified via live clasp deployments: target Backend Deployment ID AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw points to Version 122; target LINE Bot Deployment ID AKfycbwskF_c2VpW6Cv3yR-wUevRXdrG754ZzxyYMorroqjwkjJZT10wp3DqIZ2kA-GrKK0a points to Version 4. Implementation strictly confined to G1; G2–G6 NOT STARTED and NOT AUTHORIZED. Stage 42-G1 APPROVED FOR COMMIT REVIEW — NOT YET COMMITTED. Next Step: Owner may authorize one Stage 42-G1 commit and push; G2–G6 remain NOT AUTHORIZED.

## Recovery procedure

1. Resolve the Drive folder ID (`12nYuQzqwJyg9Jf97R7J4-_f2tVgm9wBn`) and canonical relative path (`我的雲端硬碟/jingyang-sales-app`).
2. Verify the Git origin (`https://github.com/sgdhf2003-ai/-.git`) and canonical marker (`.workbench/canonical-root`).
3. Read `AGENTS.md`, `PROJECT_LOCATION.md`, this file, `PROJECT_BOUNDARIES.md`, and `docs/stages/CURRENT_HANDOFF.md`.
4. Run the project's context gate (`./scripts/workbench-context-gate.sh --check`) and simulation tests (`npm run simulate:all`).
5. Stop on drift or conflicting identifiers.
