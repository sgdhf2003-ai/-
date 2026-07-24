/**
 * MockSheetInventoryAdapter (In-Memory Sheet Inventory Adapter - Pack 2B)
 */

const { ReadOnlyInventoryAdapter } = require('./readonly-inventory-adapter');
const { mapSheetRowsToInventorySnapshot } = require('./inventory-sheet-mapper');

class MockSheetInventoryAdapter extends ReadOnlyInventoryAdapter {
  constructor() {
    super();
    this.sheetStore = new Map(); // productCode -> Array of raw row objects
  }

  setRawSheetData(productCode, rawRows) {
    if (!productCode) return;
    this.sheetStore.set(productCode, Array.isArray(rawRows) ? rawRows : []);
  }

  getInventorySnapshot(productCode, tenantContext) {
    if (!productCode || typeof productCode !== 'string') {
      throw new Error('INVALID_PRODUCT_CODE: productCode is required');
    }

    const rows = this.sheetStore.get(productCode);

    if (!rows || rows.length === 0) {
      const emptySnapshot = mapSheetRowsToInventorySnapshot(productCode, []);
      emptySnapshot.warnings.push({
        warningCode: 'EMPTY_SHEET_DATA',
        message: `No sheet data found for productCode ${productCode}`,
        severity: 'WARNING',
        details: { productCode }
      });
      return emptySnapshot;
    }

    return mapSheetRowsToInventorySnapshot(productCode, rows);
  }

  getWarehouseList(tenantContext) {
    return ['林口倉', '忠義倉', '汐止倉'];
  }
}

module.exports = {
  MockSheetInventoryAdapter
};
