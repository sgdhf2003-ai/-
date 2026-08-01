# Current Handoff

## Repository

- repo root: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
- branch: `main`
- source of truth: Canonical cloud-drive checkout path above
- HEAD: `b868bc1cb5e7ee3cdc93e446b4931f760b5ca0ee`
- origin/main: `b868bc1cb5e7ee3cdc93e446b4931f760b5ca0ee`
- ahead / behind vs origin/main: `0 / 0`

## Current Stage

- current stage: Stage 27 Allocation Persistence Contract & Sweep Closed
- previous completed deliveries:
  - Stage 27-A Ledger Timestamp Normalization (`00b983a`)
  - Stage 27-B Allocation Persistence Contract Sweep Batch (`b868bc1`)
- latest pushed main commit: `b868bc1cb5e7ee3cdc93e446b4931f760b5ca0ee` (`fix: harden allocation persistence contract sweep`)
- backend deployed version: `96` (canonical deployment record - fail-closed containment)
- LINE Bot deployed version: `200` (canonical deployment record - fail-closed containment)
- automated simulations: 180 / 180 PASS (`npm run simulate:all`)

## Stage 27 Summary & Production State

- **Stage 27 Status**: CLOSED
- **Stage 27-A Delivery**: `00b983a` (`fix: normalize production ledger adjustment timestamp`)
- **Stage 27-B Delivery**: `b868bc1` (`fix: harden allocation persistence contract sweep`)
- **Backend Production Version**: `96`
- **LINE Bot Production Version**: `200`
- **Automated Verification**: `npm run check` PASS, `npm run simulate:all` 180 / 180 PASS, `git diff --check` PASS

## Stage 26 Containment Summary & Production State

- **Containment Deploy Status**: CLOSED & DEPLOYED
- **Backend Production Version**: `96` (Script ID: `1vRepq_HNkjbs8vRQvbkkDE8unGPHfksfhOTrkrNZthFZHs2GSHO8Gasc`)
- **LINE Bot Production Version**: `200` (Script ID: `19rYFpT-RE77oT52QfFIpIBqjcXSWemKRs0ClExMXo0lImf_OFb_DJ_AD`)
- **Containment Protections**:
  - Hardcoded token/secret literals (`JYAI-SECURE-TOKEN-2026-OPTIMIZED`, `ANTIGRAVITY-STRICT-AUDIT-2026-FIXED`, `JYAI_STAGE_24_B8_PROOF_KEY_2026`) completely removed from source.
  - `runJyTokenExecution()` locked fail-closed with no embedded tokens and returns `EXECUTION_MODE_REQUIRES_EXPLICIT_OWNER_AUTHORIZATION` with `touchedTabs: []`.
  - All 0-arg Apps Script mutation entrypoints (`runTargetSpreadsheetUserMigrationNow`, `runAntiGravityOfficialProductionFix`, `executeAntiGravityDualSpreadsheetRoutingFix`, `executeSafeArchitectureAlignment`) locked fail-closed with `touchedTabs: []`.
  - Admin ingestion and migration handlers reject write modes fail-closed and return `readOnlyAudit: true` with `touchedTabs: []` on audit.
- **Safety Record**: 0 Google Sheet writes, 0 LINE API calls, 0 token/secret outputs.

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

Stage 26-X9 Owner-Approved Secret Rotation Gate (only if Owner confirms removed token literals were live operational secrets).

Forbidden until Stage 26-X9 is explicitly approved:
- no token/secret/property access
- no token rotation
- no Apps Script function execution
- no Google Sheet write/append/update/delete/clear
- no LINE / OneSignal call
- no deploy
- no commit/push
