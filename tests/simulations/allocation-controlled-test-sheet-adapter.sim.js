/**
 * Simulation Test: Controlled Test Sheet Adapter Contract (Stage 24-B4-C/D)
 *
 * This suite uses an in-memory sheet client only. It must not call SpreadsheetApp,
 * UrlFetchApp, LINE APIs, Script Properties, or production wrappers.
 */

const assert = require('assert');
const {
  ControlledTestSheetReservationAdapter,
  FormalHoldWritebackAdapter,
  FulfillmentAdapter
} = require('../../allocation-assistant/index');

const TEST_HOLDS_HEADERS = FormalHoldWritebackAdapter.HOLDS_HEADERS;
const TEST_LEDGER_HEADERS = [
  'reservationNumber',
  'action',
  'item',
  'quantity',
  'remainingQuantity',
  'status',
  'updatedAt'
];

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-controlled-test-sheet-adapter: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-controlled-test-sheet-adapter: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

class InMemorySheetClient {
  constructor(options = {}) {
    this.headersBySheet = new Map(Object.entries(options.headersBySheet || {}));
    this.rowsBySheet = new Map();
    this.failMode = options.failMode || 'NONE';
  }

  getHeaders(sheetName) {
    if (this.failMode === 'PERMISSION_DENIED') {
      throw new Error('TEST_SHEET_PERMISSION_DENIED');
    }
    return (this.headersBySheet.get(sheetName) || []).slice();
  }

  appendRow(sheetName, rowData) {
    if (this.failMode === 'UNKNOWN_OUTCOME') {
      return { success: true, persisted: false, errorCode: 'TEST_SHEET_WRITE_OUTCOME_UNKNOWN' };
    }
    const rows = this.rowsBySheet.get(sheetName) || [];
    rows.push(rowData.slice());
    this.rowsBySheet.set(sheetName, rows);
    return { success: true, persisted: true, rowIndex: rows.length };
  }

  findRowById(sheetName, id) {
    const headers = this.getHeaders(sheetName);
    const rows = this.rowsBySheet.get(sheetName) || [];
    const idIndex = headers.indexOf('id');
    const rowIndex = rows.findIndex(row => row[idIndex] === id);
    if (rowIndex === -1) return { found: false };
    return {
      found: true,
      rowIndex: rowIndex + 1,
      rowData: rows[rowIndex].slice(),
      record: Object.fromEntries(headers.map((header, index) => [header, rows[rowIndex][index]]))
    };
  }

  updateRowById(sheetName, id, updates) {
    const headers = this.getHeaders(sheetName);
    const rows = this.rowsBySheet.get(sheetName) || [];
    const idIndex = headers.indexOf('id');
    const rowIndex = rows.findIndex(row => row[idIndex] === id);
    if (rowIndex === -1) return { success: false, persisted: false, errorCode: 'HOLD_NOT_FOUND' };
    const nextRow = rows[rowIndex].slice();
    Object.entries(updates).forEach(([key, value]) => {
      const colIndex = headers.indexOf(key);
      if (colIndex !== -1) nextRow[colIndex] = value;
    });
    rows[rowIndex] = nextRow;
    this.rowsBySheet.set(sheetName, rows);
    return {
      success: true,
      persisted: true,
      rowIndex: rowIndex + 1,
      rowData: nextRow.slice(),
      record: Object.fromEntries(headers.map((header, index) => [header, nextRow[index]]))
    };
  }

  appendLedgerEntry(sheetName, entry, headers) {
    return this.appendRow(sheetName, headers.map(header => entry[header]));
  }

  getRows(sheetName) {
    return (this.rowsBySheet.get(sheetName) || []).map(row => row.slice());
  }
}

function createConfig(overrides = {}) {
  const values = {
    JYAI_ALLOCATION_TEST_SPREADSHEET_ID: 'test-sheet-id-redacted',
    JYAI_ALLOCATION_TEST_HOLDS_SHEET_NAME: 'holds_test',
    JYAI_ALLOCATION_TEST_LEDGER_SHEET_NAME: 'ledger_test',
    ...overrides
  };
  return {
    get(name) {
      return values[name] || '';
    }
  };
}

function createAdapter(options = {}) {
  const sheetClient = options.sheetClient || new InMemorySheetClient({
    headersBySheet: {
      holds_test: TEST_HOLDS_HEADERS,
      ledger_test: TEST_LEDGER_HEADERS
    }
  });
  return {
    adapter: new ControlledTestSheetReservationAdapter({
      configProvider: options.configProvider || createConfig(),
      sheetClient
    }),
    sheetClient
  };
}

function createHoldPayload(overrides = {}) {
  return {
    reservationNumber: 'RES-20260729-901',
    storeId: 'store_test_001',
    storeName: '測試門市',
    salesOwner: '測試助理',
    productCode: 'EQA-6522',
    quantity: 12,
    warehouseName: '測試倉',
    batchNumber: 'TEST-BATCH',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    ...overrides
  };
}

runTest('ControlledTestSheetReservationAdapter is exported and requires explicit config', () => {
  assert.strictEqual(typeof ControlledTestSheetReservationAdapter, 'function');

  const adapter = new ControlledTestSheetReservationAdapter({
    configProvider: createConfig({ JYAI_ALLOCATION_TEST_SPREADSHEET_ID: '' }),
    sheetClient: new InMemorySheetClient()
  });

  const result = adapter.appendHoldRecord({ id: 'RES-20260729-000' }, { headers: TEST_HOLDS_HEADERS });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'TEST_SHEET_CONFIG_MISSING');
});

runTest('Controlled test formal hold writeback persists and readbacks matching row id', () => {
  const { adapter, sheetClient } = createAdapter();
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });
  const result = writeback.executeWriteback(createHoldPayload());

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.persisted, true);
  assert.strictEqual(result.reservationNumber, result.holdRecord.id);
  assert.strictEqual(result.rowData[0], result.reservationNumber);
  assert.strictEqual(sheetClient.getRows('holds_test').length, 1);

  const persisted = adapter.queryHoldByReservationNumber(result.reservationNumber);
  assert.strictEqual(persisted.found, true);
  assert.strictEqual(persisted.record.id, result.reservationNumber);
});

runTest('Controlled test replay with same payload does not duplicate rows', () => {
  const { adapter, sheetClient } = createAdapter();
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });
  const payload = createHoldPayload({ reservationNumber: 'RES-20260729-902' });

  const first = writeback.executeWriteback(payload);
  const second = writeback.executeWriteback(payload);

  assert.strictEqual(first.success, true);
  assert.strictEqual(second.success, true);
  assert.strictEqual(second.isReplay, true);
  assert.strictEqual(sheetClient.getRows('holds_test').length, 1);
});

runTest('Controlled test replay with conflicting payload fails closed', () => {
  const { adapter, sheetClient } = createAdapter();
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });

  const first = writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-903' }));
  const conflicting = writeback.executeWriteback(createHoldPayload({
    reservationNumber: 'RES-20260729-903',
    quantity: 20
  }));

  assert.strictEqual(first.success, true);
  assert.strictEqual(conflicting.success, false);
  assert.strictEqual(conflicting.errorCode, 'HOLD_IDEMPOTENCY_CONFLICT');
  assert.strictEqual(sheetClient.getRows('holds_test').length, 1);
});

runTest('Controlled test adapter fails closed before append on header mismatch', () => {
  const sheetClient = new InMemorySheetClient({
    headersBySheet: {
      holds_test: TEST_HOLDS_HEADERS.filter(header => header !== 'status'),
      ledger_test: TEST_LEDGER_HEADERS
    }
  });
  const { adapter } = createAdapter({ sheetClient });
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });
  const result = writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-904' }));

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'HOLD_SCHEMA_MISMATCH');
  assert.strictEqual(sheetClient.getRows('holds_test').length, 0);
});

runTest('Controlled test adapter fails closed on permission failure', () => {
  const { adapter } = createAdapter({
    sheetClient: new InMemorySheetClient({
      headersBySheet: {
        holds_test: TEST_HOLDS_HEADERS,
        ledger_test: TEST_LEDGER_HEADERS
      },
      failMode: 'PERMISSION_DENIED'
    })
  });
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });
  const result = writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-905' }));

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'TEST_SHEET_PERMISSION_DENIED');
});

runTest('Controlled test adapter fails closed on unknown write outcome', () => {
  const { adapter } = createAdapter({
    sheetClient: new InMemorySheetClient({
      headersBySheet: {
        holds_test: TEST_HOLDS_HEADERS,
        ledger_test: TEST_LEDGER_HEADERS
      },
      failMode: 'UNKNOWN_OUTCOME'
    })
  });
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });
  const result = writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-906' }));

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'TEST_SHEET_WRITE_OUTCOME_UNKNOWN');
});

runTest('Controlled test fulfillment persists full partial and cancel ledger semantics', () => {
  const { adapter, sheetClient } = createAdapter();
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });
  const fulfillment = new FulfillmentAdapter({ sheetAdapter: adapter });

  writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-911', quantity: 10 }));
  writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-912', quantity: 15 }));
  writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-913', quantity: 6 }));

  const full = fulfillment.processFulfillment({
    reservationNumber: 'RES-20260729-911',
    action: 'FULL_FULFILL'
  });
  const partial = fulfillment.processFulfillment({
    reservationNumber: 'RES-20260729-912',
    action: 'PARTIAL_FULFILL',
    fulfilledQuantity: 5,
    totalQuantity: 15
  });
  const cancel = fulfillment.processFulfillment({
    reservationNumber: 'RES-20260729-913',
    action: 'CANCEL_FULFILL'
  });

  assert.strictEqual(full.success, true);
  assert.strictEqual(partial.success, true);
  assert.strictEqual(cancel.success, true);

  const ledgerRows = sheetClient.getRows('ledger_test');
  assert.deepStrictEqual(ledgerRows.map(row => row[1]), [
    'FULFILL_DEDUCT',
    'PARTIAL_FULFILL_DEDUCT',
    'CANCEL_RELEASE'
  ]);
  assert.deepStrictEqual(ledgerRows.map(row => row[3]), [10, 5, 6]);
  assert.strictEqual(ledgerRows[2][4], 6);
});

console.log(`\nControlled Test Sheet Adapter Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
