/**
 * FakeGoogleSheetsClientAdapter
 * Stage 42-G3: In-memory simulation of Google Sheets API
 *
 * Implements:
 * - findRowsByColumn(sheetName, columnLetter, value)
 * - appendRow(sheetName, rowData)
 * - getRows(sheetName)
 * - setPermissionDenied(boolean)
 */

class FakeGoogleSheetsClientAdapter {
  constructor() {
    this.sheets = new Map(); // sheetName -> Array of rows (each row is array of values)
    this.permissionDenied = false;
    this.crashHook = null;
  }

  setPermissionDenied(denied) {
    this.permissionDenied = Boolean(denied);
  }

  setCrashHook(hook) {
    this.crashHook = hook;
  }

  _colLetterToIndex(letter) {
    const upper = String(letter).toUpperCase();
    let index = 0;
    for (let i = 0; i < upper.length; i++) {
      index = index * 26 + (upper.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  async findRowsByColumn(sheetName, columnLetter, value) {
    if (this.permissionDenied) {
      const err = new Error("SHEET_PERMISSION_DENIED");
      err.code = 403;
      err.status = 403;
      throw err;
    }

    const rows = this.sheets.get(sheetName) || [];
    const colIndex = this._colLetterToIndex(columnLetter);

    const matches = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (row[colIndex] === value) {
        matches.push({ rowIndex: r, rowData: [...row] });
      }
    }
    return matches;
  }

  async appendRow(sheetName, rowData) {
    if (this.permissionDenied) {
      const err = new Error("SHEET_PERMISSION_DENIED");
      err.code = 403;
      err.status = 403;
      throw err;
    }

    if (!Array.isArray(rowData)) {
      throw new Error("INVALID_ROW_DATA: rowData must be an array");
    }

    if (!this.sheets.has(sheetName)) {
      this.sheets.set(sheetName, []);
    }

    const rows = this.sheets.get(sheetName);
    const rowToInsert = [...rowData];
    rows.push(rowToInsert);

    if (typeof this.crashHook === "function") {
      await this.crashHook(rowToInsert);
    }

    return {
      success: true,
      updatedRange: `${sheetName}!A${rows.length}:L${rows.length}`
    };
  }

  getRows(sheetName) {
    return (this.sheets.get(sheetName) || []).map((r) => [...r]);
  }

  clear() {
    this.sheets.clear();
    this.permissionDenied = false;
    this.crashHook = null;
  }
}

module.exports = {
  FakeGoogleSheetsClientAdapter
};
