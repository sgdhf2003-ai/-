/**
 * Simulation Test: Allocation Rule Evaluator (Pack 1C)
 */

const assert = require('assert');
const { evaluateAllocationRules, OCR_CONFIDENCE_THRESHOLD, evaluateUserPermission, sanitizeReadbackAuditRecord } = require('../../allocation-assistant/index');



let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-rules: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-rules: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// Mock inventory data helper
function createInventorySnapshot(warehouses) {
  return {
    snapshotId: 'snap_test_001',
    productCode: 'EQA-6522',
    timestamp: new Date().toISOString(),
    warehouses
  };
}

// 1. Single Sufficient Batch Selection
runTest('single batch with sufficient stock is selected', () => {
  const item = { itemId: 'item_1', productCode: 'EQA-6522', requestedQuantity: 10, parsedConfidence: 0.95 };
  const snapshot = createInventorySnapshot([
    {
      warehouseName: '林口倉',
      batches: [{ batchNumber: '7J25', availableQuantity: 20 }]
    }
  ]);

  const res = evaluateAllocationRules({ item, snapshot });
  assert.strictEqual(res.status, 'ALLOCATION_REVIEW');
  assert.strictEqual(res.suggestion.suggestions.length, 1);
  assert.strictEqual(res.suggestion.suggestions[0].batchNumber, '7J25');
  assert.strictEqual(res.suggestion.suggestions[0].allocatedQuantity, 10);
  assert.strictEqual(res.suggestion.warnings.length, 0);
});

// 2. Small Remaining Batch Priority
runTest('multiple sufficient batches choose batch with smallest remaining stock', () => {
  const item = { itemId: 'item_1', productCode: 'EQA-6522', requestedQuantity: 10, parsedConfidence: 0.95 };
  const snapshot = createInventorySnapshot([
    {
      warehouseName: '林口倉',
      batches: [
        { batchNumber: 'BATCH_LARGE', availableQuantity: 100 }, // remaining 90
        { batchNumber: 'BATCH_SMALL', availableQuantity: 12 }   // remaining 2
      ]
    }
  ]);

  const res = evaluateAllocationRules({ item, snapshot });
  assert.strictEqual(res.suggestion.suggestions[0].batchNumber, 'BATCH_SMALL');
  assert.strictEqual(res.suggestion.suggestions[0].allocatedQuantity, 10);
});

// 3. Batch Mixing Restrictions
runTest('insufficient single batch without mixed batch consent generates BATCH_MIXING_REQUIRED warning', () => {
  const item = { itemId: 'item_1', productCode: 'EQA-6522', requestedQuantity: 15, parsedConfidence: 0.95 };
  const snapshot = createInventorySnapshot([
    {
      warehouseName: '林口倉',
      batches: [
        { batchNumber: '7J25', availableQuantity: 10 },
        { batchNumber: '7K01', availableQuantity: 10 }
      ]
    }
  ]);

  const res = evaluateAllocationRules({ item, snapshot, customerApprovedMixedBatch: false });
  assert.strictEqual(res.suggestion.warnings.length, 1);
  assert.strictEqual(res.suggestion.warnings[0].warningCode, 'BATCH_MIXING_REQUIRED');
  assert.strictEqual(res.suggestion.suggestions.length, 0);
});

runTest('insufficient single batch with mixed batch consent produces mixed batch suggestion', () => {
  const item = { itemId: 'item_1', productCode: 'EQA-6522', requestedQuantity: 15, parsedConfidence: 0.95 };
  const snapshot = createInventorySnapshot([
    {
      warehouseName: '林口倉',
      batches: [
        { batchNumber: '7J25', availableQuantity: 10 },
        { batchNumber: '7K01', availableQuantity: 10 }
      ]
    }
  ]);

  const res = evaluateAllocationRules({ item, snapshot, customerApprovedMixedBatch: true });
  assert.strictEqual(res.suggestion.suggestions.length, 2);
  const totalAllocated = res.suggestion.suggestions.reduce((sum, i) => sum + i.allocatedQuantity, 0);
  assert.strictEqual(totalAllocated, 15);
});

// 4. Low OCR Confidence Filter
runTest('OCR confidence below 0.85 transitions draft to OCR_REVIEW and halts allocation', () => {
  assert.strictEqual(OCR_CONFIDENCE_THRESHOLD, 0.85);

  const item = { itemId: 'item_1', productCode: 'EQA-6522', requestedQuantity: 10, parsedConfidence: 0.70 };
  const snapshot = createInventorySnapshot([
    {
      warehouseName: '林口倉',
      batches: [{ batchNumber: '7J25', availableQuantity: 20 }]
    }
  ]);

  const res = evaluateAllocationRules({ item, snapshot });
  assert.strictEqual(res.status, 'OCR_REVIEW');
  assert.strictEqual(res.suggestion.suggestions.length, 0);
  assert.strictEqual(res.suggestion.warnings.length, 1);
  assert.strictEqual(res.suggestion.warnings[0].warningCode, 'LOW_OCR_CONFIDENCE');
});

// 5. Total Stock Deficit
runTest('total available stock less than requested quantity produces INSUFFICIENT_STOCK warning', () => {
  const item = { itemId: 'item_1', productCode: 'EQA-6522', requestedQuantity: 50, parsedConfidence: 0.95 };
  const snapshot = createInventorySnapshot([
    {
      warehouseName: '林口倉',
      batches: [{ batchNumber: '7J25', availableQuantity: 10 }]
    }
  ]);

  const res = evaluateAllocationRules({ item, snapshot });
  assert.strictEqual(res.suggestion.warnings.length, 1);
  assert.strictEqual(res.suggestion.warnings[0].warningCode, 'INSUFFICIENT_STOCK');
});

// 6. Role Permission Guard: Sales Role Write Denied
runTest('sales role attempting write action returns UNAUTHORIZED_ROLE deny code', () => {
  const perm = evaluateUserPermission('sales', 'upsertHold');
  assert.strictEqual(perm.allowed, false);
  assert.strictEqual(perm.errorCode, 'UNAUTHORIZED_ROLE');
});

// 7. Role Permission Guard: Retail Role Cancel Denied
runTest('retail role attempting cancelRelease returns UNAUTHORIZED_ROLE deny code', () => {
  const perm = evaluateUserPermission('retail', 'cancelRelease');
  assert.strictEqual(perm.allowed, false);
  assert.strictEqual(perm.errorCode, 'UNAUTHORIZED_ROLE');
});

// 8. Role Permission Guard: Assistant Role Cleanup Denied
runTest('assistant role attempting TEST_CLEANUP_DELETED returns ADMIN_ROLE_REQUIRED deny code', () => {
  const perm = evaluateUserPermission('assistant', 'upsertHold', 'TEST_CLEANUP_DELETED');
  assert.strictEqual(perm.allowed, false);
  assert.strictEqual(perm.errorCode, 'ADMIN_ROLE_REQUIRED');
});

// 9. Role Permission Guard: Admin Allowed
runTest('admin role allowed for write actions and cleanup status', () => {
  const permWrite = evaluateUserPermission('admin', 'upsertHold');
  assert.strictEqual(permWrite.allowed, true);

  const permCleanup = evaluateUserPermission('admin', 'upsertHold', 'TEST_CLEANUP_DELETED');
  assert.strictEqual(permCleanup.allowed, true);
});

// 10. Role Permission Guard: Boss Allowed
runTest('boss role allowed for write actions and cleanup status', () => {
  const permWrite = evaluateUserPermission('boss', 'fulfillHold');
  assert.strictEqual(permWrite.allowed, true);

  const permCleanup = evaluateUserPermission('boss', 'upsertHold', 'CORRECTED');
  assert.strictEqual(permCleanup.allowed, true);
});

// 11. Role Permission Guard: Invalid Session User Denied
runTest('null or unknown session role returns INVALID_SESSION_USER deny code', () => {
  const permNull = evaluateUserPermission(null, 'upsertHold');
  assert.strictEqual(permNull.allowed, false);
  assert.strictEqual(permNull.errorCode, 'INVALID_SESSION_USER');

  const permUnknown = evaluateUserPermission('unknown', 'fulfillHold');
  assert.strictEqual(permUnknown.allowed, false);
  assert.strictEqual(permUnknown.errorCode, 'INVALID_SESSION_USER');
});

// 12. Notification Boundary: Preserves Notification Bypassed Flag
runTest('permission check preserves notificationBypassed flag as true by default', () => {
  const perm = evaluateUserPermission('admin', 'upsertHold');
  assert.strictEqual(perm.allowed, true);
  assert.strictEqual(perm.notificationBypassed, true);
});

// 13. Readback Redaction: Assistant Role Keeps Operational Fields and Omits Sensitive Payload
runTest('assistant readback keeps operational fields and redacts internal logs and properties', () => {
  const rawAuditRecord = {
    reservationNumber: 'RES-20260801-001',
    status: 'ACTIVE',
    quantity: 10,
    remainingQuantity: 5,
    item: 'EQA-6522',
    storeId: 'STORE_001',
    storeName: '台北門市',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:05:00Z',
    actionSummary: 'PARTIAL_FULFILLMENT',
    internalLogs: 'DB_TRACE_LINE_99_KEY_EXPOSURE',
    rawAdapterPayload: { secretToken: '123' },
    systemProperties: { scriptId: 'abc' },
    supplierInternals: { cost: 500 },
    debugPayloads: { trace: 'stack' }
  };

  const res = sanitizeReadbackAuditRecord(rawAuditRecord, 'assistant');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.record.reservationNumber, 'RES-20260801-001');
  assert.strictEqual(res.record.status, 'ACTIVE');
  assert.strictEqual(res.record.quantity, 10);
  assert.strictEqual(res.record.remainingQuantity, 5);
  assert.strictEqual(res.record.item, 'EQA-6522');
  assert.strictEqual(res.record.storeId, 'STORE_001');
  assert.strictEqual(res.record.readbackRedacted, true);
  assert.strictEqual(res.record.internalLogs, undefined);
  assert.strictEqual(res.record.rawAdapterPayload, undefined);
  assert.strictEqual(res.record.systemProperties, undefined);
  assert.strictEqual(res.record.supplierInternals, undefined);
  assert.strictEqual(res.record.debugPayloads, undefined);
});

// 14. Readback Redaction: Sales / Retail Query Denied
runTest('sales or retail role readback query returns READBACK_QUERY_DENIED', () => {
  const rawAuditRecord = { reservationNumber: 'RES-20260801-001', status: 'ACTIVE' };

  const resSales = sanitizeReadbackAuditRecord(rawAuditRecord, 'sales');
  assert.strictEqual(resSales.ok, false);
  assert.strictEqual(resSales.errorCode, 'READBACK_QUERY_DENIED');

  const resRetail = sanitizeReadbackAuditRecord(rawAuditRecord, 'retail');
  assert.strictEqual(resRetail.ok, false);
  assert.strictEqual(resRetail.errorCode, 'READBACK_QUERY_DENIED');
});

// 15. Readback Redaction: Admin / Boss Full Audit Access
runTest('admin and boss roles receive full unredacted audit details', () => {
  const rawAuditRecord = {
    reservationNumber: 'RES-20260801-001',
    internalLogs: 'FULL_LOG_DETAIL',
    systemProperties: { scriptId: '1vRepq' }
  };

  const resAdmin = sanitizeReadbackAuditRecord(rawAuditRecord, 'admin');
  assert.strictEqual(resAdmin.ok, true);
  assert.strictEqual(resAdmin.record.internalLogs, 'FULL_LOG_DETAIL');

  const resBoss = sanitizeReadbackAuditRecord(rawAuditRecord, 'boss');
  assert.strictEqual(resBoss.ok, true);
  assert.strictEqual(resBoss.record.internalLogs, 'FULL_LOG_DETAIL');
});

// 16. Readback Redaction: Invalid / Missing Role Fails Closed
runTest('missing or invalid role returns INVALID_SESSION_USER', () => {
  const rawAuditRecord = { reservationNumber: 'RES-20260801-001' };

  const resNull = sanitizeReadbackAuditRecord(rawAuditRecord, null);
  assert.strictEqual(resNull.ok, false);
  assert.strictEqual(resNull.errorCode, 'INVALID_SESSION_USER');

  const resUnknown = sanitizeReadbackAuditRecord(rawAuditRecord, 'unknown');
  assert.strictEqual(resUnknown.ok, false);
  assert.strictEqual(resUnknown.errorCode, 'INVALID_SESSION_USER');
});

// 17. Readback Redaction: Non-Mutating Pure Function
runTest('sanitizeReadbackAuditRecord does not mutate the original record object', () => {
  const originalRecord = {
    reservationNumber: 'RES-20260801-001',
    internalLogs: 'DO_NOT_DELETE_FROM_ORIGINAL'
  };

  sanitizeReadbackAuditRecord(originalRecord, 'assistant');
  assert.strictEqual(originalRecord.internalLogs, 'DO_NOT_DELETE_FROM_ORIGINAL');
});

console.log(`\nAllocation Rules Engine Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
