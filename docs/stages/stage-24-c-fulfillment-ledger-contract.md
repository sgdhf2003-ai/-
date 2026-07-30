# Stage 24-C Production Fulfillment Ledger Contract

## 1. Overview & Product Position

- **Core User**: Sales Assistant / Admin (業務助理 / 管理員).
- **Core Loop**: Inbound 去保留 -> Outbound 待出貨銷扣.
- **Purpose**: Define the production fulfillment ledger persistence contract for outbound shipment and hold cancellation audit, ensuring exact schema ordering, fail-closed safety, and explicit CANCEL_RELEASE semantics before live single ledger writeback proof execution.

---

## 2. Fulfillment Action & CANCEL_RELEASE Semantics Contract

The outbound fulfillment loop supports 4 primary fulfillment actions:

1. **`FULL_FULFILL` (全額出貨)**:
   - `status`: `"FULFILLED"`
   - `action`: `"FULFILL_DEDUCT"`
   - `quantity`: Transacted fulfillment units (e.g. `10` PCS).
   - `remainingQuantity`: `0` PCS remaining on hold.

2. **`PARTIAL_FULFILL` (部分出貨)**:
   - `status`: `"PARTIALLY_FULFILLED"`
   - `action`: `"PARTIAL_FULFILL_DEDUCT"`
   - `quantity`: Transacted partial fulfillment units (e.g. `3` PCS).
   - `remainingQuantity`: Post-shipment balance remaining on hold (e.g. `7` PCS).

3. **`CLOSE_FULFILL` (結案銷扣)**:
   - `status`: `"FULFILLED"`
   - `action`: `"CLOSE_FULFILL_DEDUCT"`
   - `quantity`: Transacted final fulfillment units.
   - `remainingQuantity`: `0` PCS.

4. **`CANCEL_RELEASE` (取消保留 / 庫存釋放歸還)**:
   - **Semantic Resolution**:
     - `quantity`: Records the **RELEASED QUANTITY** (the quantity being unreserved and returned to available inventory pool, e.g. `10` PCS released).
     - `remainingQuantity`: Records the **POST-RELEASE BALANCE** (the remaining held quantity after cancellation, which is `0` PCS).
     - Both values are explicitly preserved! `quantity` = released quantity, `remainingQuantity` = post-release held balance (`0`).

---

## 3. Production Sheet & Script Property Contracts

### A. Script Properties Required
- `JYAI_ALLOCATION_PRODUCTION_SPREADSHEET_ID`: Production Spreadsheet ID (`1C_R1DdTj5brxftl9fPabTKBGzcG-lxWWxWoyi-ItA48`).
- `JYAI_ALLOCATION_PRODUCTION_HOLDS_SHEET_NAME`: Holds tab name (`holds`).
- `JYAI_ALLOCATION_PRODUCTION_LEDGER_SHEET_NAME`: Ledger tab name (`ledger`).

### B. Production `ledger` Tab Header Contract (7 Columns - A1:G1)
1. `id`: Ledger entry UUID / ID (`LEDG-YYYYMMDD-XXX`).
2. `reservationNumber`: Reservation ID (`RES-YYYYMMDD-XXX`).
3. `action`: Fulfillment action string (`FULFILL_DEDUCT`, `PARTIAL_FULFILL_DEDUCT`, `CANCEL_RELEASE`).
4. `quantity`: Transacted/Released units.
5. `remainingQuantity`: Post-action remaining held balance.
6. `timestamp` / `updatedAt`: ISO 8601 UTC timestamp string (`YYYY-MM-DDTHH:mm:ss.sssZ`).
7. `note` / `status`: Operational notes or status string.

---

## 4. Adapter Capability & Verification Boundaries

### A. Non-Mutating / Local Checks
- `npm run check` (Local syntax & type check)
- `npm run simulate:all` (178/178 PASS local simulation suite)
- `python3 deploy.py backend --check` (Dry-run deployment check)
- `git diff --check` (Whitespace & formatting check)
- Web App `READINESS_CHECK` mode (Pure read-only online readiness check)

### B. Steps Requiring Explicit Owner Approval
- **Stage 24-C1**: Controlled Live Single Ledger Writeback Proof (Deploy Version 86 & append exactly 1 ledger row to production `ledger` tab).
- **Stage 24-C2**: Final Cleanup & Production Lock Gate.
- **Stage 24-C3**: Closure Commit & Push Gates.
