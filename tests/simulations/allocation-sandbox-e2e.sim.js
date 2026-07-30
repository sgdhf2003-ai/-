/**
 * Simulation Test: Allocation Sandbox E2E Workflow (Pack 5D)
 */

const assert = require('assert');
const {
  AllocationSandboxView,
  SandboxInventoryProvider,
  MockSheetInventoryAdapter,
  AllocationUIState,
  SandboxDemoCards
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-sandbox-e2e: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-sandbox-e2e: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

const demoSheetRows = [
  ['品名與規格', '倉庫名稱', '批號', '可用數量', '單位'],
  ['EQA-6522', '林口倉', '7J25', '50', 'PCS'],
  ['顧佳 575', '林口倉', '8K11', '8', 'PCS'],
  ['顧佳 575', '五股倉', '8K12', '12', 'PCS']
];

function createSandboxEnvironment() {
  const adapter = new MockSheetInventoryAdapter(demoSheetRows);
  const provider = new SandboxInventoryProvider({ inventoryAdapter: adapter });
  const uiState = new AllocationUIState();
  const gatewayClient = provider.createGatewayClient({ uiState });
  const sandboxView = new AllocationSandboxView({ uiState });
  const demoCards = new SandboxDemoCards({ gatewayClient, uiState });

  return { adapter, provider, uiState, gatewayClient, sandboxView, demoCards };
}

// 1. E2E Step 1: Sandbox Tab Mount & Warning Banner
runTest('Sandbox E2E Step 1: Mounting sandbox tab renders amber warning banner with read-only disclaimer', () => {
  const { sandboxView } = createSandboxEnvironment();

  const containerHtml = sandboxView.renderSandboxContainer();
  assert.ok(containerHtml.includes('id="view-allocation-sandbox"'));
  assert.ok(containerHtml.includes('配貨建議試算 (唯讀沙盒模式)'));
  assert.ok(containerHtml.includes('不寫入正式保留與 LINE 通知'));
});

// 2. E2E Step 2: Load Demo Preset Card & Render Warning Block
runTest('Sandbox E2E Step 2: Clicking DEMO_GUJIA_575 loads snapshot data and renders BATCH_MIXING_REQUIRED warning', () => {
  const { demoCards, uiState } = createSandboxEnvironment();

  const loadRes = demoCards.loadDemoScenario('DEMO_GUJIA_575');
  assert.strictEqual(loadRes.success, true);
  assert.strictEqual(uiState.status, 'ALLOCATION_REVIEW');
  assert.ok(uiState.warnings.some(w => w.warningCode === 'BATCH_MIXING_REQUIRED' || w.code === 'BATCH_MIXING_REQUIRED'));
});

// 3. E2E Step 3: Interactive Consent Toggle Re-evaluation
runTest('Sandbox E2E Step 3: Toggling mixed batch consent switch triggers instant re-evaluation and updates ViewModel', () => {
  const { demoCards, gatewayClient, uiState } = createSandboxEnvironment();

  demoCards.loadDemoScenario('DEMO_GUJIA_575');
  assert.strictEqual(uiState.customerApprovedMixedBatch, false);

  const toggleRes = gatewayClient.toggleMixedBatch(true);
  assert.strictEqual(toggleRes.success, true);
  assert.strictEqual(uiState.customerApprovedMixedBatch, true);
  assert.strictEqual(uiState.suggestions.length, 2); // Split across 2 warehouses
});

// 4. E2E Step 4: Fail-Closed Write Interception
runTest('Sandbox E2E Step 4: Attempting formal write inside sandbox throws SANDBOX_WRITE_FORBIDDEN and preserves read-only safety', () => {
  const { provider } = createSandboxEnvironment();

  assert.throws(() => {
    provider.executeFormalWrite({ draftId: 'draft_e2e_test' });
  }, /SANDBOX_WRITE_FORBIDDEN/);
});

console.log(`\nAllocation Sandbox E2E Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
