/**
 * Pure Function Mapper: InventorySheetMapper (Pack 2A)
 */

const { validateInventorySnapshot } = require('../contracts/inventory-contract');

function parseQuantity(rawQty) {
  if (typeof rawQty === 'number') {
    if (isNaN(rawQty)) return { val: 0, isUnparseable: true };
    return { val: rawQty, isUnparseable: false };
  }

  if (typeof rawQty === 'string') {
    const trimmed = rawQty.trim();
    const parsed = parseInt(trimmed, 10);
    if (isNaN(parsed)) {
      return { val: 0, isUnparseable: true };
    }
    return { val: parsed, isUnparseable: false };
  }

  return { val: 0, isUnparseable: true };
}

function mapSheetRowsToInventorySnapshot(productCode, rawRows) {
  if (!productCode || typeof productCode !== 'string') {
    throw new Error('productCode is required to map sheet rows');
  }

  const rows = Array.isArray(rawRows) ? rawRows : [];
  const warnings = [];

  const warehouseMap = new Map(); // warehouseName -> Map(batchNumber -> lotData)
  let hasUnconfirmedPhysical = false;

  rows.forEach((row, idx) => {
    if (!row || typeof row !== 'object') return;

    const rowProduct = (row.productCode || '').trim();
    const warehouseName = (row.warehouseName || '預設倉').trim();
    const batchNumber = (row.batchNumber || '').trim();

    // 1. Missing required field filter
    if (!rowProduct || rowProduct !== productCode || !batchNumber) {
      if (!warnings.some(w => w.warningCode === 'INVALID_ROW_FILTERED')) {
        warnings.push({
          warningCode: 'INVALID_ROW_FILTERED',
          message: 'Some rows missing productCode or batchNumber were filtered',
          severity: 'WARNING',
          details: { rowIndex: idx }
        });
      }
      return;
    }

    // 2. Quantity parsing & coercion
    const qtyResult = parseQuantity(row.availableQuantity);
    let qty = qtyResult.val;

    if (qtyResult.isUnparseable) {
      if (!warnings.some(w => w.warningCode === 'UNPARSEABLE_QUANTITY')) {
        warnings.push({
          warningCode: 'UNPARSEABLE_QUANTITY',
          message: 'Unparseable quantity converted to 0',
          severity: 'WARNING',
          details: { batchNumber, rawQuantity: row.availableQuantity }
        });
      }
    }

    if (qty < 0) {
      qty = 0;
      if (!warnings.some(w => w.warningCode === 'NEGATIVE_STOCK_FOUND')) {
        warnings.push({
          warningCode: 'NEGATIVE_STOCK_FOUND',
          message: 'Negative available quantity coerced to 0',
          severity: 'WARNING',
          details: { batchNumber }
        });
      }
    }

    // 3. Physical count confirmation
    const physicalConfirmed = Boolean(row.physicalConfirmed);
    if (!physicalConfirmed) {
      hasUnconfirmedPhysical = true;
    }

    if (!warehouseMap.has(warehouseName)) {
      warehouseMap.set(warehouseName, new Map());
    }
    const batchMap = warehouseMap.get(warehouseName);

    if (batchMap.has(batchNumber)) {
      const existing = batchMap.get(batchNumber);
      existing.availableQuantity += qty;
      existing.physicalCountConfirmed = existing.physicalCountConfirmed && physicalConfirmed;
    } else {
      batchMap.set(batchNumber, {
        batchNumber,
        availableQuantity: qty,
        physicalCountConfirmed: physicalConfirmed,
        manufacturingDate: row.manufacturingDate || '',
        expiryDate: row.expiryDate || '',
        locationTag: row.locationTag || ''
      });
    }
  });

  if (hasUnconfirmedPhysical) {
    if (!warnings.some(w => w.warningCode === 'PHYSICAL_COUNT_UNCONFIRMED')) {
      warnings.push({
        warningCode: 'PHYSICAL_COUNT_UNCONFIRMED',
        message: 'Snapshot contains inventory without physical count verification',
        severity: 'INFO',
        details: { productCode }
      });
    }
  }

  const warehouses = Array.from(warehouseMap.entries()).map(([whName, bMap]) => ({
    warehouseName: whName,
    batches: Array.from(bMap.values())
  }));

  const snapshotData = {
    snapshotId: `snap_mapped_${Date.now()}`,
    productCode,
    timestamp: new Date().toISOString(),
    warehouses,
    warnings
  };

  return validateInventorySnapshot(snapshotData);
}

module.exports = {
  mapSheetRowsToInventorySnapshot
};
