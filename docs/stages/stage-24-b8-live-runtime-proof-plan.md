# Stage 24-B8 Live Production Adapter Runtime Proof Plan

## Purpose

Stage 24-B8 is a planning gate for proving that the production allocation persistence adapter works through the deployed/live runtime path.

This stage does not authorize production Sheet writes, test row append, row cleanup, LINE API calls, backend deploys, Apps Script production wrapper execution, token/secret or Script Property value output, commits, or pushes.

## Baseline

- Branch: `stage-24-b4-production-sheet-adapter`
- Latest production adapter implementation commit: `3339fa036d06e10e90a1432e32f92c3f18336318`
- Stage 24-B7 controlled production Sheet write-readback: PASS
- B7 touched only:
  - `holds!A2:O2`
  - `ledger!A2:G2`
- Existing B7 rows remain as audit evidence. No cleanup is approved.
- B7 proved the production Sheet schema and controlled write/readback behavior, but it did not prove deployed/live runtime adapter wiring.

## Current Runtime Boundary

The implemented `ProductionSheetReservationAdapter` is a Node module under `allocation-assistant/adapters/production-sheet-reservation-adapter.js`. It requires injected `configProvider` and `sheetClient` dependencies and does not directly read Script Properties or instantiate `SpreadsheetApp`.

The current Apps Script backend entrypoint is `google-apps-script/Code.gs`. Its existing `doPost` action `upsertHold` routes to `upsertHolds([data.hold])`. That path is not a valid B8 runtime proof path because it does not exercise the B6 production adapter contract and can trigger OneSignal/LINE notification helpers for hold changes.

Therefore B8 must use a dedicated, controlled runtime proof entrypoint instead of reusing the existing generic `upsertHold` route.

## Proposed Live Runtime Proof Path

The next implementation gate should add a minimal Apps Script runtime proof wrapper or action that is isolated from normal customer workflows.

Recommended entrypoint shape:

```text
runAllocationProductionAdapterRuntimeProof_B8()
```

or an equivalent gated backend action that is not reachable from normal LINE/PWA user flows.

The runtime proof path must:

1. Read only the approved production property names internally:
   - `JYAI_ALLOCATION_PRODUCTION_SPREADSHEET_ID`
   - `JYAI_ALLOCATION_PRODUCTION_HOLDS_SHEET_NAME`
   - `JYAI_ALLOCATION_PRODUCTION_LEDGER_SHEET_NAME`
2. Never log or return property values, spreadsheet IDs, token values, customer identifiers, or deployment URLs.
3. Validate production `holds` and `ledger` headers before any write.
4. Execute a single controlled formal hold writeback through the production adapter runtime path.
5. Read back the persisted hold by reservation number.
6. Confirm:

```text
reservationNumber === holdRecord.id === rowData[0] === persisted row id === readback record id
```

7. Replay the same payload and confirm no duplicate row is created.
8. Replay the same reservation number with a conflicting payload and fail closed with `HOLD_IDEMPOTENCY_CONFLICT`.
9. Execute the minimum ledger proof required by the contract:
   - `FULL_SHIP -> FULFILL_DEDUCT`
   - `PARTIAL_SHIP -> PARTIAL_FULFILL_DEDUCT`
   - `CANCEL_RELEASE -> CANCEL_RELEASE`
   - `CANCEL_RELEASE.quantity` equals released quantity.
   - `CANCEL_RELEASE.remainingQuantity` remains audit context.
10. Return a redacted proof summary only:
    - success/failure booleans
    - safe error codes
    - touched tab/range labels
    - row indexes if approved for audit logging
    - ledger action names
    - no property values or Sheet IDs

## Existing B7 Row Reuse

Existing B7 rows may be reused only as read-only audit evidence that production schema and connector-based write/readback previously passed.

They cannot fully prove the B8 runtime adapter path because they were not created by the deployed/live adapter runtime. A new controlled row is required to prove first-write behavior through the runtime adapter path unless Owner explicitly narrows B8 to read-only runtime lookup proof.

No cleanup, delete, update, clear, or status mutation of the existing B7 rows is approved.

## Required Owner Approvals Before B8 Execution

The following approvals must be separate and explicit:

1. Apps Script runtime wrapper/source implementation scope.
2. Backend deploy or `clasp push/version/deploy` needed to make the runtime proof entrypoint available.
3. Apps Script production wrapper execution method, such as `clasp run` or a gated backend action.
4. Production Sheet write/readback for the exact rows/ranges to be touched.
5. Ledger write/readback for the exact row/range to be touched.
6. Whether a new controlled reservation row is allowed.
7. Cleanup policy, if any. No cleanup is approved by default.

Approvals must not authorize LINE API calls unless explicitly stated. B8 runtime proof must suppress or bypass normal notification paths.

## Failure Modes

B8 runtime proof must fail closed for:

| Failure | Required outcome |
| --- | --- |
| Missing property presence | no write; redacted error |
| Missing or mismatched `holds` headers | no write; `HOLD_SCHEMA_MISMATCH` |
| Missing or mismatched ledger headers | no ledger write; `LEDGER_SCHEMA_MISMATCH` |
| Missing adapter/runtime capability | no write; explicit capability error |
| Permission/API failure | no assistant-facing success |
| Unknown write outcome | no success unless readback confirms |
| Existing conflicting reservation payload | `HOLD_IDEMPOTENCY_CONFLICT` |
| Notification path would be triggered | stop; no LINE/OneSignal call |

## Verification Plan

Before any future live runtime proof, run:

```bash
node tests/simulations/allocation-production-sheet-adapter.sim.js
node tests/simulations/allocation-production-readiness-diagnostics.sim.js
npm run simulate:all
python3 deploy.py backend --check
python3 deploy.py line-bot --check
git diff --check
git status -sb
```

`deploy.py --check` remains dry-run only and must not execute clasp subprocesses, create versions, or deploy.

## Remaining Risks

- The B6 production adapter is local Node code and is not yet proven through the Apps Script deployed runtime.
- Existing backend `upsertHold` is unsafe for this proof because notification side effects may run.
- Independent key-only Script Properties verification remains unavailable unless a read-only wrapper is explicitly approved.
- A new controlled production row is likely needed for full B8 proof.
- No production cleanup policy is defined for B8 rows.
