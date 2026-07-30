/**
 * Simulation Test: Production Apps Script & HTML Wireup (Pack 6A / Dispatcher Fix)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  SandboxInventoryProvider
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-production-wireup: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-production-wireup: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

const rootDir = path.resolve(__dirname, '../../');
const codeGsPath = path.join(rootDir, 'google-apps-script/Code.gs');
const indexHtmlPath = path.join(rootDir, 'index.html');
const gasIndexHtmlPath = path.join(rootDir, 'google-apps-script/Index.html');

// 1. Check Code.gs helper function existence
runTest('google-apps-script/Code.gs contains getAllocationAssistantView, include, and runAllocationProductionAdapterRuntimeProof_B8 functions', () => {
  const codeGsContent = fs.readFileSync(codeGsPath, 'utf8');

  assert.ok(codeGsContent.includes('function getAllocationAssistantView()'));
  assert.ok(codeGsContent.includes('function include('));
  assert.ok(codeGsContent.includes('function runAllocationProductionAdapterRuntimeProof_B8('));
});

// 2. Check index.html nav tab and view container mount points
runTest('index.html contains #nav-allocation tab button and #view-allocation-sandbox container', () => {
  const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

  assert.ok(indexHtmlContent.includes('id="nav-allocation"'));
  assert.ok(indexHtmlContent.includes('id="view-allocation-sandbox"'));
});

// 3. Check google-apps-script/Index.html exists and is mounted
runTest('google-apps-script/Index.html template exists with allocation sandbox mount', () => {
  const gasIndexHtmlContent = fs.readFileSync(gasIndexHtmlPath, 'utf8');

  assert.ok(gasIndexHtmlContent.includes('id="nav-allocation"'));
  assert.ok(gasIndexHtmlContent.includes('id="view-allocation-sandbox"'));
});

// 4. Verify SANDBOX_WRITE_FORBIDDEN in production mounted sandbox environment
runTest('Production mounted sandbox environment throws SANDBOX_WRITE_FORBIDDEN on formal write', () => {
  const provider = new SandboxInventoryProvider();

  assert.throws(() => {
    provider.executeFormalWrite({ draftId: 'prod_wireup_test' });
  }, /SANDBOX_WRITE_FORBIDDEN/);
});

// 5. Verify Code.gs doGet route dispatcher logic for Web App vs API
runTest('google-apps-script/Code.gs contains dual route dispatcher for Web App HTML and JSON API', () => {
  const codeGsContent = fs.readFileSync(codeGsPath, 'utf8');

  assert.ok(codeGsContent.includes('function doGet('));
  assert.ok(codeGsContent.includes('if (data && data.action)'));
  assert.ok(codeGsContent.includes('HtmlService.createTemplateFromFile("Index")'));
});

// 6. Verify Stage 24-B9 Boundary 3A test_b8_readiness gated action route and execution key protection
runTest('google-apps-script/Code.gs contains test_b8_readiness action route and testB8ReadinessAction function with key protection', () => {
  const codeGsContent = fs.readFileSync(codeGsPath, 'utf8');

  assert.ok(codeGsContent.includes('if (action === "test_b8_readiness") return jsonOutput(testB8ReadinessAction(data));'));
  assert.ok(codeGsContent.includes('function testB8ReadinessAction(data)'));
  assert.ok(codeGsContent.includes('errorCode: "MISSING_EXECUTION_KEY"'));
  assert.ok(codeGsContent.includes('errorCode: "INVALID_EXECUTION_KEY"'));
  assert.ok(!codeGsContent.includes('req.provisionSchema === true'));
  assert.ok(codeGsContent.includes('return runAllocationProductionAdapterRuntimeProof_B8({ mode: "READINESS_CHECK" });'));
});

console.log(`\nAllocation Production Wireup Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
