/**
 * MockSheetInventoryAdapter (In-Memory Sheet Inventory Adapter - Pack 2B / 5B)
 */

const { ReadOnlyInventoryAdapter } = require('./readonly-inventory-adapter');
const { mapSheetRowsToInventorySnapshot } = require('./inventory-sheet-mapper');

class MockSheetInventoryAdapter extends ReadOnlyInventoryAdapter {
  constructor(initialData) {
    super();
    this.sheetStore = new Map(); // productCode -> Array of raw row objects

    if (Array.isArray(initialData)) {
      this.loadRawSheetRows(initialData);
    } else if (initialData && typeof initialData === 'object') {
      Object.keys(initialData).forEach(productCode => {
        this.setRawSheetData(productCode, initialData[productCode]);
      });
    }
  }

  loadRawSheetRows(rows) {
    if (!Array.isArray(rows)) return;
    const header = rows[0];
    const dataRows = (Array.isArray(header) && typeof header[0] === 'string' && (header[0].includes('品名') || header[0].includes('規格')))
      ? rows.slice(1)
      : rows;

    dataRows.forEach(row => {
      let item = row;
      if (Array.isArray(row)) {
        item = {
          productCode: row[0],
          warehouseName: row[1],
          batchNumber: row[2],
          availableQuantity: row[3]
        };
      }
      if (item && item.productCode) {
        const list = this.sheetStore.get(item.productCode) || [];
        list.push(item);
        this.sheetStore.set(item.productCode, list);
      }
    });
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
