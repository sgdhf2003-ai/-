/**
 * Production Sheet Readiness Diagnostics (Stage 24-B4-D3/D4)
 *
 * Local-only contract checks for the future production Sheet adapter. This
 * module does not read Script Properties values, instantiate SpreadsheetApp,
 * call external APIs, or write Sheets. Callers must inject redacted config
 * presence and test doubles for capability/header checks.
 */

const { FormalHoldWritebackAdapter } = require('./formal-hold-writeback-adapter');
const { ControlledTestSheetReservationAdapter } = require('./controlled-test-sheet-reservation-adapter');
const { MockFormalReservationAdapter } = require('./mock-formal-reservation-adapter');

const PRODUCTION_CONFIG_NAMES = {
  spreadsheetId: 'JYAI_ALLOCATION_PRODUCTION_SPREADSHEET_ID',
  holdsSheetName: 'JYAI_ALLOCATION_PRODUCTION_HOLDS_SHEET_NAME',
  ledgerSheetName: 'JYAI_ALLOCATION_PRODUCTION_LEDGER_SHEET_NAME'
};

const REQUIRED_FORMAL_HOLD_METHODS = [
  'appendHoldRecord'
];

const REQUIRED_FULFILLMENT_METHODS = [
  'queryHoldByReservationNumber',
  'updateHoldStatus',
  'recordInventoryAdjustment'
];

const REQUIRED_HEADER_METHODS = [
  'getHeaders'
];

function createFail(errorCode, details = {}) {
  return {
    ok: false,
    success: false,
    errorCode,
    redacted: true,
    ...details
  };
}

function createPass(details = {}) {
  return {
    ok: true,
    success: true,
    redacted: true,
    ...details
  };
}

function hasConfigName(configPresence = {}, name) {
  if (!configPresence) return false;
  if (typeof configPresence.has === 'function') {
    return configPresence.has(name) === true;
  }
  return configPresence[name] === true;
}

function findMissingMethods(target, methods = []) {
  if (!target) return methods.slice();
  return methods.filter(method => typeof target[method] !== 'function');
}

function compareHeaders(actualHeaders, expectedHeaders) {
  return Array.isArray(actualHeaders) &&
    actualHeaders.length === expectedHeaders.length &&
    expectedHeaders.every((header, index) => actualHeaders[index] === header);
}

function isMockAdapter(adapter) {
  return adapter instanceof MockFormalReservationAdapter ||
    (adapter && adapter.constructor && adapter.constructor.name === 'MockFormalReservationAdapter');
}

class ProductionSheetReadinessDiagnostics {
  constructor(options = {}) {
    this.configNames = {
      ...PRODUCTION_CONFIG_NAMES,
      ...(options.configNames || {})
    };
    this.holdsHeaders = options.holdsHeaders || FormalHoldWritebackAdapter.HOLDS_HEADERS;
    this.ledgerHeaders = options.ledgerHeaders || ControlledTestSheetReservationAdapter.LEDGER_HEADERS;
  }

  static get PRODUCTION_CONFIG_NAMES() {
    return { ...PRODUCTION_CONFIG_NAMES };
  }

  checkConfigPresence(configPresence = {}) {
    const requiredNames = Object.values(this.configNames);
    const missingNames = requiredNames.filter(name => !hasConfigName(configPresence, name));
    if (missingNames.length > 0) {
      return createFail('PRODUCTION_SHEET_CONFIG_MISSING', {
        missingNames,
        presentNames: requiredNames.filter(name => !missingNames.includes(name))
      });
    }
    return createPass({ presentNames: requiredNames });
  }

  checkAdapterBoundary(adapter) {
    if (!adapter) {
      return createFail('PRODUCTION_SHEET_ADAPTER_MISSING');
    }
    if (isMockAdapter(adapter)) {
      return createFail('PRODUCTION_MOCK_ADAPTER_FORBIDDEN');
    }

    const missingMethods = findMissingMethods(adapter, [
      ...REQUIRED_FORMAL_HOLD_METHODS,
      ...REQUIRED_FULFILLMENT_METHODS
    ]);
    if (missingMethods.length > 0) {
      return createFail('PRODUCTION_SHEET_ADAPTER_CAPABILITY_MISSING', { missingMethods });
    }

    return createPass({
      methods: [
        ...REQUIRED_FORMAL_HOLD_METHODS,
        ...REQUIRED_FULFILLMENT_METHODS
      ]
    });
  }

  checkHeaderBoundary(sheetClient, options = {}) {
    const missingHeaderMethods = findMissingMethods(sheetClient, REQUIRED_HEADER_METHODS);
    if (missingHeaderMethods.length > 0) {
      return createFail('PRODUCTION_SHEET_HEADER_CLIENT_MISSING', {
        missingMethods: missingHeaderMethods
      });
    }

    try {
      const holdsHeaders = sheetClient.getHeaders(options.holdsSheetName || 'holds');
      if (!compareHeaders(holdsHeaders, this.holdsHeaders)) {
        return createFail('HOLD_SCHEMA_MISMATCH');
      }

      const ledgerHeaders = sheetClient.getHeaders(options.ledgerSheetName || 'ledger');
      if (!compareHeaders(ledgerHeaders, this.ledgerHeaders)) {
        return createFail('LEDGER_SCHEMA_MISMATCH');
      }
    } catch (err) {
      return createFail(err && err.message ? err.message : 'PRODUCTION_SHEET_HEADER_CHECK_FAILED');
    }

    return createPass({
      holdsHeaderCount: this.holdsHeaders.length,
      ledgerHeaderCount: this.ledgerHeaders.length
    });
  }

  checkWriteReceipt(receipt = {}, expectedReservationNumber = '') {
    if (!receipt || receipt.success !== true || receipt.persisted !== true || receipt.confirmed !== true) {
      return createFail('PRODUCTION_WRITE_CONFIRMATION_MISSING');
    }

    const recordId = receipt.holdRecord && receipt.holdRecord.id;
    const rowId = Array.isArray(receipt.rowData) ? receipt.rowData[0] : '';
    const readbackId = receipt.readbackRecord && receipt.readbackRecord.id;
    const ids = [receipt.reservationNumber, recordId, rowId, readbackId];
    const expected = expectedReservationNumber || receipt.reservationNumber;
    if (!expected || ids.some(id => id !== expected)) {
      return createFail('PRODUCTION_WRITE_ID_MISMATCH');
    }

    return createPass({ reservationNumber: expected });
  }

  checkFulfillmentLedgerEntry(entry = {}) {
    const expectedActions = new Set([
      'FULFILL_DEDUCT',
      'PARTIAL_FULFILL_DEDUCT',
      'CANCEL_RELEASE'
    ]);
    if (!expectedActions.has(entry.action)) {
      return createFail('FULFILLMENT_LEDGER_ACTION_INVALID');
    }
    if (entry.action === 'CANCEL_RELEASE' && Number(entry.quantity || 0) <= 0) {
      return createFail('CANCEL_RELEASE_QUANTITY_INVALID');
    }
    if (entry.remainingQuantity === undefined || entry.remainingQuantity === null) {
      return createFail('FULFILLMENT_REMAINING_QUANTITY_MISSING');
    }
    return createPass({ action: entry.action });
  }
}

module.exports = {
  ProductionSheetReadinessDiagnostics
};
