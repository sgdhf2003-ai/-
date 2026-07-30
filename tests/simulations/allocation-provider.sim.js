/**
 * Simulation Test: Allocation Providers & SimulationProvider Idempotency (Pack 1B)
 */

const assert = require('assert');
const { SimulationProvider } = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-provider: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-provider: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. SimulationProvider In-Memory Draft Creation
runTest('createDraft produces in-memory draft with valid status', () => {
  const provider = new SimulationProvider();
  const res = provider.createDraft({
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jy',
    idempotencyKey: 'idem_prov_001',
    correlationId: 'corr_prov_001',
    rawText: 'EQA-6522 * 10'
  });
  assert.strictEqual(res.success, true);
  assert.ok(res.draftId);

  const statusRes = provider.getAllocationStatus(res.draftId);
  assert.strictEqual(statusRes.success, true);
  assert.strictEqual(statusRes.draft.draftId, res.draftId);
});

// 2. Idempotency Key Behaviors
runTest('duplicate idempotencyKey with identical payload returns cached result (isReplay: true)', () => {
  const provider = new SimulationProvider();
  const payload = {
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jy',
    idempotencyKey: 'idem_replay_001',
    rawText: 'EQA-6522 * 10'
  };

  const res1 = provider.createDraft(payload);
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.isReplay, false);

  const res2 = provider.createDraft(payload);
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.draftId, res1.draftId);
  assert.strictEqual(res2.isReplay, true);
});

runTest('duplicate idempotencyKey with conflicting payload rejects with IDEMPOTENCY_CONFLICT', () => {
  const provider = new SimulationProvider();
  const payload1 = {
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jy',
    idempotencyKey: 'idem_conflict_001',
    rawText: 'EQA-6522 * 10'
  };
  const payload2 = {
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jy',
    idempotencyKey: 'idem_conflict_001',
    rawText: 'EQA-9999 * 50' // conflicting payload
  };

  provider.createDraft(payload1);
  assert.throws(() => {
    provider.createDraft(payload2);
  }, /IDEMPOTENCY_CONFLICT/);
});

// 3. Draft Lifecycle Restrictions
runTest('cancelled draft rejects analyzeAllocation with INVALID_DRAFT_STATE', () => {
  const provider = new SimulationProvider();
  const createRes = provider.createDraft({
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jy',
    idempotencyKey: 'idem_cancel_001',
    rawText: 'EQA-6522 * 10'
  });

  const cancelRes = provider.cancelAllocation(createRes.draftId);
  assert.strictEqual(cancelRes.success, true);
  assert.strictEqual(cancelRes.status, 'CANCELLED');

  assert.throws(() => {
    provider.analyzeAllocation(createRes.draftId, 'idem_analyze_cancel_001');
  }, /INVALID_DRAFT_STATE/);
});

console.log(`\nAllocation Provider Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
