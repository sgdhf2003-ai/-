/**
 * Simulation Test: MockSheetInventoryAdapter (Pack 2B)
 */

const assert = require('assert');
const {
  MockSheetInventoryAdapter,
  ReadOnlyInventoryAdapter
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-mock-sheet: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-mock-sheet: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Class Inheritance Check
runTest('MockSheetInventoryAdapter inherits from ReadOnlyInventoryAdapter', () => {
  const adapter = new MockSheetInventoryAdapter();
  assert.ok(adapter instanceof ReadOnlyInventoryAdapter);
});

// 2. Injected Multi-Warehouse Sheet Rows
runTest('MockSheetInventoryAdapter parses multi-warehouse sheet rows into single snapshot', () => {
  const adapter = new MockSheetInventoryAdapter();
  adapter.setRawSheetData('EQA-6522', [
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', availableQuantity: 20 },
    { productCode: 'EQA-6522', warehouseName: '忠義倉', batchNumber: '7K01', availableQuantity: 15 }
  ]);

  const snapshot = adapter.getInventorySnapshot('EQA-6522', { tenantId: 'tenant-jy-001', companyId: 'comp-jy' });
  assert.strictEqual(snapshot.productCode, 'EQA-6522');
  assert.strictEqual(snapshot.warehouses.length, 2);

  const linkouWh = snapshot.warehouses.find(w => w.warehouseName === '林口倉');
  const zhongyiWh = snapshot.warehouses.find(w => w.warehouseName === '忠義倉');
  assert.ok(linkouWh);
  assert.ok(zhongyiWh);
  assert.strictEqual(linkouWh.batches[0].availableQuantity, 20);
  assert.strictEqual(zhongyiWh.batches[0].availableQuantity, 15);
});

// 3. Empty / Header-Only Sheet Handling
runTest('empty sheet rows or header-only sheet produces snapshot with EMPTY_SHEET_DATA warning', () => {
  const adapter = new MockSheetInventoryAdapter();
  adapter.setRawSheetData('EQA-EMPTY', []);

  const snapshot = adapter.getInventorySnapshot('EQA-EMPTY', { tenantId: 'tenant-jy-001', companyId: 'comp-jy' });
  assert.strictEqual(snapshot.warehouses.length, 0);
  assert.ok(snapshot.warnings.some(w => w.warningCode === 'EMPTY_SHEET_DATA'));
});

// 4. Custom Warehouse Name Mapping
runTest('unrecognized or custom warehouse names map safely to distinct warehouses', () => {
  const adapter = new MockSheetInventoryAdapter();
  adapter.setRawSheetData('EQA-6522', [
    { productCode: 'EQA-6522', warehouseName: '高雄倉', batchNumber: 'B1', availableQuantity: 30 }
  ]);

  const snapshot = adapter.getInventorySnapshot('EQA-6522', { tenantId: 'tenant-jy-001', companyId: 'comp-jy' });
  assert.strictEqual(snapshot.warehouses[0].warehouseName, '高雄倉');
  assert.strictEqual(snapshot.warehouses[0].batches[0].availableQuantity, 30);
});

console.log(`\nMock Sheet Adapter Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
