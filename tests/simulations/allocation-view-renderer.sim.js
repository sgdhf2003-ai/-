/**
 * Simulation Test: AllocationViewRenderer & Approval Controls (Pack 3C)
 */

const assert = require('assert');
const {
  AllocationViewRenderer,
  AllocationUIState
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-view-renderer: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-view-renderer: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Summary Card Rendering
runTest('renderDraftSummaryCard renders HTML card structure with status badge', () => {
  const uiState = new AllocationUIState();
  uiState.setRawOrderText('EQA-6522 * 10');
  uiState.updateFromAnalysis({
    status: 'ALLOCATION_REVIEW',
    suggestion: {
      suggestionId: 'sug_3c_1',
      draftId: 'draft_3c_1',
      suggestions: [
        { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', allocatedQuantity: 10 }
      ],
      warnings: [],
      rationale: 'Single warehouse selected'
    }
  });

  const html = AllocationViewRenderer.renderDraftSummaryCard(uiState);
  assert.ok(html.includes('badge-allocation-review'));
  assert.ok(html.includes('EQA-6522'));
  assert.ok(html.includes('林口倉'));
  assert.ok(html.includes('7J25'));
});

// 2. Warning & Toggle Block Rendering
runTest('renderWarningsAndToggles renders warning banner and toggle switch', () => {
  const uiState = new AllocationUIState();
  uiState.updateFromAnalysis({
    status: 'ALLOCATION_REVIEW',
    suggestion: {
      suggestionId: 'sug_3c_2',
      draftId: 'draft_3c_2',
      suggestions: [],
      warnings: [
        { warningCode: 'BATCH_MIXING_REQUIRED', severity: 'WARNING', message: 'Batch mixing consent required' }
      ],
      rationale: ''
    }
  });

  const html = AllocationViewRenderer.renderWarningsAndToggles(uiState);
  assert.ok(html.includes('alert-batch-mixing-required'));
  assert.ok(html.includes('input-mixed-batch-toggle'));
});

// 3. Approval Readiness Checklist Validation
runTest('validateApprovalReadiness blocks approval on OCR_REVIEW or INSUFFICIENT_STOCK', () => {
  const uiState = new AllocationUIState();

  // OCR_REVIEW state
  uiState.status = 'OCR_REVIEW';
  let check = AllocationViewRenderer.validateApprovalReadiness(uiState);
  assert.strictEqual(check.ready, false);
  assert.ok(check.reason.includes('OCR'));

  // INSUFFICIENT_STOCK warning
  uiState.status = 'ALLOCATION_REVIEW';
  uiState.warnings = [{ warningCode: 'INSUFFICIENT_STOCK', severity: 'CRITICAL', message: 'Out of stock' }];
  check = AllocationViewRenderer.validateApprovalReadiness(uiState);
  assert.strictEqual(check.ready, false);
  assert.ok(check.reason.includes('INSUFFICIENT_STOCK'));

  // Ready case
  uiState.warnings = [];
  uiState.suggestions = [{ productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', allocatedQuantity: 10 }];
  check = AllocationViewRenderer.validateApprovalReadiness(uiState);
  assert.strictEqual(check.ready, true);
});

// 4. Locked State Rendering Markers
runTest('rendered templates include disabled markers when uiState.isLocked is true', () => {
  const uiState = new AllocationUIState();
  uiState.setRawOrderText('EQA-6522 * 10');
  uiState.confirm();

  const html = AllocationViewRenderer.renderDraftSummaryCard(uiState);
  assert.ok(html.includes('disabled'));
  assert.ok(html.includes('is-locked'));
});

console.log(`\nAllocation View Renderer Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
