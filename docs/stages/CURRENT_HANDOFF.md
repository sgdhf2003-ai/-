# Current Handoff

## Repository

- repo root: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
- branch: `stage-24-b4-production-sheet-adapter`
- source of truth: Canonical cloud-drive checkout path above
- HEAD: `facd53f32c17a638eea98e2fd6e92e470a11d3ae` before Stage 24-B6 local implementation
- origin/stage-24-b4-production-sheet-adapter: `facd53f32c17a638eea98e2fd6e92e470a11d3ae`
- origin/main base: `b32fad100afb3b0c926d9edc466fea2833e8ac45`
- ahead / behind vs origin/stage-24-b4-production-sheet-adapter: `0 / 0` before Stage 24-B6 local implementation

## Current Stage

- current stage: Stage 24-B6 Production Sheet Adapter Implementation
- previous completed delivery: Phase 7 Sales Assistant LINE OCR & Fulfillment Loop
- latest pushed stage commit: `facd53f32c17a638eea98e2fd6e92e470a11d3ae`
- backend deployed version: `78` (canonical deployment record)
- LINE Bot deployed version: `191` (canonical deployment record)
- automated simulations: rerun for Stage 24-B6 before closure

## Product North Star

- Core user: Sales Assistant / Admin, not a general sales rep.
- Core system goal: 配貨與出貨資料自動化管理助手。
- Closed loop: Inbound 去保留 -> Outbound 待出貨銷扣.

## Safety State

- Backend LINE_PUSH_ENABLED: disabled
- LINE Bot LINE_PUSH_ENABLED: disabled
- production notification send: disabled (re-enable requires explicit approval window)
- Developer/Documents/scratch/exported paths: untrusted/backup only and blocked unless Owner explicitly reassigns the project root
- Stage 24-B6 scope: production Sheet adapter implementation, local simulations, docs/handoff updates, and dry-run deploy checks only.
- Forbidden without separate Owner approval: production Sheet write/readback, production test row append, data row update/delete/clear, fallback Sheet ID use, deploys, LINE API calls, token/secret or Script Property value output, Apps Script production wrapper execution, commits, or pushes.

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
- Stage 24-B6 implements the production Sheet reservation adapter boundary with injected `configProvider` and `sheetClient`. This does not execute production write-readback and does not prove production Sheet persistence.

## Required Next Step

Finish Stage 24-B6 verification, then perform commit-readiness review before any commit/push approval request. Production Sheet write/readback, deploy, LINE API, token/secret or Script Property value access, Apps Script production wrapper execution, commit, and push all require separate explicit Owner approval.
