/**
 * Simulation Test: Production Sheet Reservation Adapter (Stage 24-B6)
 *
 * This suite uses an in-memory sheet client only. It does not call
 * SpreadsheetApp, read Script Properties, write production Sheets, execute
 * Apps Script wrappers, or call LINE APIs.
 */

const assert = require('assert');
const {
  FormalHoldWritebackAdapter,
  FulfillmentAdapter,
  MockFormalReservationAdapter,
  ProductionSheetReservationAdapter
} = require('../../allocation-assistant/index');

const PRODUCTION_HOLDS_HEADERS = FormalHoldWritebackAdapter.HOLDS_HEADERS;
const PRODUCTION_LEDGER_HEADERS = ProductionSheetReservationAdapter.LEDGER_HEADERS;

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-production-sheet-adapter: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-production-sheet-adapter: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

class InMemoryProductionSheetClient {
  constructor(options = {}) {
    this.headersBySheet = new Map(Object.entries(options.headersBySheet || {}));
    this.rowsBySheet = new Map();
    this.failMode = options.failMode || 'NONE';
    this.calls = [];
  }

  getHeaders(sheetName) {
    this.calls.push(['getHeaders', sheetName]);
    if (this.failMode === 'PERMISSION_DENIED') {
      throw new Error('Permission denied');
    }
    if (this.failMode === 'API_FAILURE') {
      throw new Error('Sheets API failure');
    }
    return (this.headersBySheet.get(sheetName) || []).slice();
  }

  appendRow(sheetName, rowData) {
    this.calls.push(['appendRow', sheetName]);
    if (this.failMode === 'UNKNOWN_OUTCOME') {
      return { success: true, persisted: false, errorCode: 'PRODUCTION_WRITE_OUTCOME_UNKNOWN' };
    }
    const rows = this.rowsBySheet.get(sheetName) || [];
    rows.push(rowData.slice());
    this.rowsBySheet.set(sheetName, rows);
    return {
      success: true,
      persisted: true,
      rowIndex: rows.length,
      rowData: rowData.slice()
    };
  }

  findRowById(sheetName, id) {
    this.calls.push(['findRowById', sheetName]);
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
    this.calls.push(['updateRowById', sheetName]);
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
    this.calls.push(['appendLedgerEntry', sheetName]);
    return this.appendRow(sheetName, headers.map(header => entry[header]));
  }

  getRows(sheetName) {
    return (this.rowsBySheet.get(sheetName) || []).map(row => row.slice());
  }

  countCalls(name) {
    return this.calls.filter(call => call[0] === name).length;
  }
}

function createConfig(overrides = {}) {
  const names = ProductionSheetReservationAdapter.PRODUCTION_SHEET_PROPERTY_NAMES;
  const values = {
    [names.spreadsheetId]: 'redacted-production-sheet-id',
    [names.holdsSheetName]: 'holds',
    [names.ledgerSheetName]: 'ledger',
    ...overrides
  };
  return {
    get(name) {
      return values[name] || '';
    }
  };
}

function createClient(options = {}) {
  return new InMemoryProductionSheetClient({
    headersBySheet: {
      holds: PRODUCTION_HOLDS_HEADERS,
      ledger: PRODUCTION_LEDGER_HEADERS,
      ...(options.headersBySheet || {})
    },
    failMode: options.failMode || 'NONE'
  });
}

function createAdapter(options = {}) {
  const sheetClient = options.sheetClient || createClient();
  return {
    adapter: new ProductionSheetReservationAdapter({
      configProvider: options.configProvider || createConfig(),
      sheetClient
    }),
    sheetClient
  };
}

function createHoldPayload(overrides = {}) {
  return {
    reservationNumber: 'RES-20260729-951',
    storeId: 'store_prod_001',
    storeName: 'Production Readiness Store',
    salesOwner: 'Admin',
    productCode: 'EQA-6522',
    quantity: 12,
    warehouseName: 'holds',
    batchNumber: 'B6',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    ...overrides
  };
}

runTest('ProductionSheetReservationAdapter exports production config names only', () => {
  const names = ProductionSheetReservationAdapter.PRODUCTION_SHEET_PROPERTY_NAMES;

  assert.strictEqual(names.spreadsheetId, 'JYAI_ALLOCATION_PRODUCTION_SPREADSHEET_ID');
  assert.strictEqual(names.holdsSheetName, 'JYAI_ALLOCATION_PRODUCTION_HOLDS_SHEET_NAME');
  assert.strictEqual(names.ledgerSheetName, 'JYAI_ALLOCATION_PRODUCTION_LEDGER_SHEET_NAME');
});

runTest('Production adapter requires explicit config and sheet client', () => {
  const noConfig = new ProductionSheetReservationAdapter({
    sheetClient: createClient()
  });
  const noClient = new ProductionSheetReservationAdapter({
    configProvider: createConfig()
  });

  assert.strictEqual(noConfig.appendHoldRecord({ id: 'RES-20260729-950' }).errorCode, 'PRODUCTION_SHEET_CONFIG_MISSING');
  assert.strictEqual(noClient.appendHoldRecord({ id: 'RES-20260729-950' }).errorCode, 'PRODUCTION_SHEET_CLIENT_MISSING');
});

runTest('Production adapter is independent from mock adapter and does not silently activate mock', () => {
  const mock = new MockFormalReservationAdapter();
  const production = new ProductionSheetReservationAdapter({
    configProvider: createConfig(),
    sheetClient: createClient()
  });

  assert.notStrictEqual(production.constructor.name, mock.constructor.name);
  assert.strictEqual(mock.holdsStore.size, 0);
});

runTest('Formal hold writeback persists with readback and matching IDs', () => {
  const { adapter, sheetClient } = createAdapter();
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });
  const result = writeback.executeWriteback(createHoldPayload());

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.persisted, true);
  assert.strictEqual(result.reservationNumber, result.holdRecord.id);
  assert.strictEqual(result.rowData[0], result.reservationNumber);
  assert.strictEqual(sheetClient.getRows('holds').length, 1);

  const persisted = adapter.queryHoldByReservationNumber(result.reservationNumber);
  assert.strictEqual(persisted.found, true);
  assert.strictEqual(persisted.record.id, result.reservationNumber);
});

runTest('Same payload replay returns replay result and creates no duplicate row', () => {
  const { adapter, sheetClient } = createAdapter();
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });
  const payload = createHoldPayload({ reservationNumber: 'RES-20260729-952' });

  const first = writeback.executeWriteback(payload);
  const second = writeback.executeWriteback(payload);

  assert.strictEqual(first.success, true);
  assert.strictEqual(second.success, true);
  assert.strictEqual(second.isReplay, true);
  assert.strictEqual(sheetClient.getRows('holds').length, 1);
});

runTest('Conflicting replay fails closed before duplicate append', () => {
  const { adapter, sheetClient } = createAdapter();
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });

  const first = writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-953' }));
  const conflict = writeback.executeWriteback(createHoldPayload({
    reservationNumber: 'RES-20260729-953',
    quantity: 20
  }));

  assert.strictEqual(first.success, true);
  assert.strictEqual(conflict.success, false);
  assert.strictEqual(conflict.errorCode, 'HOLD_IDEMPOTENCY_CONFLICT');
  assert.strictEqual(sheetClient.getRows('holds').length, 1);
});

runTest('Header mismatch fails before append', () => {
  const sheetClient = createClient({
    headersBySheet: {
      holds: PRODUCTION_HOLDS_HEADERS.filter(header => header !== 'status')
    }
  });
  const { adapter } = createAdapter({ sheetClient });
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });
  const result = writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-954' }));

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'HOLD_SCHEMA_MISMATCH');
  assert.strictEqual(sheetClient.countCalls('appendRow'), 0);
});

runTest('Permission and API failures fail closed with explicit production errors', () => {
  const permission = createAdapter({ sheetClient: createClient({ failMode: 'PERMISSION_DENIED' }) });
  const api = createAdapter({ sheetClient: createClient({ failMode: 'API_FAILURE' }) });

  const permissionResult = new FormalHoldWritebackAdapter({ sheetAdapter: permission.adapter })
    .executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-955' }));
  const apiResult = new FormalHoldWritebackAdapter({ sheetAdapter: api.adapter })
    .executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-956' }));

  assert.strictEqual(permissionResult.success, false);
  assert.strictEqual(permissionResult.errorCode, 'PRODUCTION_SHEET_PERMISSION_DENIED');
  assert.strictEqual(apiResult.success, false);
  assert.strictEqual(apiResult.errorCode, 'PRODUCTION_SHEET_API_FAILURE');
});

runTest('Unknown write outcome cannot return assistant-facing success', () => {
  const { adapter } = createAdapter({
    sheetClient: createClient({ failMode: 'UNKNOWN_OUTCOME' })
  });
  const result = new FormalHoldWritebackAdapter({ sheetAdapter: adapter })
    .executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-957' }));

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'PRODUCTION_WRITE_OUTCOME_UNKNOWN');
});

runTest('Fulfillment persists full partial and cancel ledger semantics', () => {
  const { adapter, sheetClient } = createAdapter();
  const writeback = new FormalHoldWritebackAdapter({ sheetAdapter: adapter });
  const fulfillment = new FulfillmentAdapter({ sheetAdapter: adapter });

  writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-961', quantity: 10 }));
  writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-962', quantity: 15 }));
  writeback.executeWriteback(createHoldPayload({ reservationNumber: 'RES-20260729-963', quantity: 6 }));

  const full = fulfillment.processFulfillment({
    reservationNumber: 'RES-20260729-961',
    action: 'FULL_FULFILL'
  });
  const partial = fulfillment.processFulfillment({
    reservationNumber: 'RES-20260729-962',
    action: 'PARTIAL_FULFILL',
    fulfilledQuantity: 5,
    totalQuantity: 15
  });
  const cancel = fulfillment.processFulfillment({
    reservationNumber: 'RES-20260729-963',
    action: 'CANCEL_FULFILL'
  });

  assert.strictEqual(full.success, true);
  assert.strictEqual(partial.success, true);
  assert.strictEqual(cancel.success, true);
  assert.strictEqual(adapter.queryHoldByReservationNumber('RES-20260729-961').record.status, 'FULFILLED');
  assert.strictEqual(adapter.queryHoldByReservationNumber('RES-20260729-962').record.status, 'PARTIALLY_FULFILLED');
  assert.strictEqual(adapter.queryHoldByReservationNumber('RES-20260729-963').record.status, 'CANCELLED');

  const ledgerRows = sheetClient.getRows('ledger');
  assert.deepStrictEqual(ledgerRows.map(row => row[1]), [
    'FULFILL_DEDUCT',
    'PARTIAL_FULFILL_DEDUCT',
    'CANCEL_RELEASE'
  ]);
  assert.deepStrictEqual(ledgerRows.map(row => row[3]), [10, 5, 6]);
  assert.strictEqual(ledgerRows[2][4], 6);
});

runTest('Ledger header mismatch fails closed before ledger append', () => {
  const sheetClient = createClient({
    headersBySheet: {
      ledger: PRODUCTION_LEDGER_HEADERS.filter(header => header !== 'status')
    }
  });
  const { adapter } = createAdapter({ sheetClient });
  const result = adapter.recordInventoryAdjustment({
    reservationNumber: 'RES-20260729-964',
    action: 'CANCEL_RELEASE',
    item: 'EQA-6522',
    quantity: 6,
    remainingQuantity: 6,
    status: 'CANCELLED',
    updatedAt: '2026-07-29T00:00:00.000Z'
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'LEDGER_SCHEMA_MISMATCH');
  assert.strictEqual(sheetClient.countCalls('appendLedgerEntry'), 0);
});

console.log(`\nProduction Sheet Reservation Adapter Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
