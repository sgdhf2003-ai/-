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
runTest('FulfillmentAdapter executes status transitions for full, partial, and cancel fulfillment', () => {
  const sheetMock = new MockFormalReservationAdapter();
  const adapter = new FulfillmentAdapter({ sheetAdapter: sheetMock });

  // Full Fulfillment
  const resFull = adapter.processFulfillment({
    reservationNumber: 'RES-20260725-001',
    action: 'FULL_FULFILL'
  });
  assert.strictEqual(resFull.success, true);
  assert.strictEqual(resFull.status, 'FULFILLED');
  assert.ok(resFull.lineNotificationMessage.includes('已完成全額出貨結案'));

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

  // Cancel Fulfillment
  const resCancel = adapter.processFulfillment({
    reservationNumber: 'RES-20260725-003',
    action: 'CANCEL_FULFILL'
  });
  assert.strictEqual(resCancel.success, true);
  assert.strictEqual(resCancel.status, 'CANCELLED');
});

console.log(`\nOutbound Fulfillment Loop Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
