/**
 * Simulation Test: AllocationSyncEngine (Pack 4B)
 */

const assert = require('assert');
const {
  AllocationSyncEngine,
  MockFormalReservationAdapter,
  SimulationProvider,
  DRAFT_STATUSES
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-sync-engine: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-sync-engine: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

function createSetup() {
  const provider = new SimulationProvider();
  const adapter = new MockFormalReservationAdapter();
  const syncEngine = new AllocationSyncEngine({ provider, reservationAdapter: adapter });

  // Create & confirm draft
  const createRes = provider.createDraft({
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jy',
    rawText: 'EQA-6522 * 10'
  });
  const draftId = createRes.draftId;

  provider.confirmAllocation(draftId, [
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', allocatedQuantity: 10 }
  ], 'idem_conf_001');

  return { provider, adapter, syncEngine, draftId };
}

// 1. Successful Sync Flow
runTest('executeSync on ALLOCATION_CONFIRMED draft calls Adapter and transitions to SYNCED', () => {
  const { provider, syncEngine, draftId } = createSetup();

  const syncRes = syncEngine.executeSync({
    draftId,
    holdIdempotencyKey: 'hold_idem_4b_1',
    correlationId: 'corr_4b_1'
  });

  assert.strictEqual(syncRes.success, true);
  assert.strictEqual(syncRes.status, 'SYNCED');
  assert.ok(syncRes.reservationId);

  const statusRes = provider.getAllocationStatus(draftId);
  assert.strictEqual(statusRes.draft.status, DRAFT_STATUSES.SYNCED);
});

// 2. Pre-condition Check & Invalid State Guard
runTest('initiating sync on DRAFT or CANCELLED status throws INVALID_SYNC_STATE', () => {
  const { provider, syncEngine } = createSetup();

  // Create draft without confirming
  const unconfirmedRes = provider.createDraft({ rawText: 'EQA-6522 * 5' });
  assert.throws(() => {
    syncEngine.executeSync({ draftId: unconfirmedRes.draftId, holdIdempotencyKey: 'idem_fail_1' });
  }, /INVALID_SYNC_STATE/);

  // Cancelled draft
  const cancelRes = provider.createDraft({ rawText: 'EQA-6522 * 5' });
  provider.cancelAllocation(cancelRes.draftId);
  assert.throws(() => {
    syncEngine.executeSync({ draftId: cancelRes.draftId, holdIdempotencyKey: 'idem_fail_2' });
  }, /INVALID_SYNC_STATE/);
});

// 3. Adapter Failure Handling
runTest('when Adapter returns SYNC_FAILED, SyncEngine transitions draft to SYNC_FAILED', () => {
  const { provider, adapter, syncEngine, draftId } = createSetup();
  adapter.setSimulatedFailureMode('EXPLICIT_FAIL');

  const syncRes = syncEngine.executeSync({
    draftId,
    holdIdempotencyKey: 'hold_idem_4b_3',
    correlationId: 'corr_4b_3'
  });

  assert.strictEqual(syncRes.success, false);
  assert.strictEqual(syncRes.status, 'SYNC_FAILED');
  assert.strictEqual(syncRes.errorCode, 'RESERVATION_REJECTED');

  const statusRes = provider.getAllocationStatus(draftId);
  assert.strictEqual(statusRes.draft.status, DRAFT_STATUSES.SYNC_FAILED);
});

// 4. Correlation & Idempotency Key Propagation
runTest('syncEngine propagates correlationId and holdIdempotencyKey through sync execution', () => {
  const { adapter, syncEngine, draftId } = createSetup();

  const syncRes = syncEngine.executeSync({
    draftId,
    holdIdempotencyKey: 'hold_idem_4b_4',
    correlationId: 'corr_4b_4'
  });

  assert.strictEqual(syncRes.holdIdempotencyKey, 'hold_idem_4b_4');
  assert.strictEqual(syncRes.correlationId, 'corr_4b_4');

  const queryRes = adapter.queryReservationStatus('hold_idem_4b_4');
  assert.strictEqual(queryRes.found, true);
});

console.log(`\nAllocation Sync Engine Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
