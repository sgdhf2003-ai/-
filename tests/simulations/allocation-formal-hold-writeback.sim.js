/**
 * Simulation Test: Formal Hold Writeback & Reservation Numbering (Pack 7B)
 */

const assert = require('assert');
const {
  FormalHoldWritebackAdapter,
  MockFormalReservationAdapter
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-formal-hold-writeback: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-formal-hold-writeback: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Structured Reservation Number Generation
runTest('FormalHoldWritebackAdapter generates structured reservation number RES-YYYYMMDD-XXX', () => {
  const date = new Date('2026-07-25T10:00:00Z');
  const resNo = FormalHoldWritebackAdapter.generateReservationNumber(date, 42);

  assert.strictEqual(resNo, 'RES-20260725-042');
});

// 2. Sheet Row Format Alignment
runTest('FormalHoldWritebackAdapter formats reservation payload into standard Google Sheet row array', () => {
  const adapter = new FormalHoldWritebackAdapter();
  const rowData = adapter.formatHoldRow({
    reservationNumber: 'RES-20260725-101',
    storeId: 'store_001',
    storeName: '中山建材',
    salesOwner: '張助理',
    productCode: 'EQA-6522',
    quantity: 10,
    warehouseName: '林口倉',
    batchNumber: '7J25'
  });

  assert.strictEqual(rowData[1], 'RES-20260725-101');
  assert.strictEqual(rowData[3], '中山建材');
  assert.strictEqual(rowData[5], 'EQA-6522');
  assert.strictEqual(rowData[6], 10);
  assert.strictEqual(rowData[7], '已收訂 (劃扣)');
  assert.strictEqual(rowData[11], 'RESERVED');
});

// 3. Execution of Writeback & LINE Confirmation Payload
runTest('FormalHoldWritebackAdapter executes writeback to mock sheet and returns LINE confirmation message', () => {
  const sheetMock = new MockFormalReservationAdapter();
  const adapter = new FormalHoldWritebackAdapter({ sheetAdapter: sheetMock });

  const result = adapter.executeWriteback({
    storeId: 'store_002',
    storeName: '五股門市',
    salesOwner: '陳助理',
    productCode: '顧佳 575',
    quantity: 15,
    warehouseName: '五股倉',
    batchNumber: '8K12'
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.status, 'RESERVED');
  assert.ok(result.reservationNumber.startsWith('RES-'));
  assert.ok(result.lineConfirmationMessage.includes('已成功完成去保留'));
  assert.ok(result.lineConfirmationMessage.includes(result.reservationNumber));
});

console.log(`\nFormal Hold Writeback Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
