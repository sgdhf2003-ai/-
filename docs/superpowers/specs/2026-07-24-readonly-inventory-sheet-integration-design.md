# JYAI Allocation Assistant - Phase 2 Read-Only Sheet Inventory Integration Specification

**Document Version**: `v1.0.0`
**Date**: `2026-07-24`
**Status**: `PROPOSED_SPECIFICATION`
**Module**: `JYAI Allocation Assistant (JYAI 配貨助手 - Phase 2)`

---

## 1. Phase 2 Business Outcomes & Explicit Non-Goals

### 1.1 Business Outcomes
* Implement a decoupled, read-only inventory adapter layer (`ReadOnlyInventoryAdapter`) to parse, sanitize, and convert raw Google Sheets inventory row structures into standard `InventorySnapshot` plain objects.
* Provide an in-memory `MockSheetInventoryAdapter` to simulate sheet row data reading, data type coercion, string quantity parsing, and edge-case error handling without touching live Google Sheets.
* Integrate the read-only inventory adapter with `AllocationGateway` and `SimulationProvider` to enable seamless end-to-end stock analysis from raw row arrays.
* Enforce robust fault tolerance policies (negative stock capping, quantity string normalization, physical count unconfirmed warnings) to protect down-stream allocation calculations.

### 1.2 Explicit Non-Goals (Safety Boundaries)
* **NO Sheet Mutation**: Absolutely no write, edit, append, or delete operations on Google Sheets (`SHEETS.holds` or inventory sheets).
* **NO LINE Communication**: Absolutely no LINE push message or reply message calls.
* **NO Production Deployment**: Absolutely no `clasp push` or `clasp deploy` operations.
* **NO Modification to Existing Core UI**: Frontend PWA layout and core production code remain untouched in Phase 2.

---

## 2. Directory Structure & Module Boundaries

Phase 2 implementation files reside inside `allocation-assistant/adapters/` and `tests/simulations/`:

```
jingyang-sales-app/
├── allocation-assistant/
│   ├── adapters/
│   │   ├── readonly_inventory_adapter.js  # Abstract base class for inventory adapters
│   │   ├── mock_sheet_inventory_adapter.js# In-memory mock adapter for raw row arrays
│   │   └── gas_sheet_inventory_adapter.js # Stub for future GAS SpreadsheetApp binding
│   └── index.js                           # Export updated adapter modules
└── tests/
    └── simulations/
        └── readonly-inventory-adapter.sim.js # Simulation test suite for Phase 2
```

---

## 3. Inventory Sheet Schema to Plain Object Snapshot Mapping

### 3.1 Raw Sheet Row Schema (Google Sheets Representation)
Each raw inventory row is represented as a plain object mapping sheet columns:

```json
{
  "productCode": "EQA-6522",
  "warehouseName": "林口倉",
  "batchNumber": "7J25",
  "availableQuantity": "15",
  "physicalConfirmed": true,
  "lastAuditDate": "2026-07-20"
}
```

### 3.2 Standardized `InventorySnapshot` Mapping
The adapter transforms raw row arrays into standardized `InventorySnapshot` structures:

```json
{
  "snapshotId": "snap_sheet_20260724_001",
  "productCode": "EQA-6522",
  "timestamp": "2026-07-24T13:00:00Z",
  "warehouses": [
    {
      "warehouseName": "林口倉",
      "batches": [
        { "batchNumber": "7J25", "availableQuantity": 15 }
      ]
    }
  ],
  "warnings": []
}
```

---

## 4. Read-Only Interface Boundary & Fail-Closed Mechanics

### 4.1 Interface Contract (`ReadOnlyInventoryAdapter`)
All inventory adapters inherit from `ReadOnlyInventoryAdapter`:

1. **`fetchInventorySnapshot(productCode, tenantContext)`**: Returns an `InventorySnapshot` plain object for the given product code and tenant context.
2. **`getWarehouseList(tenantContext)`**: Returns an array of available warehouse names for the tenant.

### 4.2 Fail-Closed Error Policies
* **Missing `productCode`**: Throws `INVALID_PRODUCT_CODE` error.
* **Missing `tenantContext`**: Throws `UNAUTHORIZED_TENANT` error.
* **Adapter Failure / Timeout**: Falls back closed to an empty `InventorySnapshot` with an attached `ADAPTER_UNAVAILABLE` warning.

---

## 5. Fault Tolerance & Warning Policies

1. **Negative Stock Handling**: If a row reports negative `availableQuantity` (e.g. `-5`), coerce `availableQuantity` to `0` and append a warning `NEGATIVE_STOCK_FOUND` (`severity: WARNING`).
2. **String Quantity Normalization**: Convert string quantities (e.g., `" 15 "`, `"20片"`, `"10箱"`) into positive integers. If unparseable, default to `0` and append `UNPARSEABLE_QUANTITY` warning.
3. **Unconfirmed Physical Count (`PHYSICAL_COUNT_UNCONFIRMED`)**: If `physicalConfirmed` is `false` or missing, attach an `AllocationWarning` with code `PHYSICAL_COUNT_UNCONFIRMED` (`severity: INFO`) to notify operators that stock relies on unverified system counts.
4. **Duplicate Batch Aggregation**: If multiple rows contain identical `(warehouseName, batchNumber)`, aggregate their quantities and append a `DUPLICATE_BATCH_AGGREGATED` warning.

---

## 6. Small Packs & Commit Boundaries

Phase 2 implementation will follow 4 distinct, sequential TDD packs:

* **Small Pack 2A**: `feat(allocation): add ReadOnlyInventoryAdapter interface and contract tests`
  - Implement base `ReadOnlyInventoryAdapter` class.
  - Create basic adapter interface validation tests.
* **Small Pack 2B**: `feat(allocation): add MockSheetInventoryAdapter for row data normalization`
  - Implement `MockSheetInventoryAdapter` with row parsing, string coercion, negative stock handling, and physical count unconfirmed warnings.
  - Add comprehensive unit simulation tests for mock adapter edge cases.
* **Small Pack 2C**: `feat(allocation): integrate ReadOnlyInventoryAdapter into AllocationGateway and SimulationProvider`
  - Connect `MockSheetInventoryAdapter` to `SimulationProvider` and `AllocationGateway`.
  - Validate end-to-end flow from raw row dataset to `AllocationSuggestion`.
* **Small Pack 2D**: `test(allocation): add comprehensive read-only sheet inventory simulation test suite and update handoff`
  - Add complete Phase 2 simulation suite `tests/simulations/readonly-inventory-adapter.sim.js`.
  - Update `CHANGELOG.md`, `CURRENT_HANDOFF.md`, and `ROADMAP.md`.

---

## 7. Security & Permission Control Rules

* **Read-Only Execution Guarantee**: Code in `allocation-assistant/adapters/` must never contain any sheet writing keywords (`setValue`, `setValues`, `appendRow`, `deleteRow`, `clear`).
* **Zero Network Dependency**: `MockSheetInventoryAdapter` operates 100% in-memory without external HTTP calls or Apps Script services.
* **Static Security Verification**: All changes are validated via `grep` static analysis before any commit.
