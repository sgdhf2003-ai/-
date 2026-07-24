/**
 * Simulation Test: SyncIdempotencyGuard & Recovery (Pack 4C)
 */

const assert = require('assert');
const {
  SyncIdempotencyGuard,
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
    console.log(`PASS allocation-sync-recovery: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-sync-recovery: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Guard Idempotent Replay
runTest('SyncIdempotencyGuard returns isReplay: true on identical payload key re-submission', () => {
  const guard = new SyncIdempotencyGuard();
  const payload = { draftId: 'draft_4c_1', items: [{ productCode: 'EQA-6522', quantity: 10 }] };
  const mockResponse = { success: true, status: 'SYNCED', reservationId: 'res_4c_1' };

  guard.saveResult('hold_key_1', payload, mockResponse);

  const checkRes = guard.checkKey('hold_key_1', payload);
  assert.strictEqual(checkRes.isReplay, true);
  assert.strictEqual(checkRes.response.reservationId, 'res_4c_1');
});

// 2. Guard Conflict Detection
runTest('SyncIdempotencyGuard throws IDEMPOTENCY_CONFLICT on key reuse with conflicting payload', () => {
  const guard = new SyncIdempotencyGuard();
  const payloadA = { draftId: 'draft_4c_2', items: [{ productCode: 'EQA-6522', quantity: 10 }] };
  const payloadB = { draftId: 'draft_4c_2', items: [{ productCode: 'EQA-6522', quantity: 99 }] };

  guard.saveResult('hold_key_2', payloadA, { success: true });

  assert.throws(() => {
    guard.checkKey('hold_key_2', payloadB);
  }, /IDEMPOTENCY_CONFLICT/);
});

// 3 & 4. Unknown Outcome Auto-Recovery to SYNCED
runTest('SyncEngine catches UNKNOWN_OUTCOME and recovers draft to SYNCED via status query', () => {
  const provider = new SimulationProvider();
  const adapter = new MockFormalReservationAdapter();
  const syncEngine = new AllocationSyncEngine({ provider, reservationAdapter: adapter });

  // Create & confirm draft
  const createRes = provider.createDraft({ rawText: 'EQA-6522 * 10' });
  const draftId = createRes.draftId;
  provider.confirmAllocation(draftId, [{ productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', allocatedQuantity: 10 }], 'idem_conf');

  // Set adapter to UNKNOWN_OUTCOME mode
  adapter.setSimulatedFailureMode('UNKNOWN_OUTCOME');

  const syncRes = syncEngine.executeSync({
    draftId,
    holdIdempotencyKey: 'hold_idem_4c_3',
    correlationId: 'corr_4c_3'
  });

  assert.strictEqual(syncRes.success, true);
  assert.strictEqual(syncRes.status, 'SYNCED');
  assert.strictEqual(syncRes.recovered, true);
  assert.ok(syncRes.reservationId);

  const statusRes = provider.getAllocationStatus(draftId);
  assert.strictEqual(statusRes.draft.status, DRAFT_STATUSES.SYNCED);
});

// 5. Unknown Outcome Auto-Recovery to SYNC_FAILED on missing remote record
runTest('SyncEngine recovers draft to SYNC_FAILED when secondary query confirms no remote record', () => {
  const provider = new SimulationProvider();

  // Custom adapter throwing timeout without saving record
  const customAdapter = {
    syncReservation() {
      throw new Error('NETWORK_TIMEOUT_UNKNOWN_OUTCOME: Timeout without write');
    },
    queryReservationStatus() {
      return { found: false };
    }
  };

  const syncEngine = new AllocationSyncEngine({ provider, reservationAdapter: customAdapter });

  const createRes = provider.createDraft({ rawText: 'EQA-6522 * 10' });
  const draftId = createRes.draftId;
  provider.confirmAllocation(draftId, [{ productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', allocatedQuantity: 10 }], 'idem_conf');

  const syncRes = syncEngine.executeSync({
    draftId,
    holdIdempotencyKey: 'hold_idem_4c_5',
    correlationId: 'corr_4c_5'
  });

  assert.strictEqual(syncRes.success, false);
  assert.strictEqual(syncRes.status, 'SYNC_FAILED');
  assert.strictEqual(syncRes.recovered, true);

  const statusRes = provider.getAllocationStatus(draftId);
  assert.strictEqual(statusRes.draft.status, DRAFT_STATUSES.SYNC_FAILED);
});

console.log(`\nAllocation Sync Recovery Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
