/**
 * Controlled Test Sheet Reservation Adapter (Stage 24-B4-C/D)
 *
 * This adapter is for cloned/test Sheet validation only. It does not read
 * Script Properties directly and does not instantiate a real Sheet client.
 */

const { FormalHoldWritebackAdapter } = require('./formal-hold-writeback-adapter');

const TEST_SHEET_PROPERTY_NAMES = {
  spreadsheetId: 'JYAI_ALLOCATION_TEST_SPREADSHEET_ID',
  holdsSheetName: 'JYAI_ALLOCATION_TEST_HOLDS_SHEET_NAME',
  ledgerSheetName: 'JYAI_ALLOCATION_TEST_LEDGER_SHEET_NAME'
};

const LEDGER_HEADERS = [
  'reservationNumber',
  'action',
  'item',
  'quantity',
  'remainingQuantity',
  'status',
  'updatedAt'
];

class ControlledTestSheetReservationAdapter {
  constructor(options = {}) {
    this.configProvider = options.configProvider || null;
    this.sheetClient = options.sheetClient || null;
    this.propertyNames = {
      ...TEST_SHEET_PROPERTY_NAMES,
      ...(options.propertyNames || {})
    };
  }

  static get TEST_SHEET_PROPERTY_NAMES() {
    return { ...TEST_SHEET_PROPERTY_NAMES };
  }

  static get LEDGER_HEADERS() {
    return LEDGER_HEADERS.slice();
  }

  getConfigValue(name) {
    if (!this.configProvider) return '';
    if (typeof this.configProvider === 'function') {
      return String(this.configProvider(name) || '').trim();
    }
    if (typeof this.configProvider.get === 'function') {
      return String(this.configProvider.get(name) || '').trim();
    }
    return '';
  }

  getConfig() {
    const spreadsheetId = this.getConfigValue(this.propertyNames.spreadsheetId);
    const holdsSheetName = this.getConfigValue(this.propertyNames.holdsSheetName);
    const ledgerSheetName = this.getConfigValue(this.propertyNames.ledgerSheetName);
    if (!spreadsheetId || !holdsSheetName || !ledgerSheetName) {
      return { ok: false, errorCode: 'TEST_SHEET_CONFIG_MISSING' };
    }
    return { ok: true, spreadsheetId, holdsSheetName, ledgerSheetName };
  }

  requireClient(methods = []) {
    if (!this.sheetClient) {
      return { ok: false, errorCode: 'TEST_SHEET_CLIENT_MISSING' };
    }
    const missing = methods.find(method => typeof this.sheetClient[method] !== 'function');
    if (missing) {
      return { ok: false, errorCode: 'TEST_SHEET_CLIENT_CAPABILITY_MISSING' };
    }
    return { ok: true };
  }

  validateHeaders(sheetName, expectedHeaders) {
    const headers = this.sheetClient.getHeaders(sheetName);
    const sameHeaders = Array.isArray(headers) &&
      headers.length === expectedHeaders.length &&
      expectedHeaders.every((header, index) => headers[index] === header);
    return sameHeaders
      ? { ok: true, headers }
      : { ok: false, errorCode: 'HOLD_SCHEMA_MISMATCH' };
  }

  resultFromError(err, fallbackCode) {
    return {
      success: false,
      persisted: false,
      errorCode: err && err.message ? err.message : fallbackCode
    };
  }

  isConflictingReplay(existingRecord = {}, holdRecord = {}) {
    return FormalHoldWritebackAdapter.HOLDS_HEADERS
      .filter(header => !['createdAt', 'updatedAt'].includes(header))
      .some(header => existingRecord[header] !== holdRecord[header]);
  }

  appendHoldRecord(holdRecord, options = {}) {
    try {
      const config = this.getConfig();
      if (!config.ok) return { success: false, persisted: false, errorCode: config.errorCode };

      const client = this.requireClient(['getHeaders', 'appendRow', 'findRowById']);
      if (!client.ok) return { success: false, persisted: false, errorCode: client.errorCode };

      const expectedHeaders = Array.isArray(options.headers) && options.headers.length > 0
        ? options.headers
        : FormalHoldWritebackAdapter.HOLDS_HEADERS;
      const headerCheck = this.validateHeaders(config.holdsSheetName, expectedHeaders);
      if (!headerCheck.ok) return { success: false, persisted: false, errorCode: headerCheck.errorCode };

      const existing = this.sheetClient.findRowById(config.holdsSheetName, holdRecord.id);
      if (existing && existing.found) {
        if (this.isConflictingReplay(existing.record, holdRecord)) {
          return {
            success: false,
            persisted: false,
            reservationNumber: holdRecord.id,
            errorCode: 'HOLD_IDEMPOTENCY_CONFLICT',
            record: { ...existing.record },
            isReplay: true
          };
        }
        return {
          success: true,
          persisted: true,
          reservationNumber: holdRecord.id,
          status: existing.record.status,
          record: { ...existing.record },
          rowData: existing.rowData.slice(),
          rowIndex: existing.rowIndex,
          isReplay: true
        };
      }

      const rowData = expectedHeaders.map(header => holdRecord[header]);
      const appendResult = this.sheetClient.appendRow(config.holdsSheetName, rowData);
      if (!appendResult || appendResult.success !== true || appendResult.persisted !== true) {
        return {
          success: false,
          persisted: false,
          reservationNumber: holdRecord.id,
          errorCode: (appendResult && appendResult.errorCode) || 'TEST_SHEET_WRITE_FAILED'
        };
      }

      const readback = this.sheetClient.findRowById(config.holdsSheetName, holdRecord.id);
      if (!readback || !readback.found || readback.record.id !== holdRecord.id) {
        return {
          success: false,
          persisted: false,
          reservationNumber: holdRecord.id,
          errorCode: 'TEST_SHEET_READBACK_MISMATCH'
        };
      }

      return {
        success: true,
        persisted: true,
        reservationNumber: holdRecord.id,
        status: readback.record.status,
        record: { ...readback.record },
        rowData: readback.rowData.slice(),
        rowIndex: readback.rowIndex,
        isReplay: false
      };
    } catch (err) {
      return this.resultFromError(err, 'TEST_SHEET_WRITE_FAILED');
    }
  }

  queryHoldByReservationNumber(reservationNumber) {
    try {
      const config = this.getConfig();
      if (!config.ok) return { found: false, errorCode: config.errorCode };

      const client = this.requireClient(['getHeaders', 'findRowById']);
      if (!client.ok) return { found: false, errorCode: client.errorCode };

      const headerCheck = this.validateHeaders(config.holdsSheetName, FormalHoldWritebackAdapter.HOLDS_HEADERS);
      if (!headerCheck.ok) return { found: false, errorCode: headerCheck.errorCode };

      return this.sheetClient.findRowById(config.holdsSheetName, reservationNumber);
    } catch (err) {
      return { found: false, errorCode: err && err.message ? err.message : 'TEST_SHEET_QUERY_FAILED' };
    }
  }

  updateHoldStatus(update = {}) {
    try {
      const config = this.getConfig();
      if (!config.ok) return { success: false, persisted: false, errorCode: config.errorCode };

      const client = this.requireClient(['getHeaders', 'updateRowById']);
      if (!client.ok) return { success: false, persisted: false, errorCode: client.errorCode };

      const headerCheck = this.validateHeaders(config.holdsSheetName, FormalHoldWritebackAdapter.HOLDS_HEADERS);
      if (!headerCheck.ok) return { success: false, persisted: false, errorCode: headerCheck.errorCode };

      const result = this.sheetClient.updateRowById(config.holdsSheetName, update.reservationNumber, {
        status: update.status,
        fulfilledQuantity: update.fulfilledQuantity,
        remainingQuantity: update.remainingQuantity,
        updatedAt: update.updatedAt
      });
      return result && result.success === true && result.persisted === true
        ? { ...result, reservationNumber: update.reservationNumber, status: update.status }
        : {
            success: false,
            persisted: false,
            errorCode: (result && result.errorCode) || 'TEST_SHEET_STATUS_UPDATE_FAILED'
          };
    } catch (err) {
      return this.resultFromError(err, 'TEST_SHEET_STATUS_UPDATE_FAILED');
    }
  }

  recordInventoryAdjustment(adjustment = {}) {
    try {
      const config = this.getConfig();
      if (!config.ok) return { success: false, persisted: false, errorCode: config.errorCode };

      const client = this.requireClient(['getHeaders', 'appendLedgerEntry']);
      if (!client.ok) return { success: false, persisted: false, errorCode: client.errorCode };

      const headerCheck = this.validateHeaders(config.ledgerSheetName, LEDGER_HEADERS);
      if (!headerCheck.ok) return { success: false, persisted: false, errorCode: 'LEDGER_SCHEMA_MISMATCH' };

      const normalizedAdjustment = {
        timestamp: adjustment.timestamp || adjustment.updatedAt || new Date().toISOString(),
        ...adjustment
      };

      const result = this.sheetClient.appendLedgerEntry(config.ledgerSheetName, normalizedAdjustment, LEDGER_HEADERS);
      return result && result.success === true && result.persisted === true
        ? { ...result, adjustment: { ...normalizedAdjustment } }
        : {
            success: false,
            persisted: false,
            errorCode: (result && result.errorCode) || 'TEST_SHEET_LEDGER_WRITE_FAILED'
          };
    } catch (err) {
      return this.resultFromError(err, 'TEST_SHEET_LEDGER_WRITE_FAILED');
    }
  }
}

module.exports = {
  ControlledTestSheetReservationAdapter
};
