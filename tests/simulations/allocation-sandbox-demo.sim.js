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

// Sample sheet data for demo scenarios (115 Sheet Snapshot)
const demoSheetRows = [
  ['品名與規格', '倉庫名稱', '批號', '可用數量', '單位'],
  ['APT-5201', '林口倉', '04', '5062', 'PCS'],
  ['STU-6101', '林口倉', 'J013', '2', 'PCS'],
  ['STU-6101', '忠義倉', 'J013', '1', 'PCS'],
  ['SHN-6101F', '林口倉', '100', '46', 'PCS']
];

function createSetup() {
  const adapter = new MockSheetInventoryAdapter(demoSheetRows);
  const provider = new SandboxInventoryProvider({ inventoryAdapter: adapter });
  const uiState = new AllocationUIState();
  const gatewayClient = provider.createGatewayClient({ uiState });
  const demoCards = new SandboxDemoCards({ gatewayClient, uiState });

  return { adapter, provider, uiState, gatewayClient, demoCards };
}

// 1. Render Demo Cards Template
runTest('renderDemoCards outputs HTML template with 3 built-in 115 scenario cards', () => {
  const { demoCards } = createSetup();

  const html = demoCards.renderDemoCards();
  assert.ok(html.includes('data-demo-id="DEMO_APT_5201"'));
  assert.ok(html.includes('data-demo-id="DEMO_STU_6101"'));
  assert.ok(html.includes('data-demo-id="DEMO_SHN_6101F"'));
  assert.ok(!html.includes('五股倉'), 'MUST NOT contain 五股倉');
  assert.ok(!html.includes('顧佳 575'), 'MUST NOT contain 顧佳 575');
});

// 2. Load DEMO_APT_5201 Scenario
runTest('loadDemoScenario DEMO_APT_5201 auto-fills order text and populates single warehouse suggestion', () => {
  const { demoCards, uiState } = createSetup();

  const res = demoCards.loadDemoScenario('DEMO_APT_5201');
  assert.strictEqual(res.success, true);
  assert.strictEqual(uiState.rawOrderText, '漢樺企業 APT-5201 * 10');
  assert.strictEqual(uiState.status, 'ALLOCATION_REVIEW');
  assert.strictEqual(uiState.suggestions.length, 1);
  assert.strictEqual(uiState.suggestions[0].productCode, 'APT-5201');
});

// 3. Load DEMO_STU_6101 Scenario
runTest('loadDemoScenario DEMO_STU_6101 renders BATCH_MIXING_REQUIRED warning', () => {
  const { demoCards, uiState } = createSetup();

  const res = demoCards.loadDemoScenario('DEMO_STU_6101');
  assert.strictEqual(res.success, true);
  assert.strictEqual(uiState.rawOrderText, '美麗空間 STU-6101 * 3');
  assert.ok(uiState.warnings.some(w => w.warningCode === 'BATCH_MIXING_REQUIRED' || w.code === 'BATCH_MIXING_REQUIRED'));
});

// 4. Load DEMO_LOW_CONFIDENCE Scenario
runTest('loadDemoScenario DEMO_LOW_CONFIDENCE sets OCR_REVIEW status and blocks approval readiness', () => {
  const { demoCards, uiState } = createSetup();

  const res = demoCards.loadDemoScenario('DEMO_SHN_6101F');
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
