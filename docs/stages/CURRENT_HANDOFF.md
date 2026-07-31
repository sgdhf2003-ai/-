# Current Handoff

## Repository

- repo root: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
- branch: `main`
- source of truth: Canonical cloud-drive checkout path above
- HEAD: `2c868c370ec1e4018cacbffa35ea92bd71c9841f`
- origin/main: `2c868c370ec1e4018cacbffa35ea92bd71c9841f`
- ahead / behind vs origin/main: `0 / 0`

## Current Stage

- current stage: Stage 26-C0 Cancel/Release Production Contract Spec Completed
- previous completed delivery: Stage 26-B3 Partial Fulfillment Closure Commit & Push (`2c868c3`)
- latest pushed main commit: `2c868c370ec1e4018cacbffa35ea92bd71c9841f`
- backend deployed version: `91` (canonical deployment record - locked with pure READINESS_CHECK)
- LINE Bot deployed version: `191` (canonical deployment record)
- automated simulations: 180 / 180 PASS (`npm run simulate:all`)

## Product North Star

- Core user: Sales Assistant / Admin, not a general sales rep.
- Core system goal: 配貨與出貨資料自動化管理助手。
- Closed loop: Inbound 去保留 -> Outbound 待出貨銷扣.

## Safety State

- Backend LINE_PUSH_ENABLED: disabled
- LINE Bot LINE_PUSH_ENABLED: disabled
- production notification send: disabled (re-enable requires explicit approval window)
- Developer/Documents/scratch/exported paths: untrusted/backup only and blocked unless Owner explicitly reassigns the project root
- Stage 24-B8 scope: live runtime proof planning only, local simulations, docs/handoff updates, and deploy `--check` dry-runs.
- Forbidden without separate Owner approval: production Sheet write/readback, production test row append, data row update/delete/clear/cleanup, fallback Sheet ID use, deploys, LINE API calls, token/secret or Script Property value output, Apps Script production wrapper execution, commits, or pushes.

## Phase 7 Integration-Hardening Gaps

- Formal hold writeback persistence contract is not fully proven against a real Sheet adapter.
- `holds` schema mapping requires canonical alignment before further production write claims.
- Fulfillment loop does not yet prove Sheet or inventory snapshot persistence.
- `JingyangAssistant` fallback spreadsheet ID requires confirmation or alignment with the 115 inventory spreadsheet binding.

## Stage 24-B3-A Contract Draft State

- Draft/update `docs/stages/stage-24-b3-production-contract-spec.md` before any live adapter wiring.
- Contract requires confirmed persistence beyond `success: true`: write capability, canonical header validation, row/write receipt, readback by reservation number or equivalent confirmed receipt, and ID equality across returned objects.
- Formal hold identity must satisfy `reservationNumber === holdRecord.id === rowData[0]`.
- Production paths must fail closed when only mock/simulation capability exists; mock adapters remain explicit simulation dependencies only.
- Fulfillment persistence must prove hold status update and inventory ledger/snapshot recording for full shipment, partial shipment, and cancel/release.
- Stage 24-B3-B Owner decision recorded: `CANCEL_RELEASE.quantity` equals released quantity, and `CANCEL_RELEASE.remainingQuantity` remains audit context after release/cancel.
- Stage 24-B3-C Owner decision recorded: use an explicit semantic mapper for fulfillment ledger action naming: `FULL_SHIP -> FULFILL_DEDUCT`, `PARTIAL_SHIP -> PARTIAL_FULFILL_DEDUCT`, `CANCEL_RELEASE -> CANCEL_RELEASE`.

## Stage 24-B4 Progress

- Stage 24-B4-A/B tests-first and minimal contract fixes were completed on the feature branch.
- Stage 24-B4-D1 controlled cloned/test Sheet adapter wiring was committed and pushed at `368a4efaace9b9f5762eb559656f048cd033232f`.
- Stage 24-B4-D2 controlled cloned/test Sheet write-readback passed against a cloned/test Sheet only, with sensitive IDs redacted:
  - formal hold writeback persisted and read back by reservation number.
  - `reservationNumber === holdRecord.id === rowData[0] === persisted row id`.
  - same-payload replay created no duplicate.
  - conflicting replay failed closed with `HOLD_IDEMPOTENCY_CONFLICT`.
  - ledger mapper was confirmed: `FULL_SHIP -> FULFILL_DEDUCT`, `PARTIAL_SHIP -> PARTIAL_FULFILL_DEDUCT`, `CANCEL_RELEASE -> CANCEL_RELEASE`.
  - `CANCEL_RELEASE.quantity` equals released quantity and `remainingQuantity` remains audit context.
- Stage 24-B4-D3/D4 added local-only production readiness diagnostics and simulations.
- Stage 24-B5P confirmed production Sheet schema readiness and treated Script Property key presence as Owner-confirmed only. Independent key-only Script Properties verification remains unavailable.
- Stage 24-B6 implemented the production Sheet reservation adapter boundary with injected `configProvider` and `sheetClient`, committed and pushed at `3339fa036d06e10e90a1432e32f92c3f18336318`.
- Stage 24-B7 controlled production Sheet write-readback passed. It touched only `holds!A2:O2` and `ledger!A2:G2`; those rows remain audit evidence and no cleanup is approved.
- Stage 24-B7 did not prove deployed/live runtime adapter wiring because it did not execute the production adapter through the deployed Apps Script runtime.
- Stage 24-B8 plan: define the exact live runtime proof path, approvals, side effects, and minimum contract before any deploy, wrapper execution, or additional production Sheet write/readback.

## Required Next Step

Review `docs/stages/stage-24-b8-live-runtime-proof-plan.md`, then request Owner approval for the exact B8 implementation/execution scope before any Apps Script runtime wrapper, deploy, wrapper execution, production Sheet write/readback, cleanup, LINE API call, token/secret or Script Property value access, commit, or push.
