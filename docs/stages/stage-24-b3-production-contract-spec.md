# Stage 24-B3-A Production Persistence Contract Spec Draft

## Purpose

Stage 24-B3-A defines the production persistence contract that must be proven before live adapter wiring or deployment for Phase 7B/7C Allocation Assistant flows.

This is documentation/spec work only. It does not authorize deploy, Google Sheet writes, LINE API calls, Apps Script production wrapper execution, token/secret access, commit, or push.

This draft is the gate before Stage 24-B4. It records what production must prove; it does not implement the real Sheet adapter or decide unresolved ledger semantics.

## North Star

- Primary operator: Sales Assistant / Admin, not a generic sales rep.
- Product direction: 配貨與出貨資料自動化管理助手.
- Closed loop: Inbound 去保留 -> Outbound 待出貨銷扣.
- Production behavior must reduce assistant workload and fail closed when persistence is not proven.

## Canonical Boundary

- Canonical project root: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`.
- Old Developer, Documents, scratch, and exported copies are stale or backup locations unless the Owner explicitly reassigns the project root.
- `deploy.py --check` is allowed only as dry-run validation from the canonical project root. It must not execute clasp subprocesses, push files, create Apps Script versions, or deploy.
- Real deploy, Sheet write, LINE API call, Script Property access/change, Apps Script production wrapper execution, token/secret access, commit, and push require separate explicit Owner approval.

## 1. Success Definition

Formal hold writeback is successful only when all of the following are true:

1. A real persistence adapter is explicitly injected and exposes the required write capability.
2. The adapter writes to the canonical backend `holds` schema by header name.
3. The adapter returns a confirmed persisted result, not just `success: true`.
4. The adapter can identify the written row by `reservationNumber` after append/update.
5. The returned object, internal record, row representation, persistence result, and readback row all reference the same formal reservation number.
6. The operation can be replayed idempotently without creating a duplicate hold row.

Required ID and row equality:

```text
reservationNumber === holdRecord.id
reservationNumber === rowData[0]
persisted record id === reservationNumber
readback record id === reservationNumber
log/audit correlation for the writeback references reservationNumber
```

`success: true` alone is not enough. The live adapter must prove that the Sheet append/update boundary completed and that the persisted row can be identified by the same reservation number.

### Required production adapter capabilities

The formal hold writeback production adapter must expose:

1. `appendHoldRecord(holdRecord, { headers })`, or an equivalent write method wrapped behind that contract.
2. Header validation against the backend `HEADERS.holds` names before any row write.
3. Idempotent replay by reservation number or idempotency key.
4. Post-write readback by reservation number, or an equivalent confirmed persistence receipt that contains the persisted record ID and row index.
5. A fail-closed result when persistence is missing, rejected, ambiguous, or only simulated.

The fulfillment production adapter must expose:

1. `queryHoldByReservationNumber(reservationNumber)`.
2. `updateHoldStatus({ reservationNumber, status, fulfilledQuantity, remainingQuantity, updatedAt })`.
3. `recordInventoryAdjustment({ reservationNumber, action, item, quantity, remainingQuantity, status, updatedAt })`.
4. A confirmed persisted result for both status update and inventory ledger/snapshot recording.
5. A fail-closed result when any required capability is absent.

## 2. Failure Modes

All production persistence boundaries must fail closed.

| Failure mode | Required behavior | User-facing state |
| --- | --- | --- |
| Missing adapter | Return failure with `HOLD_WRITE_ADAPTER_MISSING` or `FULFILLMENT_ADAPTER_MISSING`; do not claim write success. | Assistant sees that formal record was not written. |
| Missing Sheet headers | Return schema/header failure before append/update. | Assistant must not receive a formal success confirmation. |
| Missing Script Properties | Throw or return property-required failure; do not use stale hardcoded spreadsheet fallbacks. | Assistant sees configuration is missing. |
| Permission/API failure | Return failure with no success confirmation; preserve retry/recovery metadata. | Assistant can retry after Owner/admin fixes permission. |
| Schema mismatch | Return `HOLD_SCHEMA_MISMATCH` or equivalent; do not write positional rows into unknown schema. | Assistant does not proceed with outbound close. |
| Unknown persistence outcome | Treat as not confirmed unless a follow-up read proves the row/status by reservation number. | Assistant sees pending/failure state, not success. |

Production code must not convert ambiguous outcomes into assistant-facing success messages. If a network timeout or API response leaves the write status unknown, the next safe step is readback/reconciliation by reservation number under an owner-approved validation stage.

### Script Properties contract

Production Sheet and LINE configuration must come from Script Properties or an approved runtime configuration layer. Missing properties must fail closed with a safe error code/message and must not trigger a stale hardcoded spreadsheet ID, fallback deployment URL, token lookup, or live API call.

Stage 24-B3-A may inspect source text and simulations for property-gated behavior, but it must not read, print, validate, rotate, or mutate actual Script Property values.

## 3. Data Consistency Contract

Formal writeback must use canonical backend header names, not positional assumptions.

Required backend `holds` headers:

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

Consistency requirements:

1. `reservationNumber === holdRecord.id === rowData[0]`.
2. The written Sheet row, internal record, returned object, and logs must agree on `id`, `item`, `quantity`, `status`, and timestamps.
3. `status` must be `RESERVED` after successful formal hold writeback.
4. Release/cancel flows must preserve the original `reservationNumber` and must not create a replacement hold ID.
5. Fulfillment status writes must transition only to `FULFILLED`, `PARTIALLY_FULFILLED`, or `CANCELLED`.
6. Fulfillment status update, inventory adjustment, returned object, and logs must agree on `reservationNumber`, `action`, `status`, `fulfilledQuantity`, and `remainingQuantity`.
7. Header comparison must fail before persistence when backend headers differ from the formatter contract.

## 4. Mock Boundary

Mock adapters are allowed only through explicit test or simulation injection.

Production paths must not instantiate or silently fall back to mock persistence.

Required behavior:

```text
new FormalHoldWritebackAdapter().executeWriteback(...) -> fail closed
new FormalHoldWritebackAdapter({ sheetAdapter: new MockFormalReservationAdapter() }) -> simulation only
```

The same boundary applies to fulfillment persistence. If the real adapter does not expose lookup, status update, and inventory ledger methods, outbound fulfillment must fail closed.

Simulation pass conditions do not prove production persistence. They prove contract behavior and guard against regressions until an owner-approved live adapter validation can safely exercise real Sheet boundaries.

## 5. Fulfillment Ledger Semantics

Fulfillment persistence must record both the hold status transition and the inventory adjustment boundary.

Required ledger actions:

| Contract action | Current B2 emitted action | Hold status | Ledger intent | Quantity rule |
| --- | --- | --- | --- | --- |
| `FULL_SHIP` | `FULFILL_DEDUCT` | `FULFILLED` | Deduct all reserved quantity from inventory snapshot or ledger. | `quantity` should equal shipped quantity. |
| `PARTIAL_SHIP` | `PARTIAL_FULFILL_DEDUCT` | `PARTIALLY_FULFILLED` | Deduct confirmed shipped quantity and preserve remaining hold quantity. | `quantity` should equal shipped quantity; `remainingQuantity` records balance. |
| `CANCEL_RELEASE` | `CANCEL_RELEASE` | `CANCELLED` | Release reserved quantity back to available inventory snapshot or ledger. | `quantity` equals released quantity; `remainingQuantity` remains audit context after release/cancel. |

Owner decision recorded in Stage 24-B3-C: use an explicit semantic mapper for fulfillment ledger action naming.

Required mapper:

```text
FULL_SHIP -> FULFILL_DEDUCT
PARTIAL_SHIP -> PARTIAL_FULFILL_DEDUCT
CANCEL_RELEASE -> CANCEL_RELEASE
```

Stage 24-B4 must implement this as an explicit boundary mapper before live adapter wiring. Do not silently rename ledger actions in production code.

Owner decision recorded in Stage 24-B3-B:

- Use Option B for `CANCEL_RELEASE` ledger semantics.
- `CANCEL_RELEASE.quantity` equals the released quantity.
- `CANCEL_RELEASE.remainingQuantity` remains audit context after release/cancel.

Current Stage 24-B2 implementation records `CANCEL_RELEASE` with `quantity: 0` and the released amount in `remainingQuantity`. Stage 24-B4 must update or map that behavior to the Owner-approved Option B contract before live adapter wiring.

Partial fulfillment must require explicit quantity confirmation. Text command `部分出貨 #RES-...` may open or require a confirmation flow, but it must not silently full-close the hold.

### CANCEL_RELEASE decision rationale

Option B is the production contract because:

1. The ledger row is self-describing: `quantity` records the amount released by the cancellation.
2. It aligns with fulfillment rows where `quantity` represents the amount that changed inventory availability.
3. It keeps `remainingQuantity` available as audit context rather than overloading it as the primary delta.

No production code should be changed for this choice in Stage 24-B3-B. The implementation belongs to a later Owner-approved B4 scope.

## 6. Side-Effect Classification

| Operation | Classification | Allowed without separate Owner approval |
| --- | --- | --- |
| Read local repository files | Read-only | Yes |
| Run `npm run simulate:all` | Read-only local validation | Yes |
| Run `python3 deploy.py backend --check` | Dry-run deploy validation | Yes, only when output confirms no clasp command executed |
| Run `python3 deploy.py line-bot --check` | Dry-run deploy validation | Yes, only when output confirms no clasp command executed |
| Run `git diff --check` | Read-only local validation | Yes |
| Run Apps Script production wrapper | Apps Script production wrapper execution | No |
| `clasp push`, `clasp pull`, `clasp deploy`, version creation | Deploy / remote mutation | No |
| Append/update Google Sheet rows | Sheet write | No |
| Read/modify Script Properties | Token/secret/config access or production config mutation depending on operation | No |
| LINE reply/push API call | LINE API | No |
| Token/secret read, output, rotation | Token/secret access | No |
| Commit or push | Git mutation / remote mutation | No, unless Owner approves exact scope |

## 7. Test Evidence Before Live Wiring

Required pre-live evidence:

| Contract item | Evidence |
| --- | --- |
| No implicit mock | `tests/simulations/allocation-formal-hold-writeback.sim.js` no-adapter test expects `HOLD_WRITE_ADAPTER_MISSING`. |
| Explicit mock only | Formal writeback simulation injects `MockFormalReservationAdapter` intentionally. |
| Header-name mapping | Formal writeback simulation compares `FormalHoldWritebackAdapter.HOLDS_HEADERS` to backend `HEADERS.holds` from `google-apps-script/Code.gs`. |
| Return consistency | Formal writeback simulation asserts `reservationNumber === holdRecord.id` and `reservationNumber === rowData[0]`. |
| Write failure fail-closed | Formal writeback simulation forces writeback failure/header mismatch and expects failure. |
| Idempotent replay | Formal writeback simulation replays the same reservation number and expects one stored hold. |
| Fulfillment full close | Fulfillment simulation expects persisted `FULFILLED` status and current `FULFILL_DEDUCT` ledger boundary. |
| Fulfillment partial close | Fulfillment simulation expects `PARTIALLY_FULFILLED`, confirmed shipped quantity, and remaining quantity. |
| Fulfillment cancel/release | Fulfillment simulation expects `CANCELLED` and current `CANCEL_RELEASE` ledger boundary. |
| Partial quantity confirmation | Fulfillment simulation blocks partial fulfillment without valid quantity. |
| JingyangAssistant spreadsheet access | Formal writeback simulation verifies property-gated spreadsheet access and absence of stale hardcoded fallback. |

Before production deployment, add or run a dry-run/live-adapter validation that proves the real adapter can:

1. Read canonical headers.
2. Append or update by header names.
3. Re-read the persisted row by reservation number.
4. Update fulfillment status by reservation number.
5. Record or update inventory snapshot/ledger according to Owner-approved `CANCEL_RELEASE` semantics.
6. Return a failure when Script Properties are missing without using a stale spreadsheet fallback.

Any live Sheet write, LINE API call, Script Property access/change, Apps Script wrapper execution, or deploy requires a separate explicit Owner approval.
