# JYAI Allocation Assistant - Phase 1 Shadow Allocation Design Specification

**Document Version**: `v1.0.0`
**Date**: `2026-07-24`
**Status**: `PROPOSED_SPECIFICATION`
**Module**: `JYAI Allocation Assistant (JYAI 配貨助手)`

---

## 1. Phase 1 Business Outcomes & Explicit Non-Goals

### 1.1 Business Outcomes
* Establish a standalone, in-memory **Shadow Allocation Core Engine** to calculate stock allocations, evaluate business rules, manage draft lifecycles, and record audit event trails.
* Provide an abstract `AllocationGateway` with modular `AllocationProvider` implementations (`SimulationProvider`, `InternalProvider`, `ExternalProvider`) supporting tenant-aware context (`tenantId`, `companyId`).
* Validate allocation pure-function rules (Single Warehouse Priority, Small Remaining Batch Priority, Batch Mixing Warnings, OCR Confidence Thresholds) via comprehensive simulation tests.
* Ensure full structural compatibility with future integration layers while maintaining a zero-side-effect sandbox environment.

### 1.2 Explicit Non-Goals (Safety Boundaries)
* **NO Official Sheet Writes**: Absolutely no mutation or write operations to Google Sheets (`SHEETS.holds` or inventory sheets).
* **NO LINE Communication**: Absolutely no LINE push message or reply message calls (LINE Messaging API remains completely decoupled).
* **NO Production Deployment**: Absolutely no deployment operations (`clasp push`, `clasp deploy`, or production script releases).
* **NO Production Code Mutation**: Absolutely no modification to existing production files (`app.js`, `index.html`, `google-apps-script/*`, `line-bot-apps-script/*`).

---

## 2. Directory Structure & Module Boundaries

All Phase 1 code will reside strictly inside `allocation-assistant/` and `tests/simulations/`:

```
jingyang-sales-app/
├── allocation-assistant/
│   ├── contracts/
│   │   └── types.js             # Data contracts, state enums, error models
│   ├── domain/
│   │   └── models.js            # Domain classes and JSON schema validators
│   ├── gateway/
│   │   └── allocation_gateway.js# Unified Gateway router and orchestrator
│   ├── providers/
│   │   ├── allocation_provider.js# Base Abstract AllocationProvider interface
│   │   ├── simulation_provider.js# Pure in-memory Simulation Provider
│   │   ├── internal_provider.js  # Stub for internal local GAS provider
│   │   └── external_provider.js  # Stub that fails closed (EXTERNAL_PROVIDER_DISABLED)
│   ├── rules/
│   │   └── rule_evaluator.js    # Pure-function inventory allocation rules engine
│   └── audit/
│       └── audit_logger.js      # In-memory AuditEvent collector and logger
└── tests/
    └── simulations/
        └── shadow-allocation.sim.js # Comprehensive 30-case simulation suite
```

---

## 3. Domain Model & Data Contracts

### 3.1 States & Lifecycle Machine
Draft state transitions follow strict allowed paths:
* `DRAFT` ➔ `OCR_REVIEW` (if confidence < 0.85)
* `DRAFT` ➔ `ALLOCATION_REVIEW` (if confidence >= 0.85 & suggestion generated)
* `OCR_REVIEW` ➔ `ALLOCATION_REVIEW` (after manual correction)
* `ALLOCATION_REVIEW` ➔ `ALLOCATION_CONFIRMED` (via `confirmAllocation`)
* `ALLOCATION_CONFIRMED` ➔ `SYNC_PENDING` (ready for external sync layer)
* Any active state ➔ `CANCELLED` (via `cancelAllocation`)

### 3.2 JSON Schemas & Structural Definitions

#### TenantContext
```json
{
  "tenantId": "tenant-jy-001",
  "companyId": "comp-jingyang-taiwan",
  "timezone": "Asia/Taipei",
  "locale": "zh-TW"
}
```

#### AllocationDraft
```json
{
  "draftId": "draft_abc123xyz789",
  "tenantContext": {
    "tenantId": "tenant-jy-001",
    "companyId": "comp-jingyang-taiwan"
  },
  "status": "DRAFT",
  "sourceSystem": "LINE_BOT_OCR",
  "sourceDraftId": "ocr_msg_99823",
  "idempotencyKey": "idem-key-8c6e2a9b3d7f1e5c0d8f",
  "correlationId": "corr-uuid-4455-6677",
  "salesOwner": "sales_owner_clerk01",
  "storeId": "store_9921",
  "storeName": "勁揚精選店",
  "items": [
    {
      "itemId": "item_row_001",
      "productCode": "EQA-6522",
      "requestedQuantity": 10,
      "parsedConfidence": 0.95,
      "rawOcrText": "EQA-6522 * 10"
    }
  ],
  "createdAt": "2026-07-24T11:00:00Z",
  "updatedAt": "2026-07-24T11:05:00Z"
}
```

#### InventorySnapshot
```json
{
  "snapshotId": "snap_inv_20260724_1100",
  "productCode": "EQA-6522",
  "timestamp": "2026-07-24T11:00:00Z",
  "warehouses": [
    {
      "warehouseName": "林口倉",
      "batches": [
        { "batchNumber": "7J25", "availableQuantity": 15 },
        { "batchNumber": "7K01", "availableQuantity": 3 }
      ]
    },
    {
      "warehouseName": "忠義倉",
      "batches": [
        { "batchNumber": "7J25", "availableQuantity": 5 }
      ]
    }
  ]
}
```

#### AllocationSuggestion
```json
{
  "suggestionId": "sug_alloc_77812",
  "draftId": "draft_abc123xyz789",
  "suggestions": [
    {
      "productCode": "EQA-6522",
      "warehouseName": "林口倉",
      "batchNumber": "7J25",
      "allocatedQuantity": 10
    }
  ],
  "warnings": [],
  "rationale": "優先選取單一倉庫林口倉之批號 7J25 足額分配 (10 PCS)。"
}
```

#### AuditEvent
```json
{
  "eventId": "evt_aud_88192",
  "timestamp": "2026-07-24T11:06:13Z",
  "operator": "sales_owner_clerk01",
  "action": "CONFIRM_ALLOCATION",
  "draftId": "draft_abc123xyz789",
  "details": "User approved allocation suggestion sug_alloc_77812."
}
```

---

## 4. Gateway & Provider Interface Specifications

### 4.1 Interface Methods (AllocationProvider Contract)
All providers implement the `AllocationProvider` abstract interface:

1. **`createDraft(payload)`**: Parses raw input, validates confidence score, assigns initial status (`DRAFT` or `OCR_REVIEW`), stores in-memory.
2. **`analyzeAllocation(draftId, idempotencyKey, inventorySnapshot)`**: Evaluates stock allocation rules against `InventorySnapshot` and returns an `AllocationSuggestion`.
3. **`confirmAllocation(draftId, confirmedItems, idempotencyKey)`**: Locks draft items and updates status to `ALLOCATION_CONFIRMED`. Does not perform external writes.
4. **`cancelAllocation(draftId)`**: Cancels draft, releases locked virtual allocations, sets status to `CANCELLED`.
5. **`getAllocationStatus(draftId)`**: Returns current draft status, item list, and audit trail metadata.

### 4.2 Provider Architecture Behaviors
* **`AllocationGateway`**: Reads tenant routing configuration (`tenantId`). Routes requests to the appropriate provider based on tenant settings.
* **`SimulationProvider`**: Active in Phase 1. Uses in-memory state stores for drafts, inventory snapshots, and audit events.
* **`InternalProvider`**: Interface stub for future Google Apps Script binding. Returns controlled fallback/mock in Phase 1 simulation mode.
* **`ExternalProvider`**: Interface stub for external ERP integration. Must throw `EXTERNAL_PROVIDER_DISABLED` error if invoked.

---

## 5. Allocation Rules & Pure-Function Logic

The rule evaluator (`RuleEvaluator`) executes inventory allocation as pure functions without side effects:

1. **Confidence Threshold Filter**: If any item in the draft has `parsedConfidence < 0.85`, the draft status transitions to `OCR_REVIEW`. Allocation calculation is halted until reviewed.
2. **Overallocation Prevention**: If total available quantity across all warehouses < `requestedQuantity`, generate a warning `INSUFFICIENT_STOCK` (`severity: CRITICAL`). Do not overallocate.
3. **Single Warehouse Priority**: Evaluate warehouses individually. If Warehouse A can fulfill the entire quantity (e.g. 10 PCS), choose Warehouse A over splitting between Warehouse A and B.
4. **Small Remaining Batch Priority**: When selecting among multiple batches in a warehouse, prioritize smaller remaining batches that match or fit the requested quantity to clear near-empty lots first.
5. **Arbitrary Batch Mixing & Warning**: If a single batch cannot cover the requested quantity and multiple batches must be combined, append an `AllocationWarning` with code `BATCH_MIXING_REQUIRED` (`severity: WARNING`). Mixing requires explicit confirmation.

---

## 6. Idempotency & Error Model

### 6.1 Idempotency Guarantee
* Each mutating request (`createDraft`, `analyzeAllocation`, `confirmAllocation`) includes an `idempotencyKey`.
* If a request with an existing `idempotencyKey` is re-sent:
  - If payload matches previous call: Return identical cached response (`isReplay: true`).
  - If payload differs: Reject with error `IDEMPOTENCY_CONFLICT`.

### 6.2 Standardized Error Model
* `DRAFT_NOT_FOUND`: Draft ID does not exist in store.
* `INVALID_DRAFT_STATE`: Operation invalid for current state (e.g., confirming a `CANCELLED` draft).
* `INSUFFICIENT_STOCK`: Requested quantity exceeds available inventory.
* `IDEMPOTENCY_CONFLICT`: Same idempotency key used with conflicting payload.
* `EXTERNAL_PROVIDER_DISABLED`: Attempted invocation of disabled `ExternalProvider`.
* `UNAUTHORIZED_TENANT`: Invalid or missing `tenantId` / `companyId`.

---

## 7. 30 Simulation Test Cases Matrix

The simulation test suite `tests/simulations/shadow-allocation.sim.js` covers 30 comprehensive scenarios:

| # | Category | Test Case Description | Expected Result |
|---|---|---|---|
| 1 | Contract | Draft creation with valid schema | PASS (`status: DRAFT`) |
| 2 | Contract | Missing `tenantId` in payload | Fail closed (`UNAUTHORIZED_TENANT`) |
| 3 | Contract | Missing `companyId` in payload | Fail closed (`UNAUTHORIZED_TENANT`) |
| 4 | Contract | Invalid `sourceDraftId` format | Fail closed (`INVALID_PAYLOAD`) |
| 5 | Lifecycle | Draft creation with OCR confidence = 0.95 | `status: DRAFT` |
| 6 | Lifecycle | Draft creation with OCR confidence = 0.70 | `status: OCR_REVIEW` |
| 7 | Lifecycle | Manual correction of `OCR_REVIEW` draft | Transitions to `ALLOCATION_REVIEW` |
| 8 | Lifecycle | `confirmAllocation` locks draft items | `status: ALLOCATION_CONFIRMED` |
| 9 | Lifecycle | `cancelAllocation` from active draft | `status: CANCELLED` |
| 10 | Lifecycle | Attempting `confirmAllocation` on `CANCELLED` draft | Fail closed (`INVALID_DRAFT_STATE`) |
| 11 | Gateway | Gateway routes `tenant-jy-001` to `SimulationProvider` | Successfully returns provider response |
| 12 | Gateway | Invoking `ExternalProvider` through Gateway | Fail closed (`EXTERNAL_PROVIDER_DISABLED`) |
| 13 | Rules | Single warehouse with sufficient stock | Single warehouse allocation |
| 14 | Rules | Multi-warehouse stock available, single preferred | Selects single warehouse |
| 15 | Rules | Multi-warehouse required due to single warehouse deficit | Splits warehouse + warning `MULTI_WAREHOUSE_REQUIRED` |
| 16 | Rules | Batch selection prioritizing small remaining batch | Selects smaller batch to clear stock |
| 17 | Rules | Single batch insufficient, mixing required | Allocates + warning `BATCH_MIXING_REQUIRED` |
| 18 | Rules | Total stock insufficient across all warehouses | Allocation halted + `INSUFFICIENT_STOCK` warning |
| 19 | Rules | Zero stock available for product code | Allocation halted + `ZERO_STOCK_AVAILABLE` warning |
| 20 | Rules | Multi-item draft allocation | Generates itemized suggestions for all items |
| 21 | Idempotency | Duplicate `createDraft` with identical `idempotencyKey` | Returns original `draftId` (`isReplay: true`) |
| 22 | Idempotency | Duplicate `createDraft` with conflicting payload | Fail closed (`IDEMPOTENCY_CONFLICT`) |
| 23 | Idempotency | Duplicate `confirmAllocation` call | Returns original confirmation result |
| 24 | Audit | `createDraft` records AuditEvent | `action: CREATE_DRAFT` stored |
| 25 | Audit | `analyzeAllocation` records AuditEvent | `action: ANALYZE_ALLOCATION` stored |
| 26 | Audit | `confirmAllocation` records AuditEvent | `action: CONFIRM_ALLOCATION` stored |
| 27 | Audit | Audit log query returns complete timeline | Full audit trail array returned |
| 28 | Security | Pure function rule evaluation check | Zero external state mutation verified |
| 29 | Security | Guarantee no Sheet API invocation | `SpreadsheetApp` uncalled |
| 30 | Security | Guarantee no LINE API invocation | `UrlFetchApp` / LINE push uncalled |

---

## 8. Implementation Phase Commit Plan

Phase 1 code implementation will proceed in distinct, logical commits:
1. `feat(allocation): add contracts, types and json schemas`
2. `feat(allocation): add domain models and state machine validators`
3. `feat(allocation): add pure-function rule evaluator`
4. `feat(allocation): add provider architecture and simulation provider`
5. `feat(allocation): add allocation gateway router`
6. `feat(allocation): add audit logger`
7. `test(allocation): add 30-case simulation suite and verify zero side-effects`
