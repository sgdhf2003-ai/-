/**
 * Simulation Test: AllocationGatewayClient (Pack 3B)
 */

const assert = require('assert');
const {
  AllocationGatewayClient,
  AllocationGateway,
  AllocationUIState,
  MockSheetInventoryAdapter,
  SimulationProvider
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-gateway-client: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-gateway-client: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

function createSetup() {
  const adapter = new MockSheetInventoryAdapter();
  adapter.setRawSheetData('EQA-6522', [
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', availableQuantity: 20 }
  ]);
  adapter.setRawSheetData('EQA-MIX', [
    { productCode: 'EQA-MIX', warehouseName: '林口倉', batchNumber: 'B1', availableQuantity: 10 },
    { productCode: 'EQA-MIX', warehouseName: '林口倉', batchNumber: 'B2', availableQuantity: 10 }
  ]);

  const provider = new SimulationProvider({ inventoryAdapter: adapter });
  const gateway = new AllocationGateway({ SIMULATION: provider });
  const uiState = new AllocationUIState();
  const client = new AllocationGatewayClient({ gateway, uiState });

  return { adapter, provider, gateway, uiState, client };
}

// 1. submitRawText Drive UI State
runTest('submitRawText creates draft and drives UIState to ALLOCATION_REVIEW', () => {
  const { uiState, client } = createSetup();
  const res = client.submitRawText('EQA-6522 * 10');

  assert.strictEqual(res.success, true);
  assert.strictEqual(uiState.status, 'ALLOCATION_REVIEW');
  assert.strictEqual(uiState.suggestions.length, 1);
  assert.strictEqual(uiState.suggestions[0].batchNumber, '7J25');
});

// 2. toggleMixedBatch Triggers Re-analysis
runTest('toggleMixedBatch updates consent and triggers re-analysis', () => {
  const { uiState, client } = createSetup();
  client.submitRawText('EQA-MIX * 15');

  assert.strictEqual(uiState.warnings.some(w => w.warningCode === 'BATCH_MIXING_REQUIRED'), true);
  assert.strictEqual(uiState.suggestions.length, 0);

  client.toggleMixedBatch(true);
  assert.strictEqual(uiState.customerApprovedMixedBatch, true);
  assert.strictEqual(uiState.suggestions.length, 2);
});

// 3. confirmCurrentAllocation Lock Mechanics
runTest('confirmCurrentAllocation calls confirmAllocation and locks UIState', () => {
  const { uiState, client } = createSetup();
  client.submitRawText('EQA-6522 * 10');

  const confRes = client.confirmCurrentAllocation();
  assert.strictEqual(confRes.success, true);
  assert.strictEqual(uiState.status, 'ALLOCATION_CONFIRMED');
  assert.strictEqual(uiState.isLocked, true);
});

// 4. Error Normalization
runTest('catches Gateway errors and sets error details on UIState', () => {
  const { uiState, client } = createSetup();

  // Trigger error with invalid contract version via direct injection
  client.gatewayParams.contractVersion = 'v9.9.9';
  const res = client.submitRawText('EQA-6522 * 10');

  assert.strictEqual(res.success, false);
  assert.ok(uiState.lastError);
  assert.ok(uiState.lastError.includes('contractVersion'));
});

console.log(`\nAllocation Gateway Client Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
