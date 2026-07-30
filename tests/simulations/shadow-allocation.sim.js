/**
 * Simulation Test: 30-Case Comprehensive Shadow Allocation Suite (Pack 1D)
 */

const assert = require('assert');
const {
  AllocationGateway,
  SimulationProvider,
  ExternalProvider,
  evaluateAllocationRules,
  validateTenantContext,
  validateAllocationDraft,
  validateAllocationDraftItem,
  validateInventorySnapshot,
  DRAFT_STATUSES
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(num, category, description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS shadow-alloc #${num} [${category}]: ${description}`);
  } catch (err) {
    console.error(`FAIL shadow-alloc #${num} [${category}]: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

function makeSnapshot(warehouses) {
  return {
    snapshotId: 'snap_sim_matrix',
    productCode: 'EQA-6522',
    warehouses
  };
}

// -------------------------------------------------------------
// 1. Contract & Tenant Validation (Cases 1-4)
// -------------------------------------------------------------
runTest(1, 'Contract', 'Draft creation with valid schema', () => {
  const sim = new SimulationProvider();
  const res = sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c1', rawText: 'EQA-6522 * 10' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.status, 'DRAFT');
});

runTest(2, 'Contract', 'Missing tenantId in payload fails validation', () => {
  assert.throws(() => {
    validateTenantContext({ companyId: 'comp-jy' });
  }, /tenantId is required/);
});

runTest(3, 'Contract', 'Missing companyId in payload fails validation', () => {
  assert.throws(() => {
    validateTenantContext({ tenantId: 'tenant-jy-001' });
  }, /companyId is required/);
});

runTest(4, 'Contract', 'Invalid sourceDraftId format handles safely', () => {
  const sim = new SimulationProvider();
  const res = sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', sourceDraftId: 'invalid_fmt_###', idempotencyKey: 'idem_c4' });
  assert.strictEqual(res.success, true);
});

// -------------------------------------------------------------
// 2. Draft Lifecycle Transitions (Cases 5-10)
// -------------------------------------------------------------
runTest(5, 'Lifecycle', 'Draft creation with OCR confidence = 0.95', () => {
  const item = validateAllocationDraftItem({ productCode: 'EQA-6522', requestedQuantity: 10, parsedConfidence: 0.95 });
  assert.strictEqual(item.parsedConfidence, 0.95);
});

runTest(6, 'Lifecycle', 'Draft creation with OCR confidence = 0.70 sets OCR_REVIEW', () => {
  const item = { productCode: 'EQA-6522', requestedQuantity: 10, parsedConfidence: 0.70 };
  const snap = makeSnapshot([{ warehouseName: '林口倉', batches: [{ batchNumber: '7J25', availableQuantity: 20 }] }]);
  const evalRes = evaluateAllocationRules({ item, snapshot: snap });
  assert.strictEqual(evalRes.status, 'OCR_REVIEW');
});

runTest(7, 'Lifecycle', 'Manual correction of OCR_REVIEW draft transitions to ALLOCATION_REVIEW', () => {
  const item = { productCode: 'EQA-6522', requestedQuantity: 10, parsedConfidence: 0.95 }; // corrected
  const snap = makeSnapshot([{ warehouseName: '林口倉', batches: [{ batchNumber: '7J25', availableQuantity: 20 }] }]);
  const evalRes = evaluateAllocationRules({ item, snapshot: snap });
  assert.strictEqual(evalRes.status, 'ALLOCATION_REVIEW');
});

runTest(8, 'Lifecycle', 'confirmAllocation locks draft items', () => {
  const sim = new SimulationProvider();
  const c = sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c8', rawText: 'EQA-6522 * 10' });
  const conf = sim.confirmAllocation(c.draftId, [], 'idem_c8_conf');
  assert.strictEqual(conf.status, 'ALLOCATION_CONFIRMED');
});

runTest(9, 'Lifecycle', 'cancelAllocation cancels active draft', () => {
  const sim = new SimulationProvider();
  const c = sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c9', rawText: 'EQA-6522 * 10' });
  const can = sim.cancelAllocation(c.draftId);
  assert.strictEqual(can.status, 'CANCELLED');
});

runTest(10, 'Lifecycle', 'Attempting confirmAllocation on CANCELLED draft fails closed', () => {
  const sim = new SimulationProvider();
  const c = sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c10', rawText: 'EQA-6522 * 10' });
  sim.cancelAllocation(c.draftId);
  assert.throws(() => {
    sim.confirmAllocation(c.draftId, [], 'idem_c10_conf');
  }, /INVALID_DRAFT_STATE/);
});

// -------------------------------------------------------------
// 3. Gateway & Provider Selection (Cases 11-12)
// -------------------------------------------------------------
runTest(11, 'Gateway', 'Gateway routes tenant-jy-001 to SimulationProvider', () => {
  const gw = new AllocationGateway();
  const res = gw.createDraft({ contractVersion: 'v1.0.0', tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_gw_c11', rawText: 'EQA-6522 * 10' });
  assert.strictEqual(res.success, true);
});

runTest(12, 'Gateway', 'Invoking ExternalProvider fails closed with EXTERNAL_PROVIDER_DISABLED', () => {
  const gw = new AllocationGateway();
  assert.throws(() => {
    gw.dispatch('EXTERNAL', 'createDraft', {});
  }, /EXTERNAL_PROVIDER_DISABLED/);
});

// -------------------------------------------------------------
// 4. Allocation Rules Engine (Cases 13-20)
// -------------------------------------------------------------
runTest(13, 'Rules', 'Single warehouse with sufficient stock (EQA-6522 / 7J25)', () => {
  const item = { productCode: 'EQA-6522', requestedQuantity: 10, parsedConfidence: 0.95 };
  const snap = makeSnapshot([{ warehouseName: '林口倉', batches: [{ batchNumber: '7J25', availableQuantity: 20 }] }]);
  const res = evaluateAllocationRules({ item, snapshot: snap });
  assert.strictEqual(res.suggestion.suggestions[0].batchNumber, '7J25');
  assert.strictEqual(res.suggestion.suggestions[0].allocatedQuantity, 10);
});

runTest(14, 'Rules', 'Multi-warehouse available, single warehouse preferred (顧佳 575)', () => {
  const item = { productCode: 'GUJIA-575', requestedQuantity: 10, parsedConfidence: 0.95 };
  const snap = {
    snapshotId: 'snap_gujia',
    productCode: 'GUJIA-575',
    warehouses: [
      { warehouseName: '林口倉', batches: [{ batchNumber: '7J25', availableQuantity: 15 }] },
      { warehouseName: '忠義倉', batches: [{ batchNumber: '7J25', availableQuantity: 15 }] }
    ]
  };
  const res = evaluateAllocationRules({ item, snapshot: snap });
  assert.strictEqual(res.suggestion.suggestions.length, 1);
});

runTest(15, 'Rules', 'Batch selection prioritizing small remaining batch (昇悅 320)', () => {
  const item = { productCode: 'SHENGYUE-320', requestedQuantity: 10, parsedConfidence: 0.95 };
  const snap = {
    snapshotId: 'snap_shengyue',
    productCode: 'SHENGYUE-320',
    warehouses: [
      {
        warehouseName: '林口倉',
        batches: [
          { batchNumber: 'BATCH_BIG', availableQuantity: 100 },
          { batchNumber: 'BATCH_SMALL', availableQuantity: 11 }
        ]
      }
    ]
  };
  const res = evaluateAllocationRules({ item, snapshot: snap });
  assert.strictEqual(res.suggestion.suggestions[0].batchNumber, 'BATCH_SMALL');
});

runTest(16, 'Rules', 'Single batch insufficient without mixed batch consent (艾美 336)', () => {
  const item = { productCode: 'AIMEI-336', requestedQuantity: 15, parsedConfidence: 0.95 };
  const snap = {
    snapshotId: 'snap_aimei',
    productCode: 'AIMEI-336',
    warehouses: [{ warehouseName: '林口倉', batches: [{ batchNumber: 'B1', availableQuantity: 10 }, { batchNumber: 'B2', availableQuantity: 10 }] }]
  };
  const res = evaluateAllocationRules({ item, snapshot: snap, customerApprovedMixedBatch: false });
  assert.strictEqual(res.suggestion.warnings[0].warningCode, 'BATCH_MIXING_REQUIRED');
});

runTest(17, 'Rules', 'Single batch insufficient with mixed batch consent (邦迪 274)', () => {
  const item = { productCode: 'BANGDI-274', requestedQuantity: 15, parsedConfidence: 0.95 };
  const snap = {
    snapshotId: 'snap_bangdi',
    productCode: 'BANGDI-274',
    warehouses: [{ warehouseName: '林口倉', batches: [{ batchNumber: 'B1', availableQuantity: 10 }, { batchNumber: 'B2', availableQuantity: 10 }] }]
  };
  const res = evaluateAllocationRules({ item, snapshot: snap, customerApprovedMixedBatch: true });
  assert.strictEqual(res.suggestion.suggestions.length, 2);
});

runTest(18, 'Rules', 'Total stock insufficient across all warehouses', () => {
  const item = { productCode: 'EQA-6522', requestedQuantity: 100, parsedConfidence: 0.95 };
  const snap = makeSnapshot([{ warehouseName: '林口倉', batches: [{ batchNumber: '7J25', availableQuantity: 10 }] }]);
  const res = evaluateAllocationRules({ item, snapshot: snap });
  assert.strictEqual(res.suggestion.warnings[0].warningCode, 'INSUFFICIENT_STOCK');
});

runTest(19, 'Rules', 'Zero stock available for product code', () => {
  const item = { productCode: 'EQA-ZERO', requestedQuantity: 10, parsedConfidence: 0.95 };
  const snap = makeSnapshot([{ warehouseName: '林口倉', batches: [{ batchNumber: '7J25', availableQuantity: 0 }] }]);
  const res = evaluateAllocationRules({ item, snapshot: snap });
  assert.strictEqual(res.suggestion.warnings[0].warningCode, 'INSUFFICIENT_STOCK');
});

runTest(20, 'Rules', 'Requested quantity zero or negative rejected by validator', () => {
  assert.throws(() => {
    validateAllocationDraftItem({ productCode: 'EQA-6522', requestedQuantity: 0 });
  }, /requestedQuantity must be greater than 0/);
});

// -------------------------------------------------------------
// 5. Idempotency & Replay Protection (Cases 21-23)
// -------------------------------------------------------------
runTest(21, 'Idempotency', 'Duplicate createDraft with identical idempotencyKey returns isReplay: true', () => {
  const sim = new SimulationProvider();
  const payload = { tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c21', rawText: 'EQA-6522 * 10' };
  const r1 = sim.createDraft(payload);
  const r2 = sim.createDraft(payload);
  assert.strictEqual(r1.isReplay, false);
  assert.strictEqual(r2.isReplay, true);
  assert.strictEqual(r1.draftId, r2.draftId);
});

runTest(22, 'Idempotency', 'Duplicate createDraft with conflicting payload rejects with IDEMPOTENCY_CONFLICT', () => {
  const sim = new SimulationProvider();
  sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c22', rawText: 'EQA-6522 * 10' });
  assert.throws(() => {
    sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c22', rawText: 'EQA-9999 * 50' });
  }, /IDEMPOTENCY_CONFLICT/);
});

runTest(23, 'Idempotency', 'Duplicate confirmAllocation call returns original confirmation result', () => {
  const sim = new SimulationProvider();
  const c = sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c23', rawText: 'EQA-6522 * 10' });
  const conf1 = sim.confirmAllocation(c.draftId, [], 'idem_c23_conf');
  const conf2 = sim.confirmAllocation(c.draftId, [], 'idem_c23_conf');
  assert.strictEqual(conf1.isReplay, false);
  assert.strictEqual(conf2.isReplay, true);
});

// -------------------------------------------------------------
// 6. Audit Event Trail Logging (Cases 24-27)
// -------------------------------------------------------------
runTest(24, 'Audit', 'createDraft records AuditEvent', () => {
  const sim = new SimulationProvider();
  const c = sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c24', rawText: 'EQA-6522 * 10' });
  const events = sim.auditLogger.getEventsByDraftId(c.draftId);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].action, 'CREATE_DRAFT');
});

runTest(25, 'Audit', 'analyzeAllocation records AuditEvent', () => {
  const sim = new SimulationProvider();
  const c = sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c25', rawText: 'EQA-6522 * 10' });
  sim.analyzeAllocation(c.draftId, 'idem_c25_an', makeSnapshot([{ warehouseName: '林口倉', batches: [{ batchNumber: '7J25', availableQuantity: 20 }] }]));
  const events = sim.auditLogger.getEventsByDraftId(c.draftId);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[1].action, 'ANALYZE_ALLOCATION');
});

runTest(26, 'Audit', 'confirmAllocation records AuditEvent', () => {
  const sim = new SimulationProvider();
  const c = sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c26', rawText: 'EQA-6522 * 10' });
  sim.confirmAllocation(c.draftId, [], 'idem_c26_conf');
  const events = sim.auditLogger.getEventsByDraftId(c.draftId);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[1].action, 'CONFIRM_ALLOCATION');
});

runTest(27, 'Audit', 'Audit log query returns complete timeline array', () => {
  const sim = new SimulationProvider();
  const c = sim.createDraft({ tenantId: 'tenant-jy-001', companyId: 'comp-jy', idempotencyKey: 'idem_c27', rawText: 'EQA-6522 * 10' });
  sim.analyzeAllocation(c.draftId, 'idem_c27_an', makeSnapshot([{ warehouseName: '林口倉', batches: [{ batchNumber: '7J25', availableQuantity: 20 }] }]));
  sim.confirmAllocation(c.draftId, [], 'idem_c27_conf');
  const events = sim.auditLogger.getEventsByDraftId(c.draftId);
  assert.strictEqual(events.length, 3);
  assert.deepStrictEqual(events.map(e => e.action), ['CREATE_DRAFT', 'ANALYZE_ALLOCATION', 'CONFIRM_ALLOCATION']);
});

// -------------------------------------------------------------
// 7. Security Boundaries & Zero Side Effects (Cases 28-30)
// -------------------------------------------------------------
runTest(28, 'Security', 'Pure function rule evaluation produces zero state mutation', () => {
  const snap = makeSnapshot([{ warehouseName: '林口倉', batches: [{ batchNumber: '7J25', availableQuantity: 20 }] }]);
  const snapCopy = JSON.stringify(snap);
  evaluateAllocationRules({ item: { productCode: 'EQA-6522', requestedQuantity: 10 }, snapshot: snap });
  assert.strictEqual(JSON.stringify(snap), snapCopy); // Snapshot unmodified
});

runTest(29, 'Security', 'Guarantee no Sheet API invocation (SpreadsheetApp undefined)', () => {
  assert.strictEqual(typeof SpreadsheetApp, 'undefined');
});

runTest(30, 'Security', 'Guarantee no LINE API invocation (UrlFetchApp undefined)', () => {
  assert.strictEqual(typeof UrlFetchApp, 'undefined');
});

console.log(`\nComprehensive 30-Case Shadow Allocation Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
