/**
 * Simulation Test: Gateway & Provider Read-Only Sheet Snapshot Integration (Pack 2C)
 */

const assert = require('assert');
const {
  AllocationGateway,
  SimulationProvider,
  MockSheetInventoryAdapter
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-provider-snapshot: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-provider-snapshot: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Single Warehouse Suggestion via Mock Sheet Adapter
runTest('Gateway + SimulationProvider + MockSheetAdapter generates Single Warehouse allocation suggestion', () => {
  const adapter = new MockSheetInventoryAdapter();
  adapter.setRawSheetData('EQA-6522', [
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', availableQuantity: 20 }
  ]);

  const provider = new SimulationProvider({ inventoryAdapter: adapter });
  const gw = new AllocationGateway({ providerMap: { SIMULATION: provider } });

  const draftRes = gw.createDraft({
    contractVersion: 'v1.0.0',
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jy',
    idempotencyKey: 'idem_c2c_1',
    rawText: 'EQA-6522 * 10'
  });

  const analyzeRes = gw.analyzeAllocation(draftRes.draftId, 'idem_c2c_1_an');
  assert.strictEqual(analyzeRes.success, true);
  assert.ok(analyzeRes.suggestion);
  assert.strictEqual(analyzeRes.suggestion.suggestions[0].batchNumber, '7J25');
  assert.strictEqual(analyzeRes.suggestion.suggestions[0].allocatedQuantity, 10);
});

// 2. Insufficient Stock Warning via Sheet Snapshot
runTest('Insufficient single batch in sheet snapshot triggers BATCH_MIXING_REQUIRED warning', () => {
  const adapter = new MockSheetInventoryAdapter();
  adapter.setRawSheetData('EQA-MIX', [
    { productCode: 'EQA-MIX', warehouseName: '林口倉', batchNumber: 'B1', availableQuantity: 10 },
    { productCode: 'EQA-MIX', warehouseName: '林口倉', batchNumber: 'B2', availableQuantity: 10 }
  ]);

  const provider = new SimulationProvider({ inventoryAdapter: adapter });
  const gw = new AllocationGateway({ providerMap: { SIMULATION: provider } });

  const draftRes = gw.createDraft({
    contractVersion: 'v1.0.0',
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jy',
    idempotencyKey: 'idem_c2c_2',
    rawText: 'EQA-MIX * 15'
  });

  const analyzeRes = gw.analyzeAllocation(draftRes.draftId, 'idem_c2c_2_an');
  assert.strictEqual(analyzeRes.success, true);
  assert.ok(analyzeRes.suggestion.warnings.some(w => w.warningCode === 'BATCH_MIXING_REQUIRED'));
});

// 3. Fail-Closed on Missing Adapter or Snapshot
runTest('Missing or empty adapter triggers fail-closed INSUFFICIENT_STOCK warning', () => {
  const provider = new SimulationProvider(); // No adapter
  const gw = new AllocationGateway({ providerMap: { SIMULATION: provider } });

  const draftRes = gw.createDraft({
    contractVersion: 'v1.0.0',
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jy',
    idempotencyKey: 'idem_c2c_3',
    rawText: 'EQA-NONE * 10'
  });

  const analyzeRes = gw.analyzeAllocation(draftRes.draftId, 'idem_c2c_3_an');
  assert.strictEqual(analyzeRes.success, true);
  assert.ok(analyzeRes.suggestion.warnings.some(w => w.warningCode === 'INSUFFICIENT_STOCK'));
});

console.log(`\nAllocation Provider Snapshot Integration Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
