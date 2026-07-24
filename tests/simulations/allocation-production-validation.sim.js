/**
 * Simulation Test: Production Read-Only Validation (Pack 6C)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
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
    console.log(`PASS allocation-production-validation: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-production-validation: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

const rootDir = path.resolve(__dirname, '../../');
const viewHtmlPath = path.join(rootDir, 'google-apps-script/AllocationAssistantView.html');

const prodSheetRows = [
  ['品名與規格', '倉庫名稱', '批號', '可用數量', '單位'],
  ['EQA-6522', '林口倉', '7J25', '100', 'PCS'],
  ['顧佳 575', '林口倉', '8K11', '8', 'PCS'],
  ['顧佳 575', '五股倉', '8K12', '12', 'PCS']
];

function createProdValidationEnvironment() {
  const adapter = new MockSheetInventoryAdapter(prodSheetRows);
  const provider = new SandboxInventoryProvider({ inventoryAdapter: adapter });
  const uiState = new AllocationUIState();
  const gatewayClient = provider.createGatewayClient({ uiState });
  const demoCards = new SandboxDemoCards({ gatewayClient, uiState });

  return { adapter, provider, uiState, gatewayClient, demoCards };
}

// 1. Production HTML Template Structure Validation
runTest('Production AllocationAssistantView.html template contains sandbox warning banner and view panel', () => {
  const viewHtmlContent = fs.readFileSync(viewHtmlPath, 'utf8');

  assert.ok(viewHtmlContent.includes('id="view-allocation-sandbox"'));
  assert.ok(viewHtmlContent.includes('配貨建議試算 (唯讀沙盒模式)'));
  assert.ok(viewHtmlContent.includes('不寫入正式保留與 LINE 通知'));
});

// 2. Real-Sheet Snapshot Allocation Calculation & Batch Mixing Warning
runTest('Production sandbox provider calculates stock allocation from sheet snapshot and handles batch mixing warning', () => {
  const { demoCards, uiState } = createProdValidationEnvironment();

  const res = demoCards.loadDemoScenario('DEMO_GUJIA_575');
  assert.strictEqual(res.success, true);
  assert.strictEqual(uiState.rawOrderText, '顧佳 575 * 15');
  assert.ok(uiState.warnings.some(w => w.warningCode === 'BATCH_MIXING_REQUIRED' || w.code === 'BATCH_MIXING_REQUIRED'));
});

// 3. Absolute Write Interception (SANDBOX_WRITE_FORBIDDEN)
runTest('All formal write attempts inside Production Web App Sandbox throw SANDBOX_WRITE_FORBIDDEN', () => {
  const { provider } = createProdValidationEnvironment();

  assert.throws(() => {
    provider.executeFormalWrite({ draftId: 'prod_val_draft_001' });
  }, /SANDBOX_WRITE_FORBIDDEN/);
});

// 4. Webhook and Web App Isolation Safeguard
runTest('Production Apps Script Code.gs preserves isolated webhook handling logic', () => {
  const codeGsPath = path.join(rootDir, 'google-apps-script/Code.gs');
  const codeGsContent = fs.readFileSync(codeGsPath, 'utf8');

  assert.ok(codeGsContent.includes('function doPost('));
  assert.ok(codeGsContent.includes('handleLineWebhook'));
});

console.log(`\nAllocation Production Validation Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
