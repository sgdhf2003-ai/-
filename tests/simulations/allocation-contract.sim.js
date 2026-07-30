/**
 * Simulation Test: Allocation Domain Contracts (Pack 1A)
 * Validates domain model schema enforcement, validation rules, and error handling.
 */

const assert = require('assert');
const {
  validateTenantContext,
  validateAllocationDraft,
  validateAllocationDraftItem,
  validateInventorySnapshot,
  validateInventoryLot,
  validateAllocationSuggestion,
  validateAllocationWarning,
  validateAuditEvent,
  validateSyncRequest,
  validateSyncResult,
  DRAFT_STATUSES
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-contract: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-contract: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. TenantContext Validation
runTest('valid TenantContext produces clean plain object', () => {
  const ctx = validateTenantContext({
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jingyang-taiwan'
  });
  assert.strictEqual(ctx.tenantId, 'tenant-jy-001');
  assert.strictEqual(ctx.companyId, 'comp-jingyang-taiwan');
  assert.strictEqual(ctx.timezone, 'Asia/Taipei'); // default
  assert.strictEqual(ctx.locale, 'zh-TW'); // default
});

runTest('rejects TenantContext with missing tenantId', () => {
  assert.throws(() => {
    validateTenantContext({ companyId: 'comp-jingyang-taiwan' });
  }, /tenantId is required/);
});

runTest('rejects TenantContext with missing companyId', () => {
  assert.throws(() => {
    validateTenantContext({ tenantId: 'tenant-jy-001' });
  }, /companyId is required/);
});

// 2. AllocationDraftItem Validation
runTest('valid AllocationDraftItem passes validation', () => {
  const item = validateAllocationDraftItem({
    itemId: 'item_001',
    productCode: 'EQA-6522',
    requestedQuantity: 10,
    parsedConfidence: 0.95,
    rawOcrText: 'EQA-6522 * 10'
  });
  assert.strictEqual(item.productCode, 'EQA-6522');
  assert.strictEqual(item.requestedQuantity, 10);
});

runTest('rejects AllocationDraftItem with zero quantity', () => {
  assert.throws(() => {
    validateAllocationDraftItem({
      itemId: 'item_001',
      productCode: 'EQA-6522',
      requestedQuantity: 0
    });
  }, /requestedQuantity must be greater than 0/);
});

runTest('rejects AllocationDraftItem with negative quantity', () => {
  assert.throws(() => {
    validateAllocationDraftItem({
      itemId: 'item_001',
      productCode: 'EQA-6522',
      requestedQuantity: -5
    });
  }, /requestedQuantity must be greater than 0/);
});

// 3. AllocationDraft Validation
runTest('valid AllocationDraft with defaults passes validation', () => {
  const draft = validateAllocationDraft({
    draftId: 'draft_abc123',
    tenantContext: { tenantId: 'tenant-jy-001', companyId: 'comp-jy' },
    status: DRAFT_STATUSES.DRAFT,
    sourceSystem: 'LINE_BOT_OCR',
    sourceDraftId: 'ocr_9921',
    idempotencyKey: 'idem_key_001',
    items: [
      { itemId: 'item_1', productCode: 'EQA-6522', requestedQuantity: 5 }
    ]
  });
  assert.strictEqual(draft.draftId, 'draft_abc123');
  assert.strictEqual(draft.status, 'DRAFT');
  assert.strictEqual(draft.items.length, 1);
});

runTest('rejects AllocationDraft with invalid status', () => {
  assert.throws(() => {
    validateAllocationDraft({
      draftId: 'draft_abc123',
      tenantContext: { tenantId: 'tenant-jy-001', companyId: 'comp-jy' },
      status: 'UNKNOWN_STATUS_VALUE'
    });
  }, /invalid status/i);
});

// 4. InventorySnapshot & Lot Validation
runTest('valid InventoryLot passes validation', () => {
  const lot = validateInventoryLot({
    batchNumber: '7J25',
    availableQuantity: 15
  });
  assert.strictEqual(lot.batchNumber, '7J25');
  assert.strictEqual(lot.availableQuantity, 15);
});

runTest('rejects InventoryLot with negative availableQuantity', () => {
  assert.throws(() => {
    validateInventoryLot({
      batchNumber: '7J25',
      availableQuantity: -10
    });
  }, /availableQuantity cannot be negative/);
});

runTest('valid InventorySnapshot passes validation', () => {
  const snap = validateInventorySnapshot({
    snapshotId: 'snap_001',
    productCode: 'EQA-6522',
    warehouses: [
      {
        warehouseName: '林口倉',
        batches: [{ batchNumber: '7J25', availableQuantity: 15 }]
      }
    ]
  });
  assert.strictEqual(snap.productCode, 'EQA-6522');
  assert.strictEqual(snap.warehouses.length, 1);
});

// 5. Suggestion & Warning Validation
runTest('valid AllocationSuggestion and AllocationWarning pass validation', () => {
  const warning = validateAllocationWarning({
    warningCode: 'BATCH_MIXING_REQUIRED',
    severity: 'WARNING',
    message: 'Mixing required'
  });
  assert.strictEqual(warning.warningCode, 'BATCH_MIXING_REQUIRED');

  const suggestion = validateAllocationSuggestion({
    suggestionId: 'sug_001',
    draftId: 'draft_abc123',
    suggestions: [
      { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', allocatedQuantity: 10 }
    ],
    warnings: [warning],
    rationale: 'Sufficient single warehouse inventory'
  });
  assert.strictEqual(suggestion.suggestionId, 'sug_001');
  assert.strictEqual(suggestion.warnings.length, 1);
});

// 6. AuditEvent Validation
runTest('valid AuditEvent passes validation', () => {
  const evt = validateAuditEvent({
    eventId: 'evt_001',
    operator: 'clerk01',
    action: 'CREATE_DRAFT',
    draftId: 'draft_abc123',
    details: 'Draft created'
  });
  assert.strictEqual(evt.eventId, 'evt_001');
  assert.strictEqual(evt.action, 'CREATE_DRAFT');
});

// 7. SyncRequest & SyncResult Validation
runTest('valid SyncRequest and SyncResult pass validation', () => {
  const req = validateSyncRequest({
    requestId: 'sync_001',
    draftId: 'draft_abc123',
    idempotencyKey: 'idem_key_001',
    reservationData: { item: 'EQA-6522', quantity: 10 }
  });
  assert.strictEqual(req.requestId, 'sync_001');

  const res = validateSyncResult({
    success: true,
    reservationId: 'res_001',
    syncedAt: new Date().toISOString()
  });
  assert.strictEqual(res.success, true);
});

console.log(`\nAllocation Domain Contracts Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
