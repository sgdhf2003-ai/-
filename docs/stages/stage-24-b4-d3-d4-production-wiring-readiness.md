# Stage 24-B4-D3/D4 Production Wiring Readiness

## Purpose

Stage 24-B4-D3/D4 prepares the production Sheet adapter contract after the controlled cloned/test Sheet validation. It is a readiness and dry-run implementation gate only.

This stage does not authorize production Sheet reads/writes, production adapter wiring, deploy, LINE API calls, Script Property value access, Apps Script production wrapper execution, commit, or push.

## Baseline

- Branch: `stage-24-b4-production-sheet-adapter`.
- Baseline commit: `368a4efaace9b9f5762eb559656f048cd033232f`.
- Prior gate: Stage 24-B4-D2 controlled cloned/test Sheet write-readback passed.
- Production Sheet adapter persistence remains unimplemented and unproven.

## Stage 24-B4-D2 Evidence

Stage 24-B4-D2 used a cloned/test Sheet only. Sensitive IDs and config values are redacted by policy.

Validated behavior:

1. Formal hold writeback persisted to the cloned/test `holds` tab.
2. Readback found the written row by reservation number.
3. `reservationNumber === holdRecord.id === rowData[0] === persisted row id`.
4. Same-payload replay did not create a duplicate row.
5. Conflicting replay failed closed with `HOLD_IDEMPOTENCY_CONFLICT`.
6. Fulfillment ledger rows matched the Owner-approved mapper:
   - `FULL_SHIP -> FULFILL_DEDUCT`
   - `PARTIAL_SHIP -> PARTIAL_FULFILL_DEDUCT`
   - `CANCEL_RELEASE -> CANCEL_RELEASE`
7. `CANCEL_RELEASE.quantity` equaled released quantity; `remainingQuantity` remained audit context.
8. No production Sheet, deploy, LINE API, token/secret output, Apps Script production wrapper, commit, push, or main push occurred.

## Production Readiness Contract

### Success Definition

Production persistence succeeds only when the future production adapter proves all of the following:

1. A real production adapter is explicitly injected.
2. Required production config names are present; values are not printed or stored in docs/logs.
3. Required adapter capabilities exist:
   - `appendHoldRecord`
   - `queryHoldByReservationNumber`
   - `updateHoldStatus`
   - `recordInventoryAdjustment`
4. `holds` and fulfillment ledger headers match the canonical contract before any append/update.
5. Write result includes persisted confirmation plus readback or an equivalent receipt.
6. IDs agree across returned object, internal record, row data, persisted row, readback row, and logs:

```text
reservationNumber === holdRecord.id === rowData[0] === persisted row id === readback record id
```

`success: true` is not sufficient without `persisted: true`, confirmed receipt/readback, and ID equality.

### Failure Modes

Production readiness and future production adapters must fail closed for:

| Failure | Required error boundary |
| --- | --- |
| Missing production adapter | `PRODUCTION_SHEET_ADAPTER_MISSING` |
| Mock adapter in production path | `PRODUCTION_MOCK_ADAPTER_FORBIDDEN` |
| Missing required adapter capability | `PRODUCTION_SHEET_ADAPTER_CAPABILITY_MISSING` |
| Missing production config/property presence | `PRODUCTION_SHEET_CONFIG_MISSING` |
| Missing or mismatched `holds` headers | `HOLD_SCHEMA_MISMATCH` |
| Missing or mismatched ledger headers | `LEDGER_SCHEMA_MISMATCH` |
| Permission failure | explicit permission error, no success |
| API failure | explicit API error, no success |
| Unknown write outcome | `PRODUCTION_WRITE_CONFIRMATION_MISSING` unless readback confirms |
| ID mismatch after write/readback | `PRODUCTION_WRITE_ID_MISMATCH` |

### Data Consistency

Formal hold writeback must map by backend header names, not array positions. Required `holds` headers remain:

```text
id
storeId
storeName
salesOwner
item
quantity
reservationStatus
holdAddress
holdDate
expiresAt
reminderAt
note
status
createdAt
updatedAt
```

Fulfillment must preserve:

- `FULL_SHIP -> FULFILL_DEDUCT`
- `PARTIAL_SHIP -> PARTIAL_FULFILL_DEDUCT`
- `CANCEL_RELEASE -> CANCEL_RELEASE`
- `CANCEL_RELEASE.quantity` equals released quantity.
- `CANCEL_RELEASE.remainingQuantity` remains audit context.

### Mock Boundary

Mock adapters are valid only through explicit test/simulation injection. Production readiness rejects `MockFormalReservationAdapter` and any adapter missing production persistence methods.

The controlled cloned/test adapter remains test-only. It is evidence for the contract, not production adapter wiring.

### Side Effects

Allowed in this gate:

- Read local repository files.
- Run local simulations.
- Run deploy wrapper `--check` dry-runs only.
- Run Git diff/status checks.
- Add local-only diagnostics and simulations.

Forbidden without separate Owner approval:

- Production Sheet read/write/readback.
- Fallback Sheet ID usage.
- Script Property value access or output.
- Apps Script production wrapper execution.
- `clasp push`, `clasp pull`, `clasp version`, or `clasp deploy`.
- Backend or LINE Bot deploy.
- LINE API call.
- Token/secret access, output, verification, or rotation.
- Commit or push.

## Test Evidence

Stage 24-B4-D3/D4 adds local-only diagnostics and simulation coverage:

- `allocation-assistant/adapters/production-sheet-readiness-diagnostics.js`
- `tests/simulations/allocation-production-readiness-diagnostics.sim.js`

The simulation proves:

1. Missing production config fails closed with names/status only.
2. Missing production adapter fails closed.
3. Mock adapter cannot silently activate in production readiness.
4. Missing capability fails closed.
5. Header mismatch fails before append/update.
6. Permission/API failures map to explicit errors.
7. Success receipt requires persisted confirmation and ID equality.
8. Unknown write outcome cannot return success without confirmed readback.
9. `CANCEL_RELEASE.quantity` remains released quantity and `remainingQuantity` remains audit context.

## Next Gate

Before any production access, Owner must separately approve the exact action and scope for:

1. Production adapter implementation.
2. Production Sheet config/property presence validation.
3. Any production Sheet readback.
4. Any production Sheet write.
5. Any Apps Script wrapper execution or deploy.

Until then, production persistence remains unimplemented and unproven.
