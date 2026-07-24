# JYAI Allocation Assistant - Phase 4 Formal Holds Integration & Sync Safety Specification

**Document Version**: `v1.0.0`
**Date**: `2026-07-24`
**Status**: `PROPOSED_SPECIFICATION`
**Module**: `JYAI Allocation Assistant (Phase 4 Formal Holds Sync & Recovery Engine)`

---

## 1. Phase 4 Business Outcomes & Explicit Non-Goals

### 1.1 Business Outcomes
* Specify the formal reservation synchronization engine (`AllocationSyncEngine`) managing draft sync lifecycle transitions.
* Establish a fail-safe state machine governing sync progression: `ALLOCATION_CONFIRMED` -> `SYNC_PENDING` -> `SYNC_IN_PROGRESS` -> `SYNCED` (or `SYNC_FAILED`).
* Define explicit deduplication guards using separate keys (`holdIdempotencyKey` vs `notificationDedupeKey`).
* Specify the unknown-outcome network interruption recovery mechanism (querying existing reservation status prior to retry).
* Establish `FormalReservationAdapter` abstract interface and `MockFormalReservationAdapter` for offline simulation testing.
* Validate all synchronization contracts and recovery workflows via comprehensive TDD simulation suites.

### 1.2 Explicit Non-Goals (Safety Boundaries)
* **NO Unauthorized Sheet Writes**: Real Google Sheets reservation table writes are disabled unless explicitly authorized by the Owner in isolated staging test tokens.
* **NO Automated LINE Notifications**: Phase 4 focuses strictly on inventory reservation sync, keeping LINE messaging fully decoupled.
* **NO Production Deployment**: Absolutely no `clasp push` or `clasp deploy` operations.

---

## 2. Sync Engine State Lifecycle Model

```
       [ ALLOCATION_CONFIRMED ]
                   │
                   ▼ (syncEngine.enqueueSync)
            [ SYNC_PENDING ]
                   │
                   ▼ (syncEngine.executeSync)
          [ SYNC_IN_PROGRESS ]
          ┌────────┴────────┐
          ▼                 ▼
     [ SYNCED ]      [ SYNC_FAILED ]
  (Hold Recorded)    (Retry Eligible)
```

1. **`ALLOCATION_CONFIRMED`**: Draft items locked locally by user approval.
2. **`SYNC_PENDING`**: Enqueued for synchronization; `holdIdempotencyKey` assigned.
3. **`SYNC_IN_PROGRESS`**: Reservation request actively executing. State locked to prevent duplicate parallel attempts.
4. **`SYNCED`**: Reservation confirmed by target adapter. Formal hold record linked.
5. **`SYNC_FAILED`**: Reservation request rejected or timed out. Error reason recorded for manual or automatic retry.

---

## 3. Deduplication Guards & Unknown-Outcome Recovery

### 3.1 Key Separation
* **`holdIdempotencyKey`**: Identifies the specific inventory reservation payload (e.g., `hold_idem_draft123_v1`). Guarantees target system creates exactly one reservation record.
* **`notificationDedupeKey`**: Identifies notification events (e.g., `notify_dedupe_hold123`). Ensures decoupled messaging system never dispatches duplicate alerts.

### 3.2 Unknown-Outcome Recovery Workflow
```
Client                      SyncEngine                      Adapter
  │                             │                              │
  │─── executeSync(draftId) ───►│                              │
  │                             │─── createReservation(...) ──►│ ──┐ (Network Interrupt
  │                             │   (Request in-flight)        │   │  Before Response)
  │                             │                              │ ◄─┘
  │                             │                              │
  │─── retrySync(draftId) ─────►│                              │
  │                             │─── getReservationStatus ────►│
  │                             │    (by holdIdempotencyKey)   │
  │                             │◄── [ EXISTS: hold_999 ] ─────│
  │◄── [ SUCCESS: SYNCED ] ─────│  (Recovers state without     │
  │                             │   duplicate reservation)     │
```

---

## 4. FormalReservationAdapter Interface & Mock Adapter

### 4.1 `FormalReservationAdapter` Abstract Base Class
```javascript
class FormalReservationAdapter {
  createReservation(syncRequest) {
    throw new Error('UNIMPLEMENTED_METHOD: FormalReservationAdapter.createReservation must be implemented');
  }

  getReservationStatus(holdIdempotencyKey) {
    throw new Error('UNIMPLEMENTED_METHOD: FormalReservationAdapter.getReservationStatus must be implemented');
  }
}
```

### 4.2 `MockFormalReservationAdapter`
Maintains an in-memory `Map<holdIdempotencyKey, reservationRecord>` to simulate successful holds, network timeouts, and duplicate key conflicts in offline Node.js test environments.

---

## 5. Sync Contract Schemas (`SyncRequest` & `SyncResult`)

### 5.1 `SyncRequest` Schema
```javascript
{
  syncRequestId: 'req_sync_001',
  draftId: 'draft_100',
  holdIdempotencyKey: 'hold_idem_draft_100',
  tenantContext: { tenantId: 'tenant-jy-001', companyId: 'comp-jy' },
  items: [
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', quantity: 10 }
  ],
  requestedAt: '2026-07-24T16:48:00Z'
}
```

### 5.2 `SyncResult` Schema
```javascript
{
  success: true,
  syncRequestId: 'req_sync_001',
  draftId: 'draft_100',
  reservationId: 'hold_ref_999',
  status: 'SYNCED',
  syncedAt: '2026-07-24T16:48:01Z',
  errorCode: ''
}
```

---

## 6. Small Packs & Commit Boundaries

Phase 4 implementation follows 4 distinct TDD packs:

* **Small Pack 4A**: `feat(allocation-sync): add formal reservation adapter interface and contracts`
  - Implement `FormalReservationAdapter`, `MockFormalReservationAdapter`, and update contract validators `validateSyncRequest` / `validateSyncResult`.
* **Small Pack 4B**: `feat(allocation-sync): add allocation sync engine and state machine`
  - Implement `AllocationSyncEngine` managing sync lifecycle transitions (`SYNC_PENDING` -> `SYNC_IN_PROGRESS` -> `SYNCED`).
* **Small Pack 4C**: `feat(allocation-sync): add idempotency guard and unknown-outcome recovery`
  - Implement recovery logic querying `getReservationStatus()` on retry after simulated network interruptions.
* **Small Pack 4D**: `test(allocation-sync): cover full reservation sync simulation scenarios and update handoff`
  - Add end-to-end sync simulation suite `tests/simulations/allocation-sync.sim.js`.
  - Update `CHANGELOG.md`, `CURRENT_HANDOFF.md`, and `ROADMAP.md`.

---

## 7. Security & Permission Control Rules

* **Fail-Closed Strategy**: Any unhandled error during sync transitions draft to `SYNC_FAILED` and records an immutable `AuditEvent`.
* **No Direct Side Effects**: All reservation operations delegate through `FormalReservationAdapter`.
* **Strict State Locking**: Drafts in `SYNC_IN_PROGRESS` or `SYNCED` cannot be modified or re-allocated.
