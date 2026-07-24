/**
 * Simulation Test: SandboxDemoCards & Interactive Scenario Loader (Pack 5C)
 */

const assert = require('assert');
const {
  SandboxDemoCards,
  SandboxInventoryProvider,
  MockSheetInventoryAdapter,
  AllocationUIState,
  AllocationViewRenderer
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-sandbox-demo: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-sandbox-demo: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// Sample sheet data for demo scenarios
const demoSheetRows = [
  ['品名與規格', '倉庫名稱', '批號', '可用數量', '單位'],
  ['EQA-6522', '林口倉', '7J25', '50', 'PCS'],
  ['顧佳 575', '林口倉', '8K11', '8', 'PCS'],
  ['顧佳 575', '五股倉', '8K12', '12', 'PCS']
];

function createSetup() {
  const adapter = new MockSheetInventoryAdapter(demoSheetRows);
  const provider = new SandboxInventoryProvider({ inventoryAdapter: adapter });
  const uiState = new AllocationUIState();
  const gatewayClient = provider.createGatewayClient({ uiState });
  const demoCards = new SandboxDemoCards({ gatewayClient, uiState });

  return { adapter, provider, uiState, gatewayClient, demoCards };
}

// 1. Render Demo Cards Structure
runTest('renderDemoCards outputs HTML template with 3 built-in scenario cards', () => {
  const { demoCards } = createSetup();

  const html = demoCards.renderDemoCards();
  assert.ok(html.includes('data-demo-id="DEMO_EQA_6522"'));
  assert.ok(html.includes('data-demo-id="DEMO_GUJIA_575"'));
  assert.ok(html.includes('data-demo-id="DEMO_LOW_CONFIDENCE"'));
});

// 2. Load DEMO_EQA_6522 Scenario
runTest('loadDemoScenario DEMO_EQA_6522 auto-fills order text and populates single warehouse suggestion', () => {
  const { demoCards, uiState } = createSetup();

  const res = demoCards.loadDemoScenario('DEMO_EQA_6522');
  assert.strictEqual(res.success, true);
  assert.strictEqual(uiState.rawOrderText, 'EQA-6522 * 10');
  assert.strictEqual(uiState.status, 'ALLOCATION_REVIEW');
  assert.strictEqual(uiState.suggestions.length, 1);
  assert.strictEqual(uiState.suggestions[0].productCode, 'EQA-6522');
});

// 3. Load DEMO_GUJIA_575 Scenario
runTest('loadDemoScenario DEMO_GUJIA_575 renders BATCH_MIXING_REQUIRED warning', () => {
  const { demoCards, uiState } = createSetup();

  const res = demoCards.loadDemoScenario('DEMO_GUJIA_575');
  assert.strictEqual(res.success, true);
  assert.strictEqual(uiState.rawOrderText, '顧佳 575 * 15');
  assert.ok(uiState.warnings.some(w => w.warningCode === 'BATCH_MIXING_REQUIRED' || w.code === 'BATCH_MIXING_REQUIRED'));
});

// 4. Load DEMO_LOW_CONFIDENCE Scenario
runTest('loadDemoScenario DEMO_LOW_CONFIDENCE sets OCR_REVIEW status and blocks approval readiness', () => {
  const { demoCards, uiState } = createSetup();

  const res = demoCards.loadDemoScenario('DEMO_LOW_CONFIDENCE');
  assert.strictEqual(res.success, true);
  assert.strictEqual(uiState.status, 'OCR_REVIEW');

  const readiness = AllocationViewRenderer.validateApprovalReadiness(uiState);
  assert.strictEqual(readiness.ready, false);
  assert.ok(readiness.reason.includes('OCR'));
});

console.log(`\nAllocation Sandbox Demo Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
