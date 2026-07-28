/**
 * Simulation Test: Outbound Fulfillment Loop Dual-Track Mechanism (Pack 7C)
 */

const assert = require('assert');
const {
  FulfillmentAdapter,
  MockFormalReservationAdapter
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-fulfillment-loop: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-fulfillment-loop: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Text Shortcut Command Parsing (Option 3)
runTest('FulfillmentAdapter parses Option 3 text shortcut commands correctly', () => {
  const cmd1 = FulfillmentAdapter.parseShortcutCommand('出貨 #RES-20260725-001');
  assert.strictEqual(cmd1.isFulfillmentCommand, true);
  assert.strictEqual(cmd1.action, 'FULL_FULFILL');
  assert.strictEqual(cmd1.reservationNumber, 'RES-20260725-001');

  const cmd2 = FulfillmentAdapter.parseShortcutCommand('結案 RES-20260725-002');
  assert.strictEqual(cmd2.isFulfillmentCommand, true);
  assert.strictEqual(cmd2.action, 'CLOSE_FULFILL');

  const partialCmd = FulfillmentAdapter.parseShortcutCommand('部分出貨 #RES-20260725-004');
  assert.strictEqual(partialCmd.isFulfillmentCommand, true);
  assert.strictEqual(partialCmd.action, 'PARTIAL_FULFILL_REQUIRES_QUANTITY');
  assert.strictEqual(partialCmd.requiresQuantityConfirmation, true);

  const cmd3 = FulfillmentAdapter.parseShortcutCommand('取消 #003');
  assert.strictEqual(cmd3.isFulfillmentCommand, true);
  assert.strictEqual(cmd3.action, 'CANCEL_FULFILL');
  assert.strictEqual(cmd3.reservationNumber, '003');
});

// 2. Pending Outbound Carousel Rendering (Option 2)
runTest('FulfillmentAdapter renders pending outbound carousel buttons', () => {
  const adapter = new FulfillmentAdapter();
  const carousel = adapter.renderPendingCarousel([
    { reservationNumber: 'RES-20260725-001', item: 'EQA-6522', quantity: 10 }
  ]);

  assert.ok(carousel.includes('全額出貨'));
  assert.ok(carousel.includes('部分出貨'));
  assert.ok(carousel.includes('取消保留'));
});

// 3. Fulfillment Execution and Status Transitions
runTest('FulfillmentAdapter persists status transitions and inventory records for full, partial, and cancel fulfillment', () => {
  const sheetMock = new MockFormalReservationAdapter();
  const adapter = new FulfillmentAdapter({ sheetAdapter: sheetMock });
  sheetMock.appendHoldRecord({
    id: 'RES-20260725-001',
    storeId: 'store_001',
    storeName: '中山建材',
    salesOwner: '陳助理',
    item: 'EQA-6522',
    quantity: 10,
    reservationStatus: '已收訂 (劃扣)',
    holdAddress: '林口倉 - 批號 7J25',
    holdDate: '2026-07-25',
    expiresAt: '2026-09-23',
    reminderAt: '2026-09-16',
    note: '',
    status: 'RESERVED',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z'
  });
  sheetMock.appendHoldRecord({
    id: 'RES-20260725-002',
    storeId: 'store_002',
    storeName: '五股門市',
    salesOwner: '陳助理',
    item: '顧佳 575',
    quantity: 15,
    reservationStatus: '已收訂 (劃扣)',
    holdAddress: '五股倉 - 批號 8K12',
    holdDate: '2026-07-25',
    expiresAt: '2026-09-23',
    reminderAt: '2026-09-16',
    note: '',
    status: 'RESERVED',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z'
  });
  sheetMock.appendHoldRecord({
    id: 'RES-20260725-003',
    storeId: 'store_003',
    storeName: '板橋門市',
    salesOwner: '陳助理',
    item: '艾美 336',
    quantity: 6,
    reservationStatus: '已收訂 (劃扣)',
    holdAddress: '五股倉 - 批號 9A01',
    holdDate: '2026-07-25',
    expiresAt: '2026-09-23',
    reminderAt: '2026-09-16',
    note: '',
    status: 'RESERVED',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z'
  });

  // Full Fulfillment
  const resFull = adapter.processFulfillment({
    reservationNumber: 'RES-20260725-001',
    action: 'FULL_FULFILL'
  });
  assert.strictEqual(resFull.success, true);
  assert.strictEqual(resFull.status, 'FULFILLED');
  assert.ok(resFull.lineNotificationMessage.includes('已完成全額出貨結案'));
  assert.strictEqual(sheetMock.queryHoldByReservationNumber('RES-20260725-001').record.status, 'FULFILLED');

  // Partial Fulfillment
  const resPartial = adapter.processFulfillment({
    reservationNumber: 'RES-20260725-002',
    action: 'PARTIAL_FULFILL',
    fulfilledQuantity: 5,
    totalQuantity: 15
  });
  assert.strictEqual(resPartial.success, true);
  assert.strictEqual(resPartial.status, 'PARTIALLY_FULFILLED');
  assert.strictEqual(resPartial.remainingQuantity, 10);
  assert.strictEqual(sheetMock.queryHoldByReservationNumber('RES-20260725-002').record.status, 'PARTIALLY_FULFILLED');

  // Cancel Fulfillment
  const resCancel = adapter.processFulfillment({
    reservationNumber: 'RES-20260725-003',
    action: 'CANCEL_FULFILL'
  });
  assert.strictEqual(resCancel.success, true);
  assert.strictEqual(resCancel.status, 'CANCELLED');
  assert.strictEqual(sheetMock.queryHoldByReservationNumber('RES-20260725-003').record.status, 'CANCELLED');
  assert.deepStrictEqual(
    sheetMock.inventoryAdjustments.map(entry => entry.action),
    ['FULFILL_DEDUCT', 'PARTIAL_FULFILL_DEDUCT', 'CANCEL_RELEASE']
  );
  assert.deepStrictEqual(
    sheetMock.inventoryAdjustments.map(entry => entry.quantity),
    [10, 5, 6]
  );
  assert.strictEqual(sheetMock.inventoryAdjustments[2].remainingQuantity, 6);
});

runTest('FulfillmentAdapter fails closed when persistence adapter capability is missing', () => {
  const adapter = new FulfillmentAdapter({ sheetAdapter: {} });

  const result = adapter.processFulfillment({
    reservationNumber: 'RES-20260725-099',
    action: 'FULL_FULFILL'
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'FULFILLMENT_ADAPTER_MISSING');
});

runTest('FulfillmentAdapter blocks partial fulfillment without valid quantity confirmation', () => {
  const sheetMock = new MockFormalReservationAdapter();
  const adapter = new FulfillmentAdapter({ sheetAdapter: sheetMock });
  sheetMock.appendHoldRecord({
    id: 'RES-20260725-200',
    storeId: 'store_200',
    storeName: '中山建材',
    salesOwner: '陳助理',
    item: 'EQA-6522',
    quantity: 10,
    reservationStatus: '已收訂 (劃扣)',
    holdAddress: '林口倉',
    holdDate: '2026-07-25',
    expiresAt: '2026-09-23',
    reminderAt: '2026-09-16',
    note: '',
    status: 'RESERVED',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z'
  });

  const result = adapter.processFulfillment({
    reservationNumber: 'RES-20260725-200',
    action: 'PARTIAL_FULFILL'
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'PARTIAL_QUANTITY_REQUIRED');
});

console.log(`\nOutbound Fulfillment Loop Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
