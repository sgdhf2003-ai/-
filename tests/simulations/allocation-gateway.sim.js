/**
 * Simulation Test: Allocation Gateway (Pack 1B)
 */

const assert = require('assert');
const {
  AllocationGateway,
  SimulationProvider,
  ExternalProvider
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-gateway: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-gateway: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Gateway Initialization & Routing
runTest('Gateway initializes with default simulation provider', () => {
  const simProvider = new SimulationProvider();
  const gateway = new AllocationGateway({ simulationProvider: simProvider });
  assert.ok(gateway);
});

runTest('Gateway rejects invalid contractVersion', () => {
  const simProvider = new SimulationProvider();
  const gateway = new AllocationGateway({ simulationProvider: simProvider });
  assert.throws(() => {
    gateway.createDraft({
      contractVersion: 'v0.9.0',
      tenantId: 'tenant-jy-001',
      companyId: 'comp-jy',
      idempotencyKey: 'idem_001',
      rawText: 'EQA-6522 * 10'
    });
  }, /invalid or unsupported contractVersion/i);
});

runTest('Gateway rejects unknown provider mode', () => {
  const gateway = new AllocationGateway();
  assert.throws(() => {
    gateway.dispatch('UNKNOWN_PROVIDER', 'createDraft', {});
  }, /unknown provider/i);
});

// 2. ExternalProvider Fail-Closed Behavior
runTest('ExternalProvider fails closed when invoked via Gateway', () => {
  const extProvider = new ExternalProvider();
  const gateway = new AllocationGateway({ externalProvider: extProvider });
  assert.throws(() => {
    gateway.dispatch('EXTERNAL', 'createDraft', {
      contractVersion: 'v1.0.0',
      tenantId: 'tenant-jy-001',
      companyId: 'comp-jy',
      idempotencyKey: 'idem_ext_001'
    });
  }, /EXTERNAL_PROVIDER_DISABLED/);
});

// 3. Request Dispatch & Correlation ID Propagation
runTest('Gateway correctly dispatches valid createDraft to SimulationProvider with correlationId', () => {
  const simProvider = new SimulationProvider();
  const gateway = new AllocationGateway({ simulationProvider: simProvider });
  const response = gateway.createDraft({
    contractVersion: 'v1.0.0',
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jy',
    idempotencyKey: 'idem_gw_001',
    correlationId: 'corr_gw_9988',
    rawText: 'EQA-6522 * 10'
  });
  assert.strictEqual(response.success, true);
  assert.ok(response.draftId);
  assert.strictEqual(response.correlationId, 'corr_gw_9988');
});

console.log(`\nAllocation Gateway Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
