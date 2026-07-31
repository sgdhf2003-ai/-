# Stage 26-B0 Partial Fulfillment Production Contract Spec

## 1. Executive Summary & Core Loop Alignment

- **Core User**: Sales Assistant / Admin (業務助理 / 管理員).
- **Product Position**: 配貨與出貨資料自動化管理助手.
- **Core Loop**: Outbound 待出貨部分銷扣 (PARTIAL_FULFILL).
- **Purpose**: Define the production partial fulfillment contract spec (`PARTIAL_FULFILL` -> `PARTIAL_FULFILL_DEDUCT`) for a controlled single-case partial fulfillment proof before any production write execution.

---

## 2. Candidate Reservation & Target Semantics

- **Target Controlled Reservation**: `RES-PROV-B10-002` (Controlled Test Hold Record).
- **Initial Hold State**:
  - Reserved Quantity: `10` PCS
  - Status: `RESERVED`
  - Fulfilled Quantity: `0` PCS
  - Remaining Quantity: `10` PCS

- **Partial Fulfillment Action**: `PARTIAL_FULFILL`
  - Partial Transacted Quantity (`quantity` / `fulfilledQuantity`): `4` PCS
  - Remaining Hold Quantity (`remainingQuantity`): `6` PCS (`10 - 4`)

---

## 3. Expected Before/After Sheet State

### A. Holds Sheet (`holds!A1:O1` - 15 Columns)
| Column | Field Name | Initial Value | Post-Action Expected Value | Readback Verification Requirement |
| --- | --- | --- | --- | --- |
| L (12) | `status` | `RESERVED` | `PARTIALLY_FULFILLED` | Exact string equality `PARTIALLY_FULFILLED` |
| O (15) | `updatedAt` | Original ISO | Current ISO Timestamp | Valid ISO 8601 string |

### B. Ledger Sheet (`ledger!A1:G1` - 7 Columns)
| Column | Field Name | Expected Value | Description |
| --- | --- | --- | --- |
| A (1) | `id` | `LEDG-PROV-26B-001` | Unique Ledger Entry ID |
| B (2) | `reservationNumber` | `RES-PROV-B10-002` | Candidate Reservation Number |
| C (3) | `action` | `PARTIAL_FULFILL_DEDUCT` | Exact Ledger Action Mapper Code |
| D (4) | `quantity` | `4` | Transacted Partial Shipped Units |
| E (5) | `remainingQuantity` | `6` | Post-Action Remaining Reserved Balance |
| F (6) | `timestamp` | Current ISO Timestamp | Action Execution Time |
| G (7) | `note` | `Stage 26-B Controlled Single-Case Partial Fulfillment Proof` | Audit Evidence Label |

---

## 4. Idempotency & Replay Rules

- **Idempotency Key**: `reservationNumber` + `action` (`PARTIAL_FULFILL_DEDUCT`) + `quantity` (`4`).
- **Second Call (Replay) Behavior**:
  - Detects existing ledger entry matching `LEDG-PROV-26B-001` or `(RES-PROV-B10-002, PARTIAL_FULFILL_DEDUCT, 4)`.
  - Returns `ok: true`, `idempotencyGuarded: true`, `writebackSuccess: true`, `readbackSuccess: true`, `ledgerRecorded: true`.
  - Appends **0 duplicate rows** to `ledger` and performs **0 additional deductions** on `remainingQuantity`.

---

## 5. Fail-Closed Boundaries & Safety Controls

The system MUST fail closed cleanly without modifying Sheet state under any of the following failure modes:
1. `PARTIAL_QUANTITY_REQUIRED`: `fulfilledQuantity <= 0` or `fulfilledQuantity >= totalQuantity`.
2. `HOLD_NOT_FOUND`: Target reservation number does not exist in `holds`.
3. `HOLD_STATUS_UPDATE_CONFIRMATION_FAILED`: `holds` row update readback fails to confirm `status === "PARTIALLY_FULFILLED"`.
4. `LEDGER_READBACK_VERIFICATION_FAILED`: `ledger` row append readback fails to verify `id` or `reservationNumber`.
5. `UNAUTHORIZED_OPERATOR`: Operator is not an authorized active admin.

---

## 6. Touched Tabs & Notification Boundaries

- **Touched Tabs**: `touchedTabs: ["holds", "ledger"]`.
- **Notification Behavior**: `notificationBypassed: true`. Exactly **0 LINE messages / 0 OneSignal push notifications** sent.
- **Redaction Requirement**: 100% redaction of tokens, client secrets, execution keys, OAuth credentials, and full property values in all logs and reports.
