# Current Handoff

## Repository

- repo root: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
- branch: `main`
- source of truth: CloudStorage repo path above

## Current Stage

- active stage: Stage 21-D2A Repo Boundary Relocation Fix
- latest observed commit before this handoff: `8feafb5 docs: close controlled task reminder live validation`
- Stage 21-D2 implementation commit observed: `515075a feat: add task notification reservation lookup`
- follow-up hardening commits observed:
  - `09f260d fix: harden task notification reservation lookup`
  - `9b7d308 fix: enforce unique task notification dedupe keys`
- repo sync observed:
  - local main fast-forwarded to `8feafb5`
  - ahead / behind after sync: `0 / 0`

## Safety State

- production notification send: NO-GO
- reservation write: not enabled
- LINE API live calls: forbidden unless explicitly approved
- Backend deploy: only when explicitly requested
- LINE Bot deploy: only when explicitly requested
- Script Properties / Sheet / Trigger changes: forbidden unless explicitly requested

## Required Next Step

Commit Stage 21-D2A boundary relocation first, then run Stage 21-D2 Review + Push.
