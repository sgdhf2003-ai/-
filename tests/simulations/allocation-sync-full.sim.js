/**
 * Simulation Test: Allocation Full Reservation Sync Workflow (Pack 4D)
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
    console.log(`PASS allocation-sync-full: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-sync-full: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

function createSetup() {
  const provider = new SimulationProvider();
  const adapter = new MockFormalReservationAdapter();
  const syncEngine = new AllocationSyncEngine({ provider, reservationAdapter: adapter });

  // Create & confirm draft
  const createRes = provider.createDraft({ rawText: 'EQA-6522 * 10' });
  const draftId = createRes.draftId;
  provider.confirmAllocation(draftId, [
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', allocatedQuantity: 10 }
  ], 'idem_conf_4d');

  return { provider, adapter, syncEngine, draftId };
}

// 1. End-to-End Successful Sync
runTest('Full Sync Step 1: Confirmed draft executes sync and transitions to SYNCED with reservationId', () => {
  const { provider, adapter, syncEngine, draftId } = createSetup();

  const syncRes = syncEngine.executeSync({
    draftId,
    holdIdempotencyKey: 'hold_idem_4d_1',
    correlationId: 'corr_4d_1'
  });

  assert.strictEqual(syncRes.success, true);
  assert.strictEqual(syncRes.status, 'SYNCED');
  assert.ok(syncRes.reservationId);

  const statusRes = provider.getAllocationStatus(draftId);
  assert.strictEqual(statusRes.draft.status, DRAFT_STATUSES.SYNCED);

  const queryRes = adapter.queryReservationStatus('hold_idem_4d_1');
  assert.strictEqual(queryRes.found, true);
});

// 2. Network Timeout Unknown Outcome Recovery
runTest('Full Sync Step 2: Simulated network timeout recovers status via secondary query', () => {
  const { provider, adapter, syncEngine, draftId } = createSetup();
  adapter.setSimulatedFailureMode('UNKNOWN_OUTCOME');

  const syncRes = syncEngine.executeSync({
    draftId,
    holdIdempotencyKey: 'hold_idem_4d_2',
    correlationId: 'corr_4d_2'
  });

  assert.strictEqual(syncRes.success, true);
  assert.strictEqual(syncRes.status, 'SYNCED');
  assert.strictEqual(syncRes.recovered, true);

  const statusRes = provider.getAllocationStatus(draftId);
  assert.strictEqual(statusRes.draft.status, DRAFT_STATUSES.SYNCED);
});

// 3. Concurrent Duplicate Invocation Protection
runTest('Full Sync Step 3: Duplicate sync invocation returns replay result and preserves single remote record', () => {
  const { adapter, syncEngine, draftId } = createSetup();

  const firstSync = syncEngine.executeSync({
    draftId,
    holdIdempotencyKey: 'hold_idem_4d_3',
    correlationId: 'corr_4d_3'
  });
  assert.strictEqual(firstSync.isReplay, false);

  const secondSync = syncEngine.executeSync({
    draftId,
    holdIdempotencyKey: 'hold_idem_4d_3',
    correlationId: 'corr_4d_3'
  });
  assert.strictEqual(secondSync.isReplay, true);
  assert.strictEqual(secondSync.reservationId, firstSync.reservationId);

  // Confirm adapter store contains exactly 1 reservation for this key
  assert.strictEqual(adapter.reservationsStore.size, 1);
});

console.log(`\nAllocation Full Sync Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
