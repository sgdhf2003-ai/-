/**
 * Production Sheet Reservation Adapter (Stage 24-B6)
 *
 * Wires the allocation persistence contract to an injected production Sheet
 * client. This adapter does not read Script Properties directly and does not
 * instantiate SpreadsheetApp, UrlFetchApp, LINE clients, or mock adapters.
 */

const { FormalHoldWritebackAdapter } = require('./formal-hold-writeback-adapter');
const { ControlledTestSheetReservationAdapter } = require('./controlled-test-sheet-reservation-adapter');

const PRODUCTION_SHEET_PROPERTY_NAMES = {
  spreadsheetId: 'JYAI_ALLOCATION_PRODUCTION_SPREADSHEET_ID',
  holdsSheetName: 'JYAI_ALLOCATION_PRODUCTION_HOLDS_SHEET_NAME',
  ledgerSheetName: 'JYAI_ALLOCATION_PRODUCTION_LEDGER_SHEET_NAME'
};

const LEDGER_HEADERS = ControlledTestSheetReservationAdapter.LEDGER_HEADERS;

function cloneRecord(record = {}) {
  return { ...record };
}

function createFailure(errorCode, details = {}) {
  return {
    success: false,
    persisted: false,
    redacted: true,
    errorCode,
    ...details
  };
}

function createSuccess(details = {}) {
  return {
    success: true,
    persisted: true,
    redacted: true,
    ...details
  };
}

function normalizeErrorCode(err, fallbackCode) {
  const message = err && err.message ? String(err.message) : '';
  if (/permission|denied|forbidden/i.test(message)) return 'PRODUCTION_SHEET_PERMISSION_DENIED';
  if (/api|network|fetch|timeout/i.test(message)) return 'PRODUCTION_SHEET_API_FAILURE';
  return message || fallbackCode;
}

function sameHeaders(actualHeaders, expectedHeaders) {
  return Array.isArray(actualHeaders) &&
    actualHeaders.length === expectedHeaders.length &&
    expectedHeaders.every((header, index) => actualHeaders[index] === header);
}

class ProductionSheetReservationAdapter {
  constructor(options = {}) {
    this.configProvider = options.configProvider || null;
    this.sheetClient = options.sheetClient || null;
    this.propertyNames = {
      ...PRODUCTION_SHEET_PROPERTY_NAMES,
      ...(options.propertyNames || {})
    };
  }

  static get PRODUCTION_SHEET_PROPERTY_NAMES() {
    return { ...PRODUCTION_SHEET_PROPERTY_NAMES };
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
    if (Object.prototype.hasOwnProperty.call(this.configProvider, name)) {
      return String(this.configProvider[name] || '').trim();
    }
    return '';
  }

  getConfig() {
    const required = [
      this.propertyNames.spreadsheetId,
      this.propertyNames.holdsSheetName,
      this.propertyNames.ledgerSheetName
    ];
    const missingNames = required.filter(name => !this.getConfigValue(name));
    if (missingNames.length > 0) {
      return {
        ok: false,
        errorCode: 'PRODUCTION_SHEET_CONFIG_MISSING',
        missingNames,
        presentNames: required.filter(name => !missingNames.includes(name))
      };
    }

    return {
      ok: true,
      spreadsheetId: this.getConfigValue(this.propertyNames.spreadsheetId),
      holdsSheetName: this.getConfigValue(this.propertyNames.holdsSheetName),
      ledgerSheetName: this.getConfigValue(this.propertyNames.ledgerSheetName)
    };
  }

  requireClient(methods = []) {
    if (!this.sheetClient) {
      return createFailure('PRODUCTION_SHEET_CLIENT_MISSING');
    }

    const missingMethods = methods.filter(method => typeof this.sheetClient[method] !== 'function');
    if (missingMethods.length > 0) {
      return createFailure('PRODUCTION_SHEET_CLIENT_CAPABILITY_MISSING', { missingMethods });
    }

    return createSuccess();
  }

  validateHeaders(config, sheetName, expectedHeaders, mismatchCode) {
    const client = this.requireClient(['getHeaders']);
    if (!client.success) return client;

    try {
      const headers = this.sheetClient.getHeaders(sheetName, { spreadsheetId: config.spreadsheetId });
      return sameHeaders(headers, expectedHeaders)
        ? createSuccess({ headerCount: expectedHeaders.length })
        : createFailure(mismatchCode);
    } catch (err) {
      return createFailure(normalizeErrorCode(err, 'PRODUCTION_SHEET_HEADER_CHECK_FAILED'));
    }
  }

  isConflictingReplay(existingRecord = {}, holdRecord = {}) {
    return FormalHoldWritebackAdapter.HOLDS_HEADERS
      .filter(header => !['createdAt', 'updatedAt'].includes(header))
      .some(header => existingRecord[header] !== holdRecord[header]);
  }

  findHold(config, reservationNumber) {
    const client = this.requireClient(['getHeaders', 'findRowById']);
    if (!client.success) return { found: false, errorCode: client.errorCode };

    const headerCheck = this.validateHeaders(
      config,
      config.holdsSheetName,
      FormalHoldWritebackAdapter.HOLDS_HEADERS,
      'HOLD_SCHEMA_MISMATCH'
    );
    if (!headerCheck.success) return { found: false, errorCode: headerCheck.errorCode };

    try {
      return this.sheetClient.findRowById(config.holdsSheetName, reservationNumber, {
        spreadsheetId: config.spreadsheetId,
        headers: FormalHoldWritebackAdapter.HOLDS_HEADERS
      });
    } catch (err) {
      return { found: false, errorCode: normalizeErrorCode(err, 'PRODUCTION_SHEET_QUERY_FAILED') };
    }
  }

  appendHoldRecord(holdRecord, options = {}) {
    try {
      const config = this.getConfig();
      if (!config.ok) return createFailure(config.errorCode, {
        missingNames: config.missingNames,
        presentNames: config.presentNames
      });

      const client = this.requireClient(['getHeaders', 'appendRow', 'findRowById']);
      if (!client.success) return client;

      const expectedHeaders = Array.isArray(options.headers) && options.headers.length > 0
        ? options.headers
        : FormalHoldWritebackAdapter.HOLDS_HEADERS;
      const headerCheck = this.validateHeaders(config, config.holdsSheetName, expectedHeaders, 'HOLD_SCHEMA_MISMATCH');
      if (!headerCheck.success) return headerCheck;

      const existing = this.sheetClient.findRowById(config.holdsSheetName, holdRecord.id, {
        spreadsheetId: config.spreadsheetId,
        headers: expectedHeaders
      });
      if (existing && existing.found) {
        if (this.isConflictingReplay(existing.record, holdRecord)) {
          return createFailure('HOLD_IDEMPOTENCY_CONFLICT', {
            reservationNumber: holdRecord.id,
            record: cloneRecord(existing.record),
            isReplay: true
          });
        }

        return createSuccess({
          reservationNumber: holdRecord.id,
          status: existing.record.status,
          record: cloneRecord(existing.record),
          rowData: Array.isArray(existing.rowData) ? existing.rowData.slice() : expectedHeaders.map(header => existing.record[header]),
          rowIndex: existing.rowIndex,
          isReplay: true
        });
      }

      const rowData = expectedHeaders.map(header => holdRecord[header]);
      const appendResult = this.sheetClient.appendRow(config.holdsSheetName, rowData, {
        spreadsheetId: config.spreadsheetId,
        headers: expectedHeaders
      });
      if (!appendResult || appendResult.success !== true || appendResult.persisted !== true) {
        return createFailure(
          (appendResult && appendResult.errorCode) || 'PRODUCTION_WRITE_CONFIRMATION_MISSING',
          { reservationNumber: holdRecord.id }
        );
      }

      const readback = this.sheetClient.findRowById(config.holdsSheetName, holdRecord.id, {
        spreadsheetId: config.spreadsheetId,
        headers: expectedHeaders
      });
      if (!readback || !readback.found || !readback.record || readback.record.id !== holdRecord.id) {
        return createFailure('PRODUCTION_WRITE_CONFIRMATION_MISSING', {
          reservationNumber: holdRecord.id
        });
      }

      const readbackRowId = Array.isArray(readback.rowData) ? readback.rowData[0] : readback.record.id;
      if (readbackRowId !== holdRecord.id) {
        return createFailure('PRODUCTION_WRITE_ID_MISMATCH', {
          reservationNumber: holdRecord.id
        });
      }

      return createSuccess({
        reservationNumber: holdRecord.id,
        status: readback.record.status,
        record: cloneRecord(readback.record),
        rowData: Array.isArray(readback.rowData) ? readback.rowData.slice() : expectedHeaders.map(header => readback.record[header]),
        rowIndex: readback.rowIndex,
        isReplay: false
      });
    } catch (err) {
      return createFailure(normalizeErrorCode(err, 'PRODUCTION_SHEET_WRITE_FAILED'));
    }
  }

  queryHoldByReservationNumber(reservationNumber) {
    const config = this.getConfig();
    if (!config.ok) return { found: false, errorCode: config.errorCode, redacted: true };
    const result = this.findHold(config, reservationNumber);
    return { ...result, redacted: true };
  }

  updateHoldStatus(update = {}) {
    try {
      const config = this.getConfig();
      if (!config.ok) return createFailure(config.errorCode, {
        missingNames: config.missingNames,
        presentNames: config.presentNames
      });

      const client = this.requireClient(['getHeaders', 'updateRowById']);
      if (!client.success) return client;

      const headerCheck = this.validateHeaders(
        config,
        config.holdsSheetName,
        FormalHoldWritebackAdapter.HOLDS_HEADERS,
        'HOLD_SCHEMA_MISMATCH'
      );
      if (!headerCheck.success) return headerCheck;

      const result = this.sheetClient.updateRowById(config.holdsSheetName, update.reservationNumber, {
        status: update.status,
        fulfilledQuantity: update.fulfilledQuantity,
        remainingQuantity: update.remainingQuantity,
        updatedAt: update.updatedAt
      }, {
        spreadsheetId: config.spreadsheetId,
        headers: FormalHoldWritebackAdapter.HOLDS_HEADERS
      });

      if (!result || result.success !== true || result.persisted !== true) {
        return createFailure(
          (result && result.errorCode) || 'PRODUCTION_STATUS_UPDATE_CONFIRMATION_MISSING',
          { reservationNumber: update.reservationNumber }
        );
      }

      const readback = this.findHold(config, update.reservationNumber);
      if (!readback || !readback.found || !readback.record || readback.record.status !== update.status) {
        return createFailure('PRODUCTION_STATUS_UPDATE_CONFIRMATION_MISSING', {
          reservationNumber: update.reservationNumber
        });
      }

      return createSuccess({
        reservationNumber: update.reservationNumber,
        status: update.status,
        rowIndex: readback.rowIndex,
        record: cloneRecord(readback.record)
      });
    } catch (err) {
      return createFailure(normalizeErrorCode(err, 'PRODUCTION_STATUS_UPDATE_FAILED'));
    }
  }

  recordInventoryAdjustment(adjustment = {}) {
    try {
      const config = this.getConfig();
      if (!config.ok) return createFailure(config.errorCode, {
        missingNames: config.missingNames,
        presentNames: config.presentNames
      });

      const client = this.requireClient(['getHeaders', 'appendLedgerEntry']);
      if (!client.success) return client;

      const headerCheck = this.validateHeaders(config, config.ledgerSheetName, LEDGER_HEADERS, 'LEDGER_SCHEMA_MISMATCH');
      if (!headerCheck.success) return headerCheck;

      const result = this.sheetClient.appendLedgerEntry(config.ledgerSheetName, adjustment, LEDGER_HEADERS, {
        spreadsheetId: config.spreadsheetId
      });
      if (!result || result.success !== true || result.persisted !== true) {
        return createFailure(
          (result && result.errorCode) || 'PRODUCTION_LEDGER_WRITE_CONFIRMATION_MISSING',
          { reservationNumber: adjustment.reservationNumber }
        );
      }

      return createSuccess({
        reservationNumber: adjustment.reservationNumber,
        action: adjustment.action,
        rowIndex: result.rowIndex,
        rowData: Array.isArray(result.rowData) ? result.rowData.slice() : LEDGER_HEADERS.map(header => adjustment[header]),
        adjustment: cloneRecord(adjustment)
      });
    } catch (err) {
      return createFailure(normalizeErrorCode(err, 'PRODUCTION_LEDGER_WRITE_FAILED'));
    }
  }
}

module.exports = {
  ProductionSheetReservationAdapter
};
