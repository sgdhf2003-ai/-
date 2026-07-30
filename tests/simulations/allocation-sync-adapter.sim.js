/**
 * Simulation Test: FormalReservationAdapter & Sync Contracts (Pack 4A)
 */

const assert = require('assert');
const {
  FormalReservationAdapter,
  MockFormalReservationAdapter,
  validateSyncRequest,
  validateSyncResult
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-sync-adapter: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-sync-adapter: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Contract Validation
runTest('validateSyncRequest and validateSyncResult validate contracts and sanitize objects', () => {
  const reqData = {
    syncRequestId: 'sync_req_100',
    draftId: 'draft_100',
    holdIdempotencyKey: 'hold_idem_100',
    tenantContext: { tenantId: 'tenant-jy-001', companyId: 'comp-jy' },
    items: [
      { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', quantity: 10 }
    ],
    requestedAt: '2026-07-24T16:50:00Z'
  };

  const req = validateSyncRequest(reqData);
  assert.strictEqual(req.draftId, 'draft_100');
  assert.strictEqual(req.holdIdempotencyKey, 'hold_idem_100');

  const resData = {
    success: true,
    syncRequestId: 'sync_req_100',
    draftId: 'draft_100',
    reservationId: 'res_ref_999',
    status: 'SYNCED',
    syncedAt: '2026-07-24T16:50:01Z'
  };

  const res = validateSyncResult(resData);
  assert.strictEqual(res.status, 'SYNCED');
  assert.strictEqual(res.reservationId, 'res_ref_999');
});

// 2. Mock Adapter Success Flow
runTest('MockFormalReservationAdapter processes SyncRequest and returns SYNCED result', () => {
  const adapter = new MockFormalReservationAdapter();
  const reqData = {
    syncRequestId: 'sync_req_200',
    draftId: 'draft_200',
    holdIdempotencyKey: 'hold_idem_200',
    tenantContext: { tenantId: 'tenant-jy-001', companyId: 'comp-jy' },
    items: [{ productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', quantity: 10 }],
    requestedAt: new Date().toISOString()
  };

  const res = adapter.syncReservation(reqData);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.status, 'SYNCED');
  assert.ok(res.reservationId);
});

// 3. Idempotency Key Replay
runTest('duplicate holdIdempotencyKey returns cached result with isReplay: true', () => {
  const adapter = new MockFormalReservationAdapter();
  const reqData = {
    syncRequestId: 'sync_req_300',
    draftId: 'draft_300',
    holdIdempotencyKey: 'hold_idem_300',
    tenantContext: { tenantId: 'tenant-jy-001', companyId: 'comp-jy' },
    items: [{ productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', quantity: 10 }]
  };

  const firstRes = adapter.syncReservation(reqData);
  assert.strictEqual(firstRes.isReplay, false);

  const secondRes = adapter.syncReservation(reqData);
  assert.strictEqual(secondRes.isReplay, true);
  assert.strictEqual(secondRes.reservationId, firstRes.reservationId);
});

// 4. Unknown Outcome Status Query Recovery
runTest('MockAdapter UNKNOWN_OUTCOME mode allows status recovery via queryReservationStatus', () => {
  const adapter = new MockFormalReservationAdapter();
  adapter.setSimulatedFailureMode('UNKNOWN_OUTCOME');

  const reqData = {
    syncRequestId: 'sync_req_400',
    draftId: 'draft_400',
    holdIdempotencyKey: 'hold_idem_400',
    tenantContext: { tenantId: 'tenant-jy-001', companyId: 'comp-jy' },
    items: [{ productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', quantity: 10 }]
  };

  assert.throws(() => {
    adapter.syncReservation(reqData);
  }, /NETWORK_TIMEOUT_UNKNOWN_OUTCOME/);

  // Recovery query recovers status from store
  adapter.setSimulatedFailureMode('NONE');
  const statusRes = adapter.queryReservationStatus('hold_idem_400');
  assert.strictEqual(statusRes.found, true);
  assert.strictEqual(statusRes.status, 'SYNCED');
});

// 5. Abstract Interface Contract Enforcement
runTest('FormalReservationAdapter abstract base class throws on direct method call', () => {
  const baseAdapter = new FormalReservationAdapter();
  assert.throws(() => {
    baseAdapter.syncReservation({});
  }, /UNIMPLEMENTED_METHOD/);

  assert.throws(() => {
    baseAdapter.queryReservationStatus('key');
  }, /UNIMPLEMENTED_METHOD/);
});

console.log(`\nAllocation Sync Adapter Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
