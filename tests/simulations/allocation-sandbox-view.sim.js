/**
 * Simulation Test: AllocationSandboxView & Warning Banner (Pack 5A)
 */

const assert = require('assert');
const {
  AllocationSandboxView,
  AllocationUIState
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-sandbox-view: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-sandbox-view: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Sandbox Container DOM Structure
runTest('renderSandboxContainer outputs DOM template with #view-allocation-sandbox container', () => {
  const uiState = new AllocationUIState();
  const sandboxView = new AllocationSandboxView({ uiState });

  const html = sandboxView.renderSandboxContainer();
  assert.ok(html.includes('id="view-allocation-sandbox"'));
  assert.ok(html.includes('id="nav-allocation"'));
  assert.ok(html.includes('sandbox-workspace'));
});

// 2. Yellow Warning Banner Disclaimer
runTest('renderWarningBanner renders amber warning banner with sandbox disclaimer', () => {
  const sandboxView = new AllocationSandboxView();

  const bannerHtml = sandboxView.renderWarningBanner();
  assert.ok(bannerHtml.includes('配貨建議試算 (唯讀沙盒模式)'));
  assert.ok(bannerHtml.includes('不寫入正式保留與 LINE 通知'));
  assert.ok(bannerHtml.includes('sandbox-banner-amber'));
});

// 3. Tab Navigation & DOM Isolation
runTest('switchTab isolates allocation sandbox view from other tab IDs', () => {
  const sandboxView = new AllocationSandboxView();

  const tabState = sandboxView.switchTab('nav-allocation');
  assert.strictEqual(tabState.activeTabId, 'nav-allocation');
  assert.strictEqual(tabState.activeViewId, 'view-allocation-sandbox');
  assert.deepStrictEqual(tabState.hiddenViewIds, ['view-tasks', 'view-reservations']);
});

// 4. Sandbox Mode Write Masking
runTest('AllocationSandboxView marks formal reservation submission as read-only sandbox mode', () => {
  const uiState = new AllocationUIState();
  const sandboxView = new AllocationSandboxView({ uiState });

  const controlsHtml = sandboxView.renderSandboxControls();
  assert.ok(controlsHtml.includes('disabled') || controlsHtml.includes('read-only'));
  assert.ok(controlsHtml.includes('SANDBOX_MODE_ONLY'));
});

console.log(`\nAllocation Sandbox View Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
