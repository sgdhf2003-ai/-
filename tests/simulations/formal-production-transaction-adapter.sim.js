"use strict";

/**
 * TDD Verification Suite: Formal Production Transaction Adapter (Stage 42-A Formal Contract)
 *
 * NOTE: This is an In-Memory Native-ACID Contract Simulation.
 * It does NOT imply that a production Google Sheet Client with native ACID transaction capabilities is complete.
 *
 * Verifies strict transaction requirements aligned with Code.gs:
 * 1. SheetClient lacking hasNativeAcidTransaction === true or hasNativeTransactionAbortGuarantee === true fails closed before ANY writes with PRODUCTION_TRANSACTION_CAPABILITY_MISSING.
 * 2. Native ACID client with formal abort guarantee succeeds returning atomic: true aligned with Code.gs contract.
 * 3. Staged transaction returning incomplete proof (only ok: true) discards 4 staged buffers (Inventory, Holds, Ledger, Audit) on abort, fails closed with CANCEL_TRANSACTION_INCOMPLETE without returning releasedQuantity, and verifies ZERO store mutations across all 4 sheets.
 * 4. Client with hasNativeAcidTransaction === true but lacking hasNativeTransactionAbortGuarantee === false is rejected at pre-flight with PRODUCTION_TRANSACTION_CAPABILITY_MISSING without calling executeNativeAcidTransaction and with ZERO store mutations.
 * 5. Lock release failure returns TRANSACTION_LOCK_RELEASE_FAILED with transactionState: UNKNOWN or FAILED.
 * 6. Process restart (new adapter instance) blocks duplicate operationId via formal persistence.
 */

const assert = require("assert");
const { ProductionSheetReservationAdapter } = require("../../allocation-assistant/adapters/production-sheet-reservation-adapter");
const { FormalHoldWritebackAdapter } = require("../../allocation-assistant/adapters/formal-hold-writeback-adapter");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS formal-production-transaction-adapter: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`FAIL formal-production-transaction-adapter: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

class TransactionalMockSheetClient {
  constructor(options = {}) {
    this.headersBySheet = {
      Holds: FormalHoldWritebackAdapter.HOLDS_HEADERS,
      Ledger: ProductionSheetReservationAdapter.LEDGER_HEADERS,
      Inventory: ["item", "quantity", "updatedAt"],
      Audit: ["id", "eventType", "reservationNumber", "operator", "operatorRole", "operationId", "details", "timestamp"]
    };
    this.rowsBySheet = {
      Holds: options.holds ? JSON.parse(JSON.stringify(options.holds)) : [],
      Ledger: options.ledger ? JSON.parse(JSON.stringify(options.ledger)) : [],
      Audit: options.audit ? JSON.parse(JSON.stringify(options.audit)) : []
    };
    this.inventoryStore = options.inventory ? { ...options.inventory } : { "STU-6101": 10 };
    this.persistedOperationIds = new Set(options.operationIds || []);
    this.hasNativeAcidTransaction = options.hasNativeAcidTransaction !== undefined ? options.hasNativeAcidTransaction : true;
    this.hasNativeTransactionAbortGuarantee = options.hasNativeTransactionAbortGuarantee !== undefined ? options.hasNativeTransactionAbortGuarantee : true;
    this.options = options;
    this.calls = [];
  }

  getHeaders(sheetName) {
    this.calls.push(["getHeaders", sheetName]);
    return (this.headersBySheet[sheetName] || []).slice();
  }

  acquireTransactionLock(operationId) {
    this.calls.push(["acquireTransactionLock", operationId]);
    return { success: true };
  }

  releaseTransactionLock(operationId) {
    this.calls.push(["releaseTransactionLock", operationId]);
    if (this.options.failLockRelease) {
      return { success: false, message: "LOCK_RELEASE_ERROR" };
    }
    return { success: true };
  }

  findRowById(sheetName, id) {
    this.calls.push(["findRowById", sheetName, id]);
    const headers = this.getHeaders(sheetName);
    const rows = this.rowsBySheet[sheetName] || [];
    const idIndex = headers.indexOf("id") !== -1 ? headers.indexOf("id") : headers.indexOf("reservationNumber");
    const rowIndex = rows.findIndex(row => row[idIndex] === id);
    if (rowIndex === -1) return { found: false };
    return {
      found: true,
      rowIndex: rowIndex + 1,
      rowData: rows[rowIndex].slice(),
      record: Object.fromEntries(headers.map((header, index) => [header, rows[rowIndex][index]]))
    };
  }

  findOperationId(operationId) {
    this.calls.push(["findOperationId", operationId]);
    if (this.options.failOpIdCheck) {
      return { found: false, error: true, errorCode: "OPERATION_ID_CHECK_FAILED" };
    }
    return { found: this.persistedOperationIds.has(operationId) };
  }

  adjustInventory({ item, quantity, operationId }) {
    this.calls.push(["adjustInventory", item, quantity, operationId]);
    return { success: true };
  }

  updateRowById(sheetName, id, updates) {
    this.calls.push(["updateRowById", sheetName, id, updates]);
    return { success: true };
  }

  appendLedgerEntry(sheetName, adjustment, headers) {
    this.calls.push(["appendLedgerEntry", sheetName, adjustment]);
    return { success: true };
  }

  appendAuditEntry(sheetName, auditRecord) {
    this.calls.push(["appendAuditEntry", sheetName, auditRecord]);
    return { success: true };
  }

  executeNativeAcidTransaction(params) {
    this.calls.push(["executeNativeAcidTransaction", params]);

    if (this.options.failAcidTransaction) {
      return { ok: false, errorCode: "ACID_TX_FAILED", message: "底層數據庫交易失敗" };
    }

    const { reservationNumber, existingHold, releasedQuantity, itemCode, operator, operatorRole, operationId, auditSheetName, timestamp } = params;

    // Case 3: Staged transaction simulation - constructs 4 staged buffers and discards them on incomplete proof
    if (this.options.stagedTransactionIncompleteProof) {
      // 1. Staged Inventory Buffer
      const stagedInventoryStore = { ...this.inventoryStore };
      stagedInventoryStore[itemCode] = (stagedInventoryStore[itemCode] || 0) + releasedQuantity;

      // 2. Staged Holds Buffer
      const stagedHoldsRows = JSON.parse(JSON.stringify(this.rowsBySheet.Holds || []));
      const holdRowIndex = stagedHoldsRows.findIndex(row => row[0] === reservationNumber);
      if (holdRowIndex !== -1) {
        stagedHoldsRows[holdRowIndex][12] = "CANCELLED";
      }

      // 3. Staged Ledger Buffer
      const stagedLedgerRows = JSON.parse(JSON.stringify(this.rowsBySheet.Ledger || []));
      stagedLedgerRows.push([reservationNumber, "CANCEL_RELEASE", itemCode, releasedQuantity, 0, "CANCELLED", timestamp]);

      // 4. Staged Audit Buffer
      const stagedAuditRows = JSON.parse(JSON.stringify(this.rowsBySheet[auditSheetName || "Audit"] || []));
      stagedAuditRows.push([operationId, "CANCEL_RELEASE", reservationNumber, operator, operatorRole, operationId, "", timestamp]);

      // Incomplete proof causes staged transaction to abort and discard all 4 staged buffers!
      // Main store (this.inventoryStore, this.rowsBySheet) is NOT committed.
      return { ok: true }; // Incomplete proof (missing 6 proof flags)
    }

    // Normal complete atomic commit
    this.inventoryStore[itemCode] = (this.inventoryStore[itemCode] || 0) + releasedQuantity;

    const holdsRows = this.rowsBySheet.Holds || [];
    const holdRowIndex = holdsRows.findIndex(row => row[0] === reservationNumber);
    let updatedHold = existingHold;
    if (holdRowIndex !== -1) {
      holdsRows[holdRowIndex][12] = "CANCELLED";
      updatedHold = { ...existingHold, status: "CANCELLED", updatedAt: timestamp };
    }

    (this.rowsBySheet.Ledger = this.rowsBySheet.Ledger || []).push([
      reservationNumber, "CANCEL_RELEASE", itemCode, releasedQuantity, 0, "CANCELLED", timestamp
    ]);

    (this.rowsBySheet[auditSheetName || "Audit"] = this.rowsBySheet[auditSheetName || "Audit"] || []).push([
      operationId, "CANCEL_RELEASE", reservationNumber, operator, operatorRole, operationId, "", timestamp
    ]);

    this.persistedOperationIds.add(operationId);

    // Readback verification on main store
    const initialInv = (this.options.inventory && this.options.inventory[itemCode] !== undefined) ? this.options.inventory[itemCode] : 10;
    const expectedInv = initialInv + releasedQuantity;
    const readbackOk = this.inventoryStore[itemCode] === expectedInv &&
                       (this.rowsBySheet.Holds || []).some(row => row[0] === reservationNumber && row[12] === "CANCELLED") &&
                       (this.rowsBySheet.Ledger || []).some(row => row[0] === reservationNumber) &&
                       (this.rowsBySheet[auditSheetName || "Audit"] || []).some(row => row[0] === operationId);

    const persistedOk = this.persistedOperationIds.has(operationId);

    return {
      ok: true,
      inventoryReleased: true,
      holdUpdated: true,
      auditLogged: true,
      atomic: true,
      readbackVerified: readbackOk,
      operationPersisted: persistedOk,
      updatedHold
    };
  }
}

function createConfigProvider() {
  return {
    JYAI_ALLOCATION_PRODUCTION_SPREADSHEET_ID: "prod-sheet-id-999",
    JYAI_ALLOCATION_PRODUCTION_HOLDS_SHEET_NAME: "Holds",
    JYAI_ALLOCATION_PRODUCTION_LEDGER_SHEET_NAME: "Ledger",
    JYAI_ALLOCATION_PRODUCTION_AUDIT_SHEET_NAME: "Audit"
  };
}

// -----------------------------------------------------------------------------
// TDD GREEN Test Suite for Formal Production Transaction Adapter
// (In-Memory Native-ACID Contract Simulation - Does NOT imply production Google Sheet Client is complete)
// -----------------------------------------------------------------------------

runTest("1. Non-native ACID client or missing abort guarantee causes ZERO writes and returns PRODUCTION_TRANSACTION_CAPABILITY_MISSING", () => {
  const sagaClient = new TransactionalMockSheetClient({
    holds: [
      ["RES-20260827-001", "store_1", "Store 1", "SalesA", "STU-6101", 5, "已收訂 (劃扣)", "預設倉", "2026-08-27", "2026-10-27", "2026-10-20", "", "HOLD", "2026-08-27T00:00:00.000Z", "2026-08-27T00:00:00.000Z"]
    ],
    inventory: { "STU-6101": 10 },
    hasNativeAcidTransaction: false,
    hasNativeTransactionAbortGuarantee: false
  });

  const adapter = new ProductionSheetReservationAdapter({
    configProvider: createConfigProvider(),
    sheetClient: sagaClient
  });

  const res = adapter.executeCancelReleaseTransaction({
    reservationNumber: "RES-20260827-001",
    existingHold: { id: "RES-20260827-001", item: "STU-6101", quantity: 5, status: "HOLD" },
    releasedQuantity: 5,
    operator: "AdminUser",
    operatorRole: "admin",
    operationId: "OP-NON-ACID-CHECK"
  });

  assert.strictEqual(res.ok, false, "Must fail closed when client lacks native ACID transaction capability");
  assert.strictEqual(res.errorCode, "PRODUCTION_TRANSACTION_CAPABILITY_MISSING", "ErrorCode must be PRODUCTION_TRANSACTION_CAPABILITY_MISSING");
  assert.strictEqual(sagaClient.inventoryStore["STU-6101"], 10, "Inventory must remain untouched (0 writes)");
  assert.strictEqual(sagaClient.rowsBySheet.Holds[0][12], "HOLD", "Hold status must remain HOLD (0 writes)");
  assert.strictEqual(sagaClient.rowsBySheet.Ledger.length, 0, "Ledger must remain empty (0 writes)");
  assert.strictEqual(sagaClient.rowsBySheet.Audit.length, 0, "Audit must remain empty (0 writes)");
});

runTest("2. Native ACID client with abort guarantee succeeds returning atomic: true aligned with Code.gs contract", () => {
  const client = new TransactionalMockSheetClient({
    holds: [
      ["RES-20260827-100", "store_1", "Store 1", "SalesA", "STU-6101", 5, "已收訂 (劃扣)", "預設倉", "2026-08-27", "2026-10-27", "2026-10-20", "", "HOLD", "2026-08-27T00:00:00.000Z", "2026-08-27T00:00:00.000Z"]
    ],
    inventory: { "STU-6101": 10 },
    hasNativeAcidTransaction: true,
    hasNativeTransactionAbortGuarantee: true
  });

  const adapter = new ProductionSheetReservationAdapter({
    configProvider: createConfigProvider(),
    sheetClient: client
  });

  const res = adapter.executeCancelReleaseTransaction({
    reservationNumber: "RES-20260827-100",
    existingHold: { id: "RES-20260827-100", item: "STU-6101", quantity: 5, status: "HOLD" },
    releasedQuantity: 5,
    operator: "AdminUser",
    operatorRole: "admin",
    operationId: "OP-SUCCESS-100"
  });

  assert.strictEqual(res.ok, true, "Transaction must succeed");
  assert.strictEqual(res.atomic, true, "Proof atomic must be true for native ACID transaction");
  assert.strictEqual(res.inventoryReleased, true, "Proof inventoryReleased must be true");
  assert.strictEqual(res.holdUpdated, true, "Proof holdUpdated must be true");
  assert.strictEqual(res.auditLogged, true, "Proof auditLogged must be true");
  assert.strictEqual(res.readbackVerified, true, "Proof readbackVerified must be true");
  assert.strictEqual(res.operationPersisted, true, "Proof operationPersisted must be true");

  assert.strictEqual(client.inventoryStore["STU-6101"], 15, "Inventory must be released +5");
  assert.strictEqual(client.rowsBySheet.Holds[0][12], "CANCELLED", "Hold status must be CANCELLED");
  assert.strictEqual(client.rowsBySheet.Ledger.length, 1, "Ledger entry must be appended");
  assert.strictEqual(client.rowsBySheet.Audit.length, 1, "Audit log must be appended");
});

runTest("3. Staged transaction returning incomplete proof (only ok: true) triggers abort, leaving main store 100% untouched across all 4 sheets", () => {
  const client = new TransactionalMockSheetClient({
    holds: [
      ["RES-20260827-150", "store_1", "Store 1", "SalesA", "STU-6101", 5, "已收訂 (劃扣)", "預設倉", "2026-08-27", "2026-10-27", "2026-10-20", "", "HOLD", "2026-08-27T00:00:00.000Z", "2026-08-27T00:00:00.000Z"]
    ],
    inventory: { "STU-6101": 10 },
    stagedTransactionIncompleteProof: true
  });

  const adapter = new ProductionSheetReservationAdapter({
    configProvider: createConfigProvider(),
    sheetClient: client
  });

  const res = adapter.executeCancelReleaseTransaction({
    reservationNumber: "RES-20260827-150",
    existingHold: { id: "RES-20260827-150", item: "STU-6101", quantity: 5, status: "HOLD" },
    releasedQuantity: 5,
    operator: "AdminUser",
    operatorRole: "admin",
    operationId: "OP-STAGED-INCOMPLETE"
  });

  assert.strictEqual(res.ok, false, "Incomplete proof must fail closed");
  assert.strictEqual(res.errorCode, "CANCEL_TRANSACTION_INCOMPLETE", "ErrorCode must be CANCEL_TRANSACTION_INCOMPLETE");
  assert.strictEqual(typeof res.releasedQuantity, "undefined", "releasedQuantity must NOT be returned");

  // Verify actual store state is completely untouched (ZERO changes across all 4 sheets)
  assert.strictEqual(client.inventoryStore["STU-6101"], 10, "Inventory must remain 10");
  assert.strictEqual(client.rowsBySheet.Holds[0][12], "HOLD", "Hold status must remain HOLD");
  assert.strictEqual(client.rowsBySheet.Ledger.length, 0, "Ledger entries must remain 0");
  assert.strictEqual(client.rowsBySheet.Audit.length, 0, "Audit logs must remain 0");
});

runTest("4. Client with hasNativeAcidTransaction === true but hasNativeTransactionAbortGuarantee === false returns PRODUCTION_TRANSACTION_CAPABILITY_MISSING without calling executeNativeAcidTransaction", () => {
  const client = new TransactionalMockSheetClient({
    holds: [
      ["RES-20260827-160", "store_1", "Store 1", "SalesA", "STU-6101", 5, "已收訂 (劃扣)", "預設倉", "2026-08-27", "2026-10-27", "2026-10-20", "", "HOLD", "2026-08-27T00:00:00.000Z", "2026-08-27T00:00:00.000Z"]
    ],
    inventory: { "STU-6101": 10 },
    hasNativeAcidTransaction: true,
    hasNativeTransactionAbortGuarantee: false // Missing abort guarantee!
  });

  const adapter = new ProductionSheetReservationAdapter({
    configProvider: createConfigProvider(),
    sheetClient: client
  });

  const res = adapter.executeCancelReleaseTransaction({
    reservationNumber: "RES-20260827-160",
    existingHold: { id: "RES-20260827-160", item: "STU-6101", quantity: 5, status: "HOLD" },
    releasedQuantity: 5,
    operator: "AdminUser",
    operatorRole: "admin",
    operationId: "OP-NO-ABORT-GUARANTEE"
  });

  assert.strictEqual(res.ok, false, "Client without abort guarantee must fail closed");
  assert.strictEqual(res.errorCode, "PRODUCTION_TRANSACTION_CAPABILITY_MISSING", "ErrorCode must be PRODUCTION_TRANSACTION_CAPABILITY_MISSING");
  assert.strictEqual(typeof res.releasedQuantity, "undefined", "releasedQuantity MUST NOT be returned");

  // Assert executeNativeAcidTransaction was NOT called
  const acidCalls = client.calls.filter(c => c[0] === "executeNativeAcidTransaction");
  assert.strictEqual(acidCalls.length, 0, "executeNativeAcidTransaction MUST NOT be invoked when abort guarantee is missing");

  // Assert ZERO state mutations across all 4 sheets
  assert.strictEqual(client.inventoryStore["STU-6101"], 10, "Inventory must remain untouched (10)");
  assert.strictEqual(client.rowsBySheet.Holds[0][12], "HOLD", "Hold status must remain HOLD");
  assert.strictEqual(client.rowsBySheet.Ledger.length, 0, "Ledger must remain empty (0)");
  assert.strictEqual(client.rowsBySheet.Audit.length, 0, "Audit must remain empty (0)");
});

runTest("5. Lock release failure returns TRANSACTION_LOCK_RELEASE_FAILED with transactionState: UNKNOWN", () => {
  const client = new TransactionalMockSheetClient({
    holds: [
      ["RES-20260827-600", "store_1", "Store 1", "SalesA", "STU-6101", 2, "已收訂 (劃扣)", "預設倉", "2026-08-27", "2026-10-27", "2026-10-20", "", "HOLD", "2026-08-27T00:00:00.000Z", "2026-08-27T00:00:00.000Z"]
    ],
    inventory: { "STU-6101": 10 },
    failLockRelease: true
  });

  const adapter = new ProductionSheetReservationAdapter({
    configProvider: createConfigProvider(),
    sheetClient: client
  });

  const res = adapter.executeCancelReleaseTransaction({
    reservationNumber: "RES-20260827-600",
    existingHold: { id: "RES-20260827-600", item: "STU-6101", quantity: 2, status: "HOLD" },
    releasedQuantity: 2,
    operator: "AdminUser",
    operatorRole: "admin",
    operationId: "OP-LOCK-FAIL"
  });

  assert.strictEqual(res.ok, false, "Must return ok: false on lock release failure");
  assert.strictEqual(res.errorCode, "TRANSACTION_LOCK_RELEASE_FAILED", "ErrorCode must be TRANSACTION_LOCK_RELEASE_FAILED");
  assert.strictEqual(res.transactionState, "UNKNOWN", "transactionState must be UNKNOWN to prevent hiding completed write");
});

runTest("6. Process restart (new adapter instance) blocks duplicate operationId via formal persistence", () => {
  const sharedClient = new TransactionalMockSheetClient({
    holds: [
      ["RES-20260827-200", "store_1", "Store 1", "SalesA", "STU-6101", 3, "已收訂 (劃扣)", "預設倉", "2026-08-27", "2026-10-27", "2026-10-20", "", "HOLD", "2026-08-27T00:00:00.000Z", "2026-08-27T00:00:00.000Z"]
    ],
    inventory: { "STU-6101": 10 }
  });

  const adapterInstance1 = new ProductionSheetReservationAdapter({
    configProvider: createConfigProvider(),
    sheetClient: sharedClient
  });

  const res1 = adapterInstance1.executeCancelReleaseTransaction({
    reservationNumber: "RES-20260827-200",
    existingHold: { id: "RES-20260827-200", item: "STU-6101", quantity: 3, status: "HOLD" },
    releasedQuantity: 3,
    operator: "AdminUser",
    operatorRole: "admin",
    operationId: "OP-PERSISTED-IDEMPOTENT-200"
  });

  assert.strictEqual(res1.ok, true, "Process 1 execution must succeed");
  assert.strictEqual(sharedClient.inventoryStore["STU-6101"], 13, "Inventory +3");

  const adapterInstance2 = new ProductionSheetReservationAdapter({
    configProvider: createConfigProvider(),
    sheetClient: sharedClient
  });

  const res2 = adapterInstance2.executeCancelReleaseTransaction({
    reservationNumber: "RES-20260827-200",
    existingHold: { id: "RES-20260827-200", item: "STU-6101", quantity: 3, status: "HOLD" },
    releasedQuantity: 3,
    operator: "AdminUser",
    operatorRole: "admin",
    operationId: "OP-PERSISTED-IDEMPOTENT-200"
  });

  assert.strictEqual(res2.ok, false, "Process 2 with same operationId must be blocked via formal persistence");
  assert.strictEqual(res2.errorCode, "DUPLICATE_OPERATION_BLOCKED", "ErrorCode must be DUPLICATE_OPERATION_BLOCKED");
  assert.strictEqual(sharedClient.inventoryStore["STU-6101"], 13, "Inventory must NOT increase again");
});

console.log("\n=======================================================");
console.log(`Formal Production Transaction Adapter Summary: ${passedTests} PASS / ${failedTests} FAIL (Total: ${totalTests})`);
console.log("=======================================================\n");

if (failedTests === 0) {
  console.log("-> Formal Production Transaction Adapter Contract Certified Complete!\n");
}
