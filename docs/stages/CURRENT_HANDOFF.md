# Current Handoff

## Repository

- repo root: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
- branch: `stage-24-b3-production-contract-spec`
- source of truth: Canonical cloud-drive checkout path above
- HEAD: `cf16edd712216790693d32e2ac2a5f287bbe8c58`
- origin/stage-24-b3-production-contract-spec: `cf16edd712216790693d32e2ac2a5f287bbe8c58`
- origin/main base: `b32fad100afb3b0c926d9edc466fea2833e8ac45`
- ahead / behind vs origin/main: `2 / 0`

## Current Stage

- current stage: Stage 24-B3-A Production Contract Spec Draft
- previous completed delivery: Phase 7 Sales Assistant LINE OCR & Fulfillment Loop
- latest pushed stage commit: `cf16edd712216790693d32e2ac2a5f287bbe8c58`
- backend deployed version: `78` (canonical deployment record)
- LINE Bot deployed version: `191` (canonical deployment record)
- automated simulations: `npm run simulate:all` PASS in the latest Stage 24-DOCS-A local verification; rerun for Stage 24-B3-A before closure

## Product North Star

- Core user: Sales Assistant / Admin, not a general sales rep.
- Core system goal: 配貨與出貨資料自動化管理助手。
- Closed loop: Inbound 去保留 -> Outbound 待出貨銷扣.

## Safety State

- Backend LINE_PUSH_ENABLED: disabled
- LINE Bot LINE_PUSH_ENABLED: disabled
- production notification send: disabled (re-enable requires explicit approval window)
- Developer/Documents/scratch/exported paths: untrusted/backup only and blocked unless Owner explicitly reassigns the project root
- Stage 24-B3-A scope: production persistence contract specification only; no Stage 24-B4 implementation, production adapter wiring, deploys, Sheet writes, LINE API calls, token/secret access, commits, or pushes without explicit Owner approval.

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

## Required Next Step

Finish Stage 24-B3-C verification, then perform commit-readiness review before any commit/push approval request. Stage 24-B4 remains unstarted and requires separate Owner approval.
