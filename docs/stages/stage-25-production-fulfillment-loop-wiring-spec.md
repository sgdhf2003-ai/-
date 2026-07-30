# Stage 25 Production Fulfillment Loop Live Wiring Spec

## 1. Overview & North Star Alignment

- **Core User**: Sales Assistant / Admin (業務助理 / 管理員).
- **Product Position**: 配貨與出貨資料自動化管理助手.
- **Core Loop**: Inbound 去保留 -> Outbound 待出貨銷扣.
- **Purpose**: Define the production fulfillment loop live wiring spec for Sales Assistant LINE Bot text commands (`全額出貨`, `部分出貨`, `取消保留`), setting authentication, idempotency, fail-closed boundaries, and gated rollout controls before live production execution.

---

## 2. LINE Command Entrypoints & Action Routing

The LINE Bot `JingyangAssistant` and `FulfillmentAdapter` parse text commands from Sales Assistants:

1. **`全額出貨` / `出貨`**:
   - **Trigger Text**: `全額出貨 #RES-YYYYMMDD-XXX` or `出貨 RES-YYYYMMDD-XXX`
   - **Parsed Action**: `FULL_FULFILL`
   - **Ledger Action**: `FULFILL_DEDUCT`
   - **Hold Status Transition**: `CONFIRMED` -> `FULFILLED`
   - **Quantity**: Full reserved quantity (`quantity = hold.quantity`, `remainingQuantity = 0`).

2. **`部分出貨`**:
   - **Trigger Text**: `部分出貨 #RES-YYYYMMDD-XXX [數量]`
   - **Parsed Action**: `PARTIAL_FULFILL`
   - **Ledger Action**: `PARTIAL_FULFILL_DEDUCT`
   - **Hold Status Transition**: `CONFIRMED` -> `PARTIALLY_FULFILLED`
   - **Quantity**: Transacted partial quantity (`fulfilledQuantity = [數量]`, `remainingQuantity = hold.quantity - [數量]`).
   - **Validation**: Requires `fulfilledQuantity > 0` and `fulfilledQuantity < totalQuantity`; otherwise fails closed with `PARTIAL_QUANTITY_REQUIRED`.

3. **`取消保留` / `取消`**:
   - **Trigger Text**: `取消保留 #RES-YYYYMMDD-XXX` or `取消 RES-YYYYMMDD-XXX`
   - **Parsed Action**: `CANCEL_FULFILL`
   - **Ledger Action**: `CANCEL_RELEASE`
   - **Hold Status Transition**: `CONFIRMED` -> `CANCELLED`
   - **Quantity**: `quantity` = released quantity (`hold.quantity`), `remainingQuantity` = `0` (post-release remaining hold balance).

---

## 3. Authentication & Operator Authorization Requirements

1. **LINE User Authorization Check**:
   - Extract LINE `userId` from incoming webhook event source.
   - Verify `userId` against `USER_BINDINGS` Script Property (or active admin user whitelist).
   - If binding lookup fails or account status is not `啟用`, fail closed with `RECIPIENT_BINDING_NOT_FOUND` / `UNAUTHORIZED_OPERATOR` without modifying Sheet or deducting inventory.

2. **Execution Key Protection**:
   - Web App direct endpoints require valid `JYAI_B8_RUNTIME_PROOF_EXECUTION_KEY` matching internal Script Property.

---

## 4. Sheet Ledger Write Contract & Idempotency Rules

### A. Two-Step Atomic Persistence
1. **Step 1 - Hold Status Update (`holds!A1:O1`)**:
   - Update `status` (`FULFILLED`, `PARTIALLY_FULFILLED`, `CANCELLED`), `fulfilledQuantity`, `remainingQuantity`, and `updatedAt`.
   - Read back updated row and confirm `status` matches expected value.
2. **Step 2 - Ledger Entry Append (`ledger!A1:G1`)**:
   - Append 7-column ledger row: `[id, reservationNumber, action, quantity, remainingQuantity, timestamp, note]`.
   - Read back last row and confirm `id` and `reservationNumber` match.

### B. Idempotency Key Rules
- **Idempotency Key**: `reservationNumber` + `action` + `status`.
- If hold record is already in requested terminal status (`FULFILLED` or `CANCELLED`), return previous replay summary without creating duplicate ledger row.

---

## 5. Fail-Closed Safety Boundaries

If any of the following conditions occur, the system MUST fail closed cleanly:
- `PRODUCTION_SHEET_CONFIG_MISSING`: Missing Script Property (`JYAI_ALLOCATION_PRODUCTION_SPREADSHEET_ID` etc.).
- `HOLD_SCHEMA_MISMATCH` / `LEDGER_SCHEMA_MISMATCH`: Sheet header order does not match exact 15-column `holds` or 7-column `ledger` schemas.
- `PRODUCTION_STATUS_UPDATE_CONFIRMATION_MISSING`: Hold row update readback failed to confirm.
- `PRODUCTION_LEDGER_WRITE_CONFIRMATION_MISSING`: Ledger row append readback failed to confirm.
- `UNAUTHORIZED_OPERATOR`: LINE user is not an active authorized admin.

---

## 6. Gated Execution Rollout Plan

- **Gate 25-A**: Wiring Spec & Contract Definition (Read-only / Docs - Current Gate).
- **Gate 25-B**: Local Simulations & Wireup Assertions (`npm run simulate:all`, `npm run check`, `deploy.py backend --check`).
- **Gate 25-C1**: Controlled Live Outbound Fulfillment Proof (Backend Version 88 & 1 controlled test fulfillment proof).
- **Gate 25-C2**: Production Lock & Cleanup Gate (Backend Version 89 & lock).
- **Gate 25-C3**: Main Closure Commit & Push Gate.
