/**
 * Simulation Test: Formal Hold Writeback & Reservation Numbering (Pack 7B)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  FormalHoldWritebackAdapter,
  MockFormalReservationAdapter
} = require('../../allocation-assistant/index');

const BACKEND_HOLDS_HEADERS = [
  'id',
  'storeId',
  'storeName',
  'salesOwner',
  'item',
  'quantity',
  'reservationStatus',
  'holdAddress',
  'holdDate',
  'expiresAt',
  'reminderAt',
  'note',
  'status',
  'createdAt',
  'updatedAt'
];

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

// 2. Sheet Record Format Alignment
runTest('FormalHoldWritebackAdapter formats reservation payload into backend HEADERS.holds object', () => {
  const adapter = new FormalHoldWritebackAdapter();
  const holdRecord = adapter.formatHoldRecord({
    reservationNumber: 'RES-20260725-101',
    storeId: 'store_001',
    storeName: '中山建材',
    salesOwner: '張助理',
    productCode: 'EQA-6522',
    quantity: 10,
    warehouseName: '林口倉',
    batchNumber: '7J25'
  });

  assert.deepStrictEqual(Object.keys(holdRecord), BACKEND_HOLDS_HEADERS);
  assert.strictEqual(holdRecord.id, 'RES-20260725-101');
  assert.strictEqual(holdRecord.storeId, 'store_001');
  assert.strictEqual(holdRecord.storeName, '中山建材');
  assert.strictEqual(holdRecord.item, 'EQA-6522');
  assert.strictEqual(holdRecord.quantity, 10);
  assert.strictEqual(holdRecord.reservationStatus, '已收訂 (劃扣)');
  assert.strictEqual(holdRecord.status, 'RESERVED');
  assert.ok(holdRecord.createdAt);
  assert.ok(holdRecord.updatedAt);
});

runTest('FormalHoldWritebackAdapter validates backend HEADERS.holds exact order from Code.gs', () => {
  const code = fs.readFileSync(path.join(__dirname, '../../google-apps-script/Code.gs'), 'utf8');
  const match = code.match(/holds:\s*(\[[^\n]+\])/);
  assert.ok(match, 'backend HEADERS.holds must be discoverable');
  const backendHeaders = Function(`return ${match[1]};`)();

  assert.deepStrictEqual(FormalHoldWritebackAdapter.HOLDS_HEADERS, backendHeaders);
});

// 3. Execution of Writeback & LINE Confirmation Payload
runTest('FormalHoldWritebackAdapter persists through adapter and returns LINE confirmation message', () => {
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
  assert.strictEqual(result.holdRecord.id, result.reservationNumber);
  assert.strictEqual(result.rowData[0], result.reservationNumber);
  assert.strictEqual(sheetMock.holdsStore.size, 1);
  assert.strictEqual(sheetMock.queryHoldByReservationNumber(result.reservationNumber).found, true);
  assert.ok(result.lineConfirmationMessage.includes('已成功完成去保留'));
  assert.ok(result.lineConfirmationMessage.includes(result.reservationNumber));
});

runTest('FormalHoldWritebackAdapter fails closed when writeback adapter capability is missing', () => {
  const adapter = new FormalHoldWritebackAdapter({ sheetAdapter: {} });

  const result = adapter.executeWriteback({
    reservationNumber: 'RES-20260725-404',
    productCode: 'EQA-6522',
    quantity: 3
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'HOLD_WRITE_ADAPTER_MISSING');
  assert.ok(!result.lineConfirmationMessage.includes('已成功完成去保留'));
});

runTest('FormalHoldWritebackAdapter fails closed when no adapter is explicitly provided', () => {
  const adapter = new FormalHoldWritebackAdapter();

  const result = adapter.executeWriteback({
    reservationNumber: 'RES-20260725-406',
    productCode: 'EQA-6522',
    quantity: 3
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'HOLD_WRITE_ADAPTER_MISSING');
  assert.ok(!result.lineConfirmationMessage.includes('已成功完成去保留'));
});

runTest('FormalHoldWritebackAdapter fails closed on writeback failure or header mismatch', () => {
  const failingAdapter = {
    appendHoldRecord() {
      return { success: false, errorCode: 'HOLD_SCHEMA_MISMATCH' };
    }
  };
  const adapter = new FormalHoldWritebackAdapter({ sheetAdapter: failingAdapter });

  const result = adapter.executeWriteback({
    reservationNumber: 'RES-20260725-405',
    productCode: 'EQA-6522',
    quantity: 3
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'HOLD_SCHEMA_MISMATCH');
});

runTest('FormalHoldWritebackAdapter fails closed when production config property is missing', () => {
  const missingPropertyAdapter = {
    appendHoldRecord() {
      return {
        success: false,
        persisted: false,
        errorCode: 'HOLD_SCRIPT_PROPERTY_MISSING'
      };
    }
  };
  const adapter = new FormalHoldWritebackAdapter({ sheetAdapter: missingPropertyAdapter });

  const result = adapter.executeWriteback({
    reservationNumber: 'RES-20260725-407',
    productCode: 'EQA-6522',
    quantity: 3
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'HOLD_SCRIPT_PROPERTY_MISSING');
});

runTest('FormalHoldWritebackAdapter fails closed on permission or API failure', () => {
  const permissionFailureAdapter = {
    appendHoldRecord() {
      throw new Error('HOLD_PERMISSION_DENIED');
    }
  };
  const adapter = new FormalHoldWritebackAdapter({ sheetAdapter: permissionFailureAdapter });

  const result = adapter.executeWriteback({
    reservationNumber: 'RES-20260725-408',
    productCode: 'EQA-6522',
    quantity: 3
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'HOLD_PERMISSION_DENIED');
});

runTest('FormalHoldWritebackAdapter fails closed on unknown write outcome without persisted confirmation', () => {
  const unknownOutcomeAdapter = {
    appendHoldRecord() {
      return {
        success: true,
        persisted: false,
        errorCode: 'HOLD_WRITE_OUTCOME_UNKNOWN'
      };
    }
  };
  const adapter = new FormalHoldWritebackAdapter({ sheetAdapter: unknownOutcomeAdapter });

  const result = adapter.executeWriteback({
    reservationNumber: 'RES-20260725-409',
    productCode: 'EQA-6522',
    quantity: 3
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'HOLD_WRITE_OUTCOME_UNKNOWN');
});

runTest('FormalHoldWritebackAdapter returns idempotent replay without duplicate hold rows', () => {
  const sheetMock = new MockFormalReservationAdapter();
  const adapter = new FormalHoldWritebackAdapter({ sheetAdapter: sheetMock });
  const payload = {
    reservationNumber: 'RES-20260725-777',
    storeId: 'store_777',
    productCode: '艾美 336',
    quantity: 9
  };

  const first = adapter.executeWriteback(payload);
  const second = adapter.executeWriteback(payload);

  assert.strictEqual(first.success, true);
  assert.strictEqual(second.success, true);
  assert.strictEqual(second.isReplay, true);
  assert.strictEqual(sheetMock.holdsStore.size, 1);
});

runTest('FormalHoldWritebackAdapter blocks conflicting replay payloads', () => {
  const sheetMock = new MockFormalReservationAdapter();
  const adapter = new FormalHoldWritebackAdapter({ sheetAdapter: sheetMock });

  const first = adapter.executeWriteback({
    reservationNumber: 'RES-20260725-778',
    storeId: 'store_778',
    productCode: '艾美 336',
    quantity: 9
  });
  const conflictingReplay = adapter.executeWriteback({
    reservationNumber: 'RES-20260725-778',
    storeId: 'store_778',
    productCode: '艾美 336',
    quantity: 12
  });

  assert.strictEqual(first.success, true);
  assert.strictEqual(conflictingReplay.success, false);
  assert.strictEqual(conflictingReplay.errorCode, 'HOLD_IDEMPOTENCY_CONFLICT');
  assert.strictEqual(sheetMock.holdsStore.size, 1);
});

runTest('JingyangAssistant spreadsheet fallback is property gated and no stale hardcoded spreadsheet ID remains', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../line-bot-apps-script/src/JingyangAssistant.gs'), 'utf8');

  assert.ok(source.includes('JINGYANG_MANAGER_SPREADSHEET_ID'));
  assert.ok(!source.includes('1BtroF_mFVlC3mXyw7vO09H244636Vc6nVseW_0qS2Ss'));
  assert.ok(source.includes('JINGYANG_ASSISTANT_SPREADSHEET_ID_REQUIRED'));
});

console.log(`\nFormal Hold Writeback Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
