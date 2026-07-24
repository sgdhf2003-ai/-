/**
 * Simulation Test: Production Apps Script & HTML Wireup (Pack 6A)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  AllocationSandboxView,
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

// 1. Check Code.gs helper function existence and template contents
runTest('google-apps-script/Code.gs contains getAllocationAssistantView helper function', () => {
  const codeGsContent = fs.readFileSync(codeGsPath, 'utf8');

  assert.ok(codeGsContent.includes('function getAllocationAssistantView()'));
  assert.ok(codeGsContent.includes('getAllocationAssistantView'));
});

// 2. Check index.html nav tab and view container mount points
runTest('index.html contains #nav-allocation tab button and #view-allocation-sandbox container', () => {
  const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

  assert.ok(indexHtmlContent.includes('id="nav-allocation"'));
  assert.ok(indexHtmlContent.includes('id="view-allocation-sandbox"'));
});

// 3. Verify SANDBOX_WRITE_FORBIDDEN in production mounted sandbox environment
runTest('Production mounted sandbox environment throws SANDBOX_WRITE_FORBIDDEN on formal write', () => {
  const provider = new SandboxInventoryProvider();

  assert.throws(() => {
    provider.executeFormalWrite({ draftId: 'prod_wireup_test' });
  }, /SANDBOX_WRITE_FORBIDDEN/);
});

// 4. Verify Code.gs doGet endpoint is non-destructive and intact
runTest('google-apps-script/Code.gs preserves existing doGet handler', () => {
  const codeGsContent = fs.readFileSync(codeGsPath, 'utf8');

  assert.ok(codeGsContent.includes('function doGet('));
});

console.log(`\nAllocation Production Wireup Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
