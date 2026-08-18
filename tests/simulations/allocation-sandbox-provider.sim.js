/**
 * Simulation Test: SandboxInventoryProvider & Snapshot Wireup (Pack 5B)
 */

const assert = require('assert');
const {
  SandboxInventoryProvider,
  MockSheetInventoryAdapter,
  AllocationUIState
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-sandbox-provider: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-sandbox-provider: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// Mock sheet raw rows for testing (115 Sheet Snapshot)
const sampleSheetRows = [
  ['品名與規格', '倉庫名稱', '批號', '可用數量', '單位'],
  ['APT-5201', '林口倉', '04', '5062', 'PCS'],
  ['STU-6101', '林口倉', 'J013', '2', 'PCS'],
  ['STU-6101', '忠義倉', 'J013', '1', 'PCS']
];

// 1. Sandbox Provider Wireup
runTest('SandboxInventoryProvider injects MockSheetInventoryAdapter into AllocationGatewayClient', () => {
  const mockAdapter = new MockSheetInventoryAdapter(sampleSheetRows);
  const provider = new SandboxInventoryProvider({ inventoryAdapter: mockAdapter });

  const uiState = new AllocationUIState();
  const client = provider.createGatewayClient({ uiState });

  assert.ok(client);
  assert.strictEqual(client.uiState, uiState);
  assert.strictEqual(provider.mode, 'READONLY_SANDBOX');
});

// 2. Immediate Evaluation based on Snapshot
runTest('submitting text through client generates allocation suggestion based on sheet snapshot', () => {
  const mockAdapter = new MockSheetInventoryAdapter(sampleSheetRows);
  const provider = new SandboxInventoryProvider({ inventoryAdapter: mockAdapter });
  const uiState = new AllocationUIState();
  const client = provider.createGatewayClient({ uiState });

  client.submitRawText('漢樺企業 APT-5201 * 10');

  assert.strictEqual(uiState.status, 'ALLOCATION_REVIEW');
  assert.strictEqual(uiState.suggestions.length, 1);
  assert.strictEqual(uiState.suggestions[0].productCode, 'APT-5201');
  assert.strictEqual(uiState.suggestions[0].warehouseName, '林口倉');
});

// 3. Batch Mixing Warning from Snapshot
runTest('single batch insufficiency in snapshot triggers BATCH_MIXING_REQUIRED warning', () => {
  const mockAdapter = new MockSheetInventoryAdapter(sampleSheetRows);
  const provider = new SandboxInventoryProvider({ inventoryAdapter: mockAdapter });
  const uiState = new AllocationUIState();
  const client = provider.createGatewayClient({ uiState });

  client.submitRawText('美麗空間 STU-6101 * 3');

  assert.strictEqual(uiState.status, 'ALLOCATION_REVIEW');
  assert.ok(uiState.warnings.some(w => w.warningCode === 'BATCH_MIXING_REQUIRED' || w.code === 'BATCH_MIXING_REQUIRED'));
});

// 4. Sandbox Write Interception
runTest('executeFormalWrite in SandboxInventoryProvider throws SANDBOX_WRITE_FORBIDDEN', () => {
  const provider = new SandboxInventoryProvider();

  assert.throws(() => {
    provider.executeFormalWrite({ draftId: 'draft_5b_test' });
  }, /SANDBOX_WRITE_FORBIDDEN/);
});

console.log(`\nAllocation Sandbox Provider Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
