/**
 * Simulation Test: AllocationUIState & ViewModel (Pack 3A)
 */

const assert = require('assert');
const { AllocationUIState } = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-ui-state: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-ui-state: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Initial State & Raw Text Input
runTest('AllocationUIState initializes in DRAFT state and updates rawOrderText', () => {
  const uiState = new AllocationUIState();
  assert.strictEqual(uiState.status, 'DRAFT');
  assert.strictEqual(uiState.isLocked, false);

  uiState.setRawOrderText('EQA-6522 * 10');
  assert.strictEqual(uiState.rawOrderText, 'EQA-6522 * 10');
});

// 2. ViewModel Update from Suggestion Output
runTest('AllocationUIState updates ViewModel from suggestion payload', () => {
  const uiState = new AllocationUIState();
  uiState.setRawOrderText('EQA-6522 * 10');

  uiState.updateFromAnalysis({
    status: 'ALLOCATION_REVIEW',
    suggestion: {
      suggestionId: 'sug_test_100',
      draftId: 'draft_100',
      suggestions: [
        { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', allocatedQuantity: 10 }
      ],
      warnings: [
        { warningCode: 'PHYSICAL_COUNT_UNCONFIRMED', severity: 'INFO', message: 'Unconfirmed physical count' }
      ],
      rationale: 'Single warehouse selected'
    }
  });

  assert.strictEqual(uiState.status, 'ALLOCATION_REVIEW');
  assert.strictEqual(uiState.suggestions.length, 1);
  assert.strictEqual(uiState.warnings.length, 1);
  assert.strictEqual(uiState.suggestions[0].warehouseName, '林口倉');
});

// 3. Customer Mixed Batch Consent Toggle
runTest('toggling customerApprovedMixedBatch updates consent state', () => {
  const uiState = new AllocationUIState();
  assert.strictEqual(uiState.customerApprovedMixedBatch, false);

  uiState.setCustomerApprovedMixedBatch(true);
  assert.strictEqual(uiState.customerApprovedMixedBatch, true);
});

// 4. Confirmation Lock Mechanics
runTest('confirmAllocation transitions state to ALLOCATION_CONFIRMED and sets isLocked = true', () => {
  const uiState = new AllocationUIState();
  uiState.setRawOrderText('EQA-6522 * 10');
  uiState.updateFromAnalysis({
    status: 'ALLOCATION_REVIEW',
    suggestion: { suggestionId: 'sug_100', draftId: 'draft_100', suggestions: [], warnings: [], rationale: '' }
  });

  uiState.confirm();
  assert.strictEqual(uiState.status, 'ALLOCATION_CONFIRMED');
  assert.strictEqual(uiState.isLocked, true);

  // Attempting to modify locked state throws error
  assert.throws(() => {
    uiState.setRawOrderText('MODIFIED');
  }, /LOCKED_STATE_MUTATION/);
});

// 5. Cancel Mechanics & Invalid Transitions
runTest('cancel transitions state to CANCELLED and blocks invalid transitions', () => {
  const uiState = new AllocationUIState();
  uiState.cancel();
  assert.strictEqual(uiState.status, 'CANCELLED');
  assert.strictEqual(uiState.isLocked, true);

  assert.throws(() => {
    uiState.confirm();
  }, /INVALID_STATE_TRANSITION/);
});

console.log(`\nAllocation UI State Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
