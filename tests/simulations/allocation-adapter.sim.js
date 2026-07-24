/**
 * Simulation Test: ReadOnlyInventoryAdapter & InventorySheetMapper (Pack 2A)
 */

const assert = require('assert');
const {
  ReadOnlyInventoryAdapter,
  mapSheetRowsToInventorySnapshot
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-adapter: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-adapter: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Abstract Class Enforcement
runTest('ReadOnlyInventoryAdapter abstract base class throws error on direct method call', () => {
  const adapter = new ReadOnlyInventoryAdapter();
  assert.throws(() => {
    adapter.getInventorySnapshot('EQA-6522');
  }, /getInventorySnapshot\(\) must be implemented/);
});

// 2. Valid Row Data Mapping
runTest('valid sheet raw rows map correctly to InventorySnapshot and InventoryLot', () => {
  const rawRows = [
    {
      productCode: 'EQA-6522',
      warehouseName: '林口倉',
      batchNumber: '7J25',
      availableQuantity: 15,
      physicalConfirmed: true
    },
    {
      productCode: 'EQA-6522',
      warehouseName: '忠義倉',
      batchNumber: '7K01',
      availableQuantity: 5,
      physicalConfirmed: true
    }
  ];

  const snapshot = mapSheetRowsToInventorySnapshot('EQA-6522', rawRows);
  assert.strictEqual(snapshot.productCode, 'EQA-6522');
  assert.strictEqual(snapshot.warehouses.length, 2);

  const linkouWh = snapshot.warehouses.find(w => w.warehouseName === '林口倉');
  assert.ok(linkouWh);
  assert.strictEqual(linkouWh.batches[0].batchNumber, '7J25');
  assert.strictEqual(linkouWh.batches[0].availableQuantity, 15);
  assert.strictEqual(linkouWh.batches[0].physicalCountConfirmed, true);
});

// 3. Invalid / Missing Row Field Filtering
runTest('missing productCode or batchNumber rows are filtered with warnings', () => {
  const rawRows = [
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '', availableQuantity: 10 },
    { productCode: '', warehouseName: '林口倉', batchNumber: '7J25', availableQuantity: 10 },
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', availableQuantity: 10 }
  ];

  const snapshot = mapSheetRowsToInventorySnapshot('EQA-6522', rawRows);
  assert.strictEqual(snapshot.warehouses[0].batches.length, 1);
  assert.ok(snapshot.warnings.some(w => w.warningCode === 'INVALID_ROW_FILTERED'));
});

// 4. String Quantity Coercion & Fail-Closed
runTest('string quantities like "10 PCS" or " 15 " parse correctly, while unparseable strings default to 0', () => {
  const rawRows = [
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: 'B1', availableQuantity: '10 PCS' },
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: 'B2', availableQuantity: ' 15 ' },
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: 'B3', availableQuantity: 'INVALID_NUM' }
  ];

  const snapshot = mapSheetRowsToInventorySnapshot('EQA-6522', rawRows);
  const batches = snapshot.warehouses[0].batches;
  assert.strictEqual(batches.find(b => b.batchNumber === 'B1').availableQuantity, 10);
  assert.strictEqual(batches.find(b => b.batchNumber === 'B2').availableQuantity, 15);
  assert.strictEqual(batches.find(b => b.batchNumber === 'B3').availableQuantity, 0);
  assert.ok(snapshot.warnings.some(w => w.warningCode === 'UNPARSEABLE_QUANTITY'));
});

// 5. Unconfirmed Physical Count Flag
runTest('unconfirmed physical count flags physicalCountConfirmed = false and attaches warning', () => {
  const rawRows = [
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', availableQuantity: 10, physicalConfirmed: false }
  ];

  const snapshot = mapSheetRowsToInventorySnapshot('EQA-6522', rawRows);
  assert.strictEqual(snapshot.warehouses[0].batches[0].physicalCountConfirmed, false);
  assert.ok(snapshot.warnings.some(w => w.warningCode === 'PHYSICAL_COUNT_UNCONFIRMED'));
});

console.log(`\nAllocation Adapter Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
