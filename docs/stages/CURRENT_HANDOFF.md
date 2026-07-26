# Current Handoff

## Repository

- repo root: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
- branch: `stage-24-b3-production-contract-spec`
- source of truth: Canonical cloud-drive checkout path above
- HEAD: `440e8cd30cc7bf52142a24008968415fa35aa606`
- origin/stage-24-b3-production-contract-spec: `440e8cd30cc7bf52142a24008968415fa35aa606`
- origin/main base: `b32fad100afb3b0c926d9edc466fea2833e8ac45`
- ahead / behind vs origin/main: `1 / 0`

## Current Stage

- current stage: Stage 24-DOCS-A AI Project Docs Structure
- previous completed delivery: Phase 7 Sales Assistant LINE OCR & Fulfillment Loop
- latest pushed stage commit: `440e8cd30cc7bf52142a24008968415fa35aa606`
- backend deployed version: `78` (canonical deployment record)
- LINE Bot deployed version: `191` (canonical deployment record)
- automated simulations: `npm run simulate:all` PASS in the latest Stage 24-DOCS-A local verification

## Product North Star

- Core user: Sales Assistant / Admin, not a general sales rep.
- Core system goal: 配貨與出貨資料自動化管理助手。
- Closed loop: Inbound 去保留 -> Outbound 待出貨銷扣.

## Safety State

- Backend LINE_PUSH_ENABLED: disabled
- LINE Bot LINE_PUSH_ENABLED: disabled
- production notification send: disabled (re-enable requires explicit approval window)
- Developer/Documents/scratch/exported paths: untrusted/backup only and blocked unless Owner explicitly reassigns the project root
- Stage 24-DOCS-A scope: AI project docs structure and stale-path governance cleanup only; no Stage 24-B4 implementation, production code changes, deploys, Sheet writes, LINE API calls, token/secret access, commits, or pushes without explicit Owner approval.

## Phase 7 Integration-Hardening Gaps

- Formal hold writeback persistence contract is not fully proven against a real Sheet adapter.
- `holds` schema mapping requires canonical alignment before further production write claims.
- Fulfillment loop does not yet prove Sheet or inventory snapshot persistence.
- `JingyangAssistant` fallback spreadsheet ID requires confirmation or alignment with the 115 inventory spreadsheet binding.

## Required Next Step

Complete Stage 24-DOCS-A verification, then perform commit-readiness review before any commit/push approval request. `CANCEL_RELEASE` ledger semantics remain an Owner decision before Stage 24-B4.
