/**
 * Simulation Test: Allocation Rule Evaluator (Pack 1C)
 */

const assert = require('assert');
const { evaluateAllocationRules, OCR_CONFIDENCE_THRESHOLD } = require('../../allocation-assistant/index');

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

console.log(`\nAllocation Rules Engine Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
