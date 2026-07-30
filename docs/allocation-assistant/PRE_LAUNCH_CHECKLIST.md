# JYAI Allocation Assistant - Pre-Launch Gate Checklist

**Document Version**: `v1.0.0`
**Date**: `2026-07-24`
**Scope**: `JYAI Allocation Assistant Production Sign-off Checklist`

---

## 1. Pillar 1: Google Sheet Schema Alignment
- [ ] **Inventory Sheet Schema**: Column headers match `productCode`, `warehouseName`, `batchNumber`, `availableQuantity`, `unit`.
- [ ] **Reservation Sheet Schema**: Columns include `draftId`, `reservationId`, `holdIdempotencyKey`, `salesOwner`, `allocatedItems`, `status`, `createdAt`.
- [ ] **Read-Only Default Guard**: Confirm all exploratory lookups utilize `ReadOnlyInventoryAdapter`.

## 2. Pillar 2: Script Properties & Credentials Security
- [ ] **Script Properties Configuration**: All environment parameters configured via Google Apps Script `PropertiesService`.
- [ ] **Fail-Closed Token Validation**: Confirm missing LINE tokens throw `LINE_TOKEN_MISSING` error without leaking credentials to logs.
- [ ] **Dry-Run Validation**: Command `python3 deploy.py backend --check` and `python3 deploy.py line-bot --check` exit code 0.

## 3. Pillar 3: Sync Engine Idempotency & Unknown-Outcome Recovery
- [ ] **Idempotency Guard Active**: `SyncIdempotencyGuard` verifies `holdIdempotencyKey` replay and detects payload conflicts.
- [ ] **Unknown-Outcome Recovery Check**: Network timeouts during reservation calls trigger `queryReservationStatus(holdIdempotencyKey)` before reporting state.
- [ ] **Audit Trail Logging**: Audit logger records `CREATE_DRAFT`, `ANALYZE_ALLOCATION`, `CONFIRM_ALLOCATION`, `SYNC_INITIATED`, `SYNC_COMPLETED`, `SYNC_FAILED`.

## 4. Pillar 4: Sales Operations Training & Sign-off
- [ ] **UAT Demo Walkthrough Completed**: All 3 scenario cards tested in sandbox mode (`UAT_DEMO_GUIDE.md`).
- [ ] **Mixed-Batch Policy Consent Training**: Sales clerks trained on customer consent toggle rules.
- [ ] **Owner Production Authorization**: Explicit owner approval obtained prior to live deployment.
