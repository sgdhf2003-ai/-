/**
 * Simulation Test: Allocation UI End-to-End Workflow (Pack 3D)
 */

const assert = require('assert');
const {
  AllocationGatewayClient,
  AllocationGateway,
  AllocationUIState,
  AllocationViewRenderer,
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
    console.log(`PASS allocation-ui-e2e: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-ui-e2e: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

function createSetup() {
  const adapter = new MockSheetInventoryAdapter();
  adapter.setRawSheetData('EQA-MIX-E2E', [
    { productCode: 'EQA-MIX-E2E', warehouseName: '林口倉', batchNumber: 'LOT-A', availableQuantity: 10 },
    { productCode: 'EQA-MIX-E2E', warehouseName: '林口倉', batchNumber: 'LOT-B', availableQuantity: 10 }
  ]);

  const provider = new SimulationProvider({ inventoryAdapter: adapter });
  const gateway = new AllocationGateway({ SIMULATION: provider });
  const uiState = new AllocationUIState();
  const client = new AllocationGatewayClient({ gateway, uiState });

  return { adapter, provider, gateway, uiState, client };
}

// 1. Step 1: Submit Text & Render Draft Card
runTest('E2E Step 1: Raw order text submission renders draft summary card in ALLOCATION_REVIEW', () => {
  const { uiState, client } = createSetup();

  const submitRes = client.submitRawText('EQA-MIX-E2E * 15');
  assert.strictEqual(submitRes.success, true);
  assert.strictEqual(uiState.status, 'ALLOCATION_REVIEW');

  const cardHtml = AllocationViewRenderer.renderDraftSummaryCard(uiState);
  assert.ok(cardHtml.includes('EQA-MIX-E2E'));
  assert.ok(cardHtml.includes('badge-allocation-review'));
});

// 2. Step 2: Warning Detection, Consent Toggle & Re-analysis Rendering
runTest('E2E Step 2: BATCH_MIXING_REQUIRED warning triggers consent toggle and re-evaluates mixed batch', () => {
  const { uiState, client } = createSetup();
  client.submitRawText('EQA-MIX-E2E * 15');

  const warningsHtml = AllocationViewRenderer.renderWarningsAndToggles(uiState);
  assert.ok(warningsHtml.includes('alert-batch-mixing-required'));

  const toggleRes = client.toggleMixedBatch(true);
  assert.strictEqual(toggleRes.success, true);
  assert.strictEqual(uiState.customerApprovedMixedBatch, true);
  assert.strictEqual(uiState.suggestions.length, 2);

  const updatedCardHtml = AllocationViewRenderer.renderDraftSummaryCard(uiState);
  assert.ok(updatedCardHtml.includes('LOT-A'));
  assert.ok(updatedCardHtml.includes('LOT-B'));
});

// 3. Step 3: Approval Readiness Checklist & Confirmation Lock
runTest('E2E Step 3: Approval checklist validates readiness and locks draft on confirmation', () => {
  const { uiState, client } = createSetup();
  client.submitRawText('EQA-MIX-E2E * 15');
  client.toggleMixedBatch(true);

  const readiness = AllocationViewRenderer.validateApprovalReadiness(uiState);
  assert.strictEqual(readiness.ready, true);

  const confirmRes = client.confirmCurrentAllocation();
  assert.strictEqual(confirmRes.success, true);
  assert.strictEqual(uiState.status, 'ALLOCATION_CONFIRMED');
  assert.strictEqual(uiState.isLocked, true);

  const finalCardHtml = AllocationViewRenderer.renderDraftSummaryCard(uiState);
  assert.ok(finalCardHtml.includes('badge-allocation-confirmed'));
  assert.ok(finalCardHtml.includes('disabled'));
  assert.ok(finalCardHtml.includes('is-locked'));
});

console.log(`\nAllocation UI E2E Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
