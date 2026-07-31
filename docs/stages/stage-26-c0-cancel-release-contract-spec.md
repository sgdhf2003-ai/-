# Stage 26-C0 Cancel/Release Production Contract Spec

## 1. Executive Summary & Core Loop Alignment

- **Core User**: Sales Assistant / Admin (業務助理 / 管理員).
- **Product Position**: 配貨與出貨資料自動化管理助手.
- **Core Loop**: Outbound 取消保留與預留庫存釋放 (CANCEL_RELEASE).
- **Purpose**: Define the production cancel/release contract spec (`CANCEL_FULFILL` -> `CANCEL_RELEASE`) for a controlled single-case cancel/release proof before any production write execution.

---

## 2. Candidate Reservation & Target Semantics

- **Target Controlled Reservation**: `RES-PROV-B10-003` (Controlled Test Hold Record).
- **Initial Hold State**:
  - Reserved Quantity: `6` PCS
  - Status: `RESERVED`
  - Fulfilled Quantity: `0` PCS
  - Remaining Quantity: `6` PCS

- **Cancel/Release Action**: `CANCEL_FULFILL`
  - Ledger Action Mapper Code: `CANCEL_RELEASE`
  - Released Reserved Quantity (`quantity`): `6` PCS (total released quantity returned to pool)
  - Post-Release Remaining Hold Quantity (`remainingQuantity`): `0` PCS (post-cancel remaining active hold balance)

---

## 3. Expected Before/After Sheet State

### A. Holds Sheet (`holds!A1:O1` - 15 Columns)
| Column | Field Name | Initial Value | Post-Action Expected Value | Readback Verification Requirement |
| --- | --- | --- | --- | --- |
| L (12) | `status` | `RESERVED` | `CANCELLED` | Exact string equality `CANCELLED` |
| O (15) | `updatedAt` | Original ISO | Current ISO Timestamp | Valid ISO 8601 string |

### B. Ledger Sheet (`ledger!A1:G1` - 7 Columns)
| Column | Field Name | Expected Value | Description |
| --- | --- | --- | --- |
| A (1) | `id` | `LEDG-PROV-26C-001` | Unique Ledger Entry ID |
| B (2) | `reservationNumber` | `RES-PROV-B10-003` | Candidate Reservation Number |
| C (3) | `action` | `CANCEL_RELEASE` | Exact Ledger Action Mapper Code |
| D (4) | `quantity` | `6` | Total Released Reserved Units |
| E (5) | `remainingQuantity` | `0` | Post-Release Remaining Active Hold Balance |
| F (6) | `timestamp` | Current ISO Timestamp | Action Execution Time |
| G (7) | `note` | `Stage 26-C Controlled Single-Case Cancel/Release Proof` | Audit Evidence Label |

---

## 4. Idempotency & Replay Rules

- **Idempotency Key**: `reservationNumber` + `action` (`CANCEL_RELEASE`).
- **Second Call (Replay) Behavior**:
  - Detects existing ledger entry matching `LEDG-PROV-26C-001` or `(RES-PROV-B10-003, CANCEL_RELEASE)`.
  - Returns `ok: true`, `idempotencyGuarded: true`, `writebackSuccess: true`, `readbackSuccess: true`, `ledgerRecorded: true`.
  - Appends **0 duplicate rows** to `ledger` and performs **0 duplicate inventory releases**.

---

## 5. Fail-Closed Boundaries & Safety Controls

The system MUST fail closed cleanly without modifying Sheet state under any of the following failure modes:
1. `HOLD_NOT_FOUND`: Target reservation number does not exist in `holds`.
2. `HOLD_STATUS_UPDATE_CONFIRMATION_FAILED`: `holds` row update readback fails to confirm `status === "CANCELLED"`.
3. `LEDGER_READBACK_VERIFICATION_FAILED`: `ledger` row append readback fails to verify `id` or `reservationNumber`.
4. `UNAUTHORIZED_OPERATOR`: Operator is not an authorized active admin.

---

## 6. Touched Tabs & Notification Boundaries

- **Touched Tabs**: `touchedTabs: ["holds", "ledger"]`.
- **Notification Behavior**: `notificationBypassed: true`. Exactly **0 LINE messages / 0 OneSignal push notifications** sent.
- **Redaction Requirement**: 100% redaction of tokens, client secrets, execution keys, OAuth credentials, and full property values in all logs and reports.
