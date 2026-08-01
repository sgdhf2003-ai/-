# JYAI Allocation Assistant - Production Operating Standard Operating Procedure (SOP)

## 1. Executive Summary & Purpose

This document establishes the official Production Operating Standard Operating Procedure (SOP) for the **Jingyang Sales Assistant (配貨與出貨資料自動化管理助手)** system. It defines the validated operational workflows, authorization boundaries, fail-closed security guards, and live production test evidence supporting formal inventory hold writeback and outbound fulfillment.

---

## 2. Verified Live Production Evidence

The formal hold writeback and outbound fulfillment persistence contracts have been **100% verified on live production Google Spreadsheets**:

- **Stage 30 Controlled Writeback Proof (`RES-20260801-001`)**:
  - Target Tab: `holds`
  - Test Store ID: `TEST-STORE-999`
  - Writeback & Readback Result: `PASS`
  - ID Equality Contract (`reservationNumber === holdRecord.id === rowData[0]`): `PASS`
  - Cleanup Status: `TEST_CLEANUP_DELETED`
- **Stage 31 Controlled Fulfillment Proof (`RES-20260801-002`)**:
  - Target Store ID: `TEST-STORE-999`
  - Lifecycle Status Transitions: `ACTIVE` → `PARTIAL_FULFILLED` → `CANCELLED` → `TEST_CLEANUP_DELETED`
  - Writeback & Readback Result: `PASS`
  - ID Contract Verification: `PASS`
  - Side-Effects: **0 LINE pushes**, **0 OneSignal notifications**, **0 emails**, **0 real stock deductions**.
- **Automated Verification Suite**: `npm run simulate:all` = **181 / 181 PASS**.

---

## 3. Operator Workflows & Permission Matrix

### 3.1 Workflow 1: Create Formal Hold (保留劃扣)
- **Role**: Sales Admin / Assistant
- **Input**: Customer Name, Store ID, Item SKU, Quantity, Warehouse/Address, Note.
- **System Action**: Generates unique `RES-YYYYMMDD-XXX` reservation ID, pre-validates 15-column `holds` header schema, appends row with `status: ACTIVE` and `reservationStatus: "已收訂 (劃扣)"`.
- **Readback Assertion**: Immediate readback confirms `reservationNumber === holdRecord.id === rowData[0]`.

### 3.2 Workflow 2: Partial Fulfillment (部分銷扣出貨)
- **Role**: Sales Admin / Assistant
- **Input**: Reservation ID (`RES-YYYYMMDD-XXX`), Fulfilled Quantity.
- **Validation**: Checks `fulfilledQuantity <= totalQuantity` and `remainingQuantity > 0`.
- **System Action**: Updates `holds` row status to `PARTIAL_FULFILLED`, appends 7-column row to `ledger` tab (`action: FULFILL_PARTIAL`, `quantity: N`, `remainingQuantity: N`).

### 3.3 Workflow 3: Cancel Release (取消釋放劃扣)
- **Role**: Sales Admin / Assistant
- **Input**: Reservation ID (`RES-YYYYMMDD-XXX`), Cancellation Reason/Note.
- **System Action**: Updates `holds` row status to `CANCELLED`, appends 7-column row to `ledger` tab (`action: CANCEL_RELEASE`, `quantity: N`, `remainingQuantity: 0`). Releases held stock without negative quantity corruption.

### 3.4 Workflow 4: Readback / Audit Query (查詢與稽核)
- **Role**: All Staff / Admin
- **System Action**: Queries reservation record history by ID or Store Name. Returns sanitized, redacted audit output.

### 3.5 Workflow 5: Admin Cleanup / Correction (管理員修正與清理)
- **Role**: **Admin Only** (`role === "admin"`)
- **Input**: Reservation ID (`RES-YYYYMMDD-XXX`), Correction Status (`TEST_CLEANUP_DELETED` / `CORRECTED`).
- **System Action**: Updates row status cleanly with audit log trail. Restricts test rows from contaminating sales reports.

---

## 4. Fail-Closed Security Guards

The system enforces strict fail-closed protections before executing any write:

| Exception Scenario | Pre-Check Guard | Fail-Closed Error Code |
| :--- | :--- | :--- |
| **Missing / Drifting Sheet Headers** | Pre-write header comparison against `HEADERS.holds` (15 cols) and `HEADERS.ledger` (7 cols) | `HOLD_SCHEMA_MISMATCH` / `LEDGER_SCHEMA_MISMATCH` |
| **Missing Sheet Tabs** | Tab existence assertion | `HOLDS_SHEET_NOT_FOUND` / `LEDGER_SHEET_NOT_FOUND` |
| **Duplicate / Conflicting ID** | Idempotency guard query before append | `HOLD_IDEMPOTENCY_CONFLICT` |
| **Permission / Access Failure** | Catch block error classifier | `PRODUCTION_SHEET_PERMISSION_DENIED` |
| **Missing Client / Adapter** | Adapter requirement assertion | `PRODUCTION_SHEET_CLIENT_MISSING` |

---

## 5. LINE & Notification Safety Directives

> [!IMPORTANT]
> **LINE Messaging Control**: LINE API push/reply dispatch remains **DISABLED BY DEFAULT** during writeback & fulfillment execution unless explicitly authorized by separate Owner prompt.
> **OneSignal & Email Controls**: All external push notifications and emails are bypassed during adapter writeback operations.
