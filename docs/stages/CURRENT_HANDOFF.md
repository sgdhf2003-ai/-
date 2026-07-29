# Current Handoff

## Repository

- repo root: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
- branch: `stage-24-b4-production-sheet-adapter`
- source of truth: Canonical cloud-drive checkout path above
- HEAD: `368a4efaace9b9f5762eb559656f048cd033232f` at Stage 24-B4-D3/D4 entry
- origin/stage-24-b4-production-sheet-adapter: `368a4efaace9b9f5762eb559656f048cd033232f`
- origin/main base: `b32fad100afb3b0c926d9edc466fea2833e8ac45`
- ahead / behind vs origin/stage-24-b4-production-sheet-adapter: `0 / 0` at Stage 24-B4-D3/D4 entry

## Current Stage

- current stage: Stage 24-B4-D3/D4 Production Wiring Readiness + Dry-Run Implementation
- previous completed delivery: Phase 7 Sales Assistant LINE OCR & Fulfillment Loop
- latest pushed stage commit: `368a4efaace9b9f5762eb559656f048cd033232f`
- backend deployed version: `78` (canonical deployment record)
- LINE Bot deployed version: `191` (canonical deployment record)
- automated simulations: rerun for Stage 24-B4-D3/D4 before closure

## Product North Star

- Core user: Sales Assistant / Admin, not a general sales rep.
- Core system goal: 配貨與出貨資料自動化管理助手。
- Closed loop: Inbound 去保留 -> Outbound 待出貨銷扣.

## Safety State

- Backend LINE_PUSH_ENABLED: disabled
- LINE Bot LINE_PUSH_ENABLED: disabled
- production notification send: disabled (re-enable requires explicit approval window)
- Developer/Documents/scratch/exported paths: untrusted/backup only and blocked unless Owner explicitly reassigns the project root
- Stage 24-B4-D3/D4 scope: production wiring readiness, fail-closed local diagnostics, simulations, and handoff/spec updates only.
- Forbidden without separate Owner approval: production Sheet read/write/readback, fallback Sheet ID use, deploys, LINE API calls, token/secret or Script Property value access, Apps Script production wrapper execution, commits, or pushes.

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
- Stage 24-B4-D3/D4 adds local-only production readiness diagnostics and simulations. This does not implement or prove production Sheet persistence.

## Required Next Step

Finish Stage 24-B4-D3/D4 verification, then perform commit-readiness review before any commit/push approval request. Production Sheet access, production adapter wiring, deploy, LINE API, token/secret access, Apps Script production wrapper execution, commit, and push all require separate explicit Owner approval.
