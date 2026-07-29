/**
 * Simulation Test: Production Sheet Readiness Diagnostics (Stage 24-B4-D3/D4)
 *
 * This suite is local-only. It does not read Script Properties values, call
 * SpreadsheetApp, write Sheets, execute Apps Script wrappers, or call LINE APIs.
 */

const assert = require('assert');
const {
  ControlledTestSheetReservationAdapter,
  FormalHoldWritebackAdapter,
  MockFormalReservationAdapter,
  ProductionSheetReadinessDiagnostics
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-production-readiness-diagnostics: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-production-readiness-diagnostics: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

class HeaderClient {
  constructor(options = {}) {
    this.headersBySheet = options.headersBySheet || {
      holds: FormalHoldWritebackAdapter.HOLDS_HEADERS,
      ledger: ControlledTestSheetReservationAdapter.LEDGER_HEADERS
    };
    this.failMode = options.failMode || 'NONE';
  }

  getHeaders(sheetName) {
    if (this.failMode === 'PERMISSION_DENIED') {
      throw new Error('PRODUCTION_SHEET_PERMISSION_DENIED');
    }
    if (this.failMode === 'API_FAILURE') {
      throw new Error('PRODUCTION_SHEET_API_FAILURE');
    }
    return (this.headersBySheet[sheetName] || []).slice();
  }
}

function createConfigPresence(overrides = {}) {
  const names = ProductionSheetReadinessDiagnostics.PRODUCTION_CONFIG_NAMES;
  return {
    [names.spreadsheetId]: true,
    [names.holdsSheetName]: true,
    [names.ledgerSheetName]: true,
    ...overrides
  };
}

function createProductionAdapter(overrides = {}) {
  return {
    appendHoldRecord() {},
    queryHoldByReservationNumber() {},
    updateHoldStatus() {},
    recordInventoryAdjustment() {},
    ...overrides
  };
}

runTest('Production readiness diagnostics exports redacted production config names only', () => {
  const names = ProductionSheetReadinessDiagnostics.PRODUCTION_CONFIG_NAMES;

  assert.strictEqual(names.spreadsheetId, 'JYAI_ALLOCATION_PRODUCTION_SPREADSHEET_ID');
  assert.strictEqual(names.holdsSheetName, 'JYAI_ALLOCATION_PRODUCTION_HOLDS_SHEET_NAME');
  assert.strictEqual(names.ledgerSheetName, 'JYAI_ALLOCATION_PRODUCTION_LEDGER_SHEET_NAME');
});

runTest('Missing production config fails closed without printing values', () => {
  const diagnostics = new ProductionSheetReadinessDiagnostics();
  const names = ProductionSheetReadinessDiagnostics.PRODUCTION_CONFIG_NAMES;
  const result = diagnostics.checkConfigPresence(createConfigPresence({
    [names.spreadsheetId]: false
  }));

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'PRODUCTION_SHEET_CONFIG_MISSING');
  assert.strictEqual(result.redacted, true);
  assert.ok(result.missingNames.includes(names.spreadsheetId));
});

runTest('Missing production adapter fails closed', () => {
  const diagnostics = new ProductionSheetReadinessDiagnostics();
  const result = diagnostics.checkAdapterBoundary(null);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'PRODUCTION_SHEET_ADAPTER_MISSING');
});

runTest('Implicit mock adapter is forbidden for production readiness', () => {
  const diagnostics = new ProductionSheetReadinessDiagnostics();
  const result = diagnostics.checkAdapterBoundary(new MockFormalReservationAdapter());

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'PRODUCTION_MOCK_ADAPTER_FORBIDDEN');
});

runTest('Missing production adapter capability fails closed', () => {
  const diagnostics = new ProductionSheetReadinessDiagnostics();
  const result = diagnostics.checkAdapterBoundary(createProductionAdapter({
    recordInventoryAdjustment: undefined
  }));

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'PRODUCTION_SHEET_ADAPTER_CAPABILITY_MISSING');
  assert.ok(result.missingMethods.includes('recordInventoryAdjustment'));
});

runTest('Header mismatch fails before append/update boundary', () => {
  const diagnostics = new ProductionSheetReadinessDiagnostics();
  const result = diagnostics.checkHeaderBoundary(new HeaderClient({
    headersBySheet: {
      holds: FormalHoldWritebackAdapter.HOLDS_HEADERS.filter(header => header !== 'status'),
      ledger: ControlledTestSheetReservationAdapter.LEDGER_HEADERS
    }
  }));

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'HOLD_SCHEMA_MISMATCH');
});

runTest('Permission and API failures map to explicit fail-closed errors', () => {
  const diagnostics = new ProductionSheetReadinessDiagnostics();
  const permission = diagnostics.checkHeaderBoundary(new HeaderClient({ failMode: 'PERMISSION_DENIED' }));
  const api = diagnostics.checkHeaderBoundary(new HeaderClient({ failMode: 'API_FAILURE' }));

  assert.strictEqual(permission.success, false);
  assert.strictEqual(permission.errorCode, 'PRODUCTION_SHEET_PERMISSION_DENIED');
  assert.strictEqual(api.success, false);
  assert.strictEqual(api.errorCode, 'PRODUCTION_SHEET_API_FAILURE');
});

runTest('Success receipt requires persisted confirmation and ID equality', () => {
  const diagnostics = new ProductionSheetReadinessDiagnostics();
  const ok = diagnostics.checkWriteReceipt({
    success: true,
    persisted: true,
    confirmed: true,
    reservationNumber: 'RES-20260729-981',
    holdRecord: { id: 'RES-20260729-981' },
    rowData: ['RES-20260729-981'],
    readbackRecord: { id: 'RES-20260729-981' }
  });
  const mismatch = diagnostics.checkWriteReceipt({
    success: true,
    persisted: true,
    confirmed: true,
    reservationNumber: 'RES-20260729-981',
    holdRecord: { id: 'RES-20260729-981' },
    rowData: ['RES-20260729-982'],
    readbackRecord: { id: 'RES-20260729-981' }
  });

  assert.strictEqual(ok.success, true);
  assert.strictEqual(mismatch.success, false);
  assert.strictEqual(mismatch.errorCode, 'PRODUCTION_WRITE_ID_MISMATCH');
});

runTest('Unknown write outcome cannot return success without confirmed readback', () => {
  const diagnostics = new ProductionSheetReadinessDiagnostics();
  const result = diagnostics.checkWriteReceipt({
    success: true,
    persisted: false,
    confirmed: false,
    reservationNumber: 'RES-20260729-983'
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'PRODUCTION_WRITE_CONFIRMATION_MISSING');
});

runTest('CANCEL_RELEASE quantity remains released quantity and keeps remainingQuantity context', () => {
  const diagnostics = new ProductionSheetReadinessDiagnostics();
  const ok = diagnostics.checkFulfillmentLedgerEntry({
    action: 'CANCEL_RELEASE',
    quantity: 6,
    remainingQuantity: 6
  });
  const invalidZeroQuantity = diagnostics.checkFulfillmentLedgerEntry({
    action: 'CANCEL_RELEASE',
    quantity: 0,
    remainingQuantity: 6
  });

  assert.strictEqual(ok.success, true);
  assert.strictEqual(invalidZeroQuantity.success, false);
  assert.strictEqual(invalidZeroQuantity.errorCode, 'CANCEL_RELEASE_QUANTITY_INVALID');
});

console.log(`\nProduction Readiness Diagnostics Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
