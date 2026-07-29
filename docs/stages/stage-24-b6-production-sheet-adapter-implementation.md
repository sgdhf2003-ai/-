# Stage 24-B6 Production Sheet Adapter Implementation

## Purpose

Stage 24-B6 implements the production Sheet reservation adapter boundary after the production schema setup/readiness gates.

This stage implements code only. It does not authorize production Sheet write/readback, test row append, row update/delete/clear, LINE API calls, deploy, Script Property value output, Apps Script production wrapper execution, commit, or push.

## Baseline Inputs

- Production Sheet schema readiness:
  - `holds` tab exists.
  - `holds!A1:O1` matches the approved 15 headers.
  - `ledger` tab exists.
  - `ledger!A1:G1` matches the approved 7 headers.
- Script Property key presence is Owner-confirmed only:
  - `JYAI_ALLOCATION_PRODUCTION_SPREADSHEET_ID`
  - `JYAI_ALLOCATION_PRODUCTION_HOLDS_SHEET_NAME`
  - `JYAI_ALLOCATION_PRODUCTION_LEDGER_SHEET_NAME`
- Independent live key-only Script Properties verification remains unavailable.
- Production write-readback is not approved in this stage.

## Adapter Contract

`ProductionSheetReservationAdapter` uses the same persistence boundary expected by `FormalHoldWritebackAdapter` and `FulfillmentAdapter`:

1. `appendHoldRecord(holdRecord, { headers })`
2. `queryHoldByReservationNumber(reservationNumber)`
3. `updateHoldStatus({ reservationNumber, status, fulfilledQuantity, remainingQuantity, updatedAt })`
4. `recordInventoryAdjustment({ reservationNumber, action, item, quantity, remainingQuantity, status, updatedAt })`

The adapter requires injected dependencies:

- `configProvider`
- `sheetClient`

It does not read Script Properties directly, instantiate `SpreadsheetApp`, instantiate `UrlFetchApp`, call LINE APIs, or instantiate mock adapters.

## Success Definition

Formal hold writeback succeeds only when all of the following are true:

1. Required production config names resolve through the injected `configProvider`.
2. Required `sheetClient` methods exist.
3. `holds` headers match the canonical 15-header contract before append.
4. Same-reservation replay checks the persisted row before appending.
5. New append returns `success: true` and `persisted: true`.
6. Post-append readback finds the same reservation number.
7. ID equality is preserved:

```text
reservationNumber === holdRecord.id === rowData[0] === persisted row id
```

Fulfillment succeeds only when both the hold status update and ledger append are confirmed persisted.

## Failure Modes

The adapter fails closed for:

| Failure | Error boundary |
| --- | --- |
| Missing production config | `PRODUCTION_SHEET_CONFIG_MISSING` |
| Missing sheet client | `PRODUCTION_SHEET_CLIENT_MISSING` |
| Missing client capability | `PRODUCTION_SHEET_CLIENT_CAPABILITY_MISSING` |
| `holds` header mismatch | `HOLD_SCHEMA_MISMATCH` |
| `ledger` header mismatch | `LEDGER_SCHEMA_MISMATCH` |
| Same ID with conflicting payload | `HOLD_IDEMPOTENCY_CONFLICT` |
| Permission failure | `PRODUCTION_SHEET_PERMISSION_DENIED` |
| API/network failure | `PRODUCTION_SHEET_API_FAILURE` |
| Unknown write outcome | no success unless readback confirms |
| Status update not confirmed | `PRODUCTION_STATUS_UPDATE_CONFIRMATION_MISSING` |
| Ledger write not confirmed | `PRODUCTION_LEDGER_WRITE_CONFIRMATION_MISSING` |

All results are redacted and do not include Script Property values.

## Fulfillment Ledger Semantics

The adapter preserves Owner-approved B3/B4 semantics:

- `FULL_SHIP -> FULFILL_DEDUCT`
- `PARTIAL_SHIP -> PARTIAL_FULFILL_DEDUCT`
- `CANCEL_RELEASE -> CANCEL_RELEASE`
- `CANCEL_RELEASE.quantity` equals released quantity.
- `CANCEL_RELEASE.remainingQuantity` remains audit context.

## Test Evidence

Local-only simulation:

- `tests/simulations/allocation-production-sheet-adapter.sim.js`

The simulation proves:

1. Production config names are fixed and redacted.
2. Missing config/client fails closed.
3. Production adapter does not silently use mock persistence.
4. Formal hold writeback confirms readback and ID equality.
5. Same-payload replay creates no duplicate row.
6. Conflicting replay fails with `HOLD_IDEMPOTENCY_CONFLICT`.
7. Header mismatch fails before append.
8. Permission/API failures map to explicit production errors.
9. Unknown write outcome cannot return success.
10. Full/partial/cancel fulfillment ledger semantics persist through the adapter boundary.
11. Ledger header mismatch fails before ledger append.

## Remaining Gate

B6 does not prove production persistence until Owner separately approves production Sheet write-readback. The next live gate must specify exact write/readback actions, test payload, cleanup policy, and production rollback/observability requirements.
