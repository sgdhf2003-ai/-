/**
 * InventorySnapshot & InventoryLot Contract Validators (Updated Phase 2A)
 */

function validateInventoryLot(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('InventoryLot must be a non-null object');
  }

  const batchNumber = (data.batchNumber || '').toString().trim();
  if (!batchNumber) {
    throw new Error('batchNumber is required');
  }

  const availableQuantity = Number(data.availableQuantity);
  if (isNaN(availableQuantity) || availableQuantity < 0) {
    throw new Error('availableQuantity cannot be negative');
  }

  const physicalCountConfirmed = typeof data.physicalCountConfirmed === 'boolean'
    ? data.physicalCountConfirmed
    : true;

  return {
    batchNumber,
    availableQuantity,
    physicalCountConfirmed
  };
}

function validateInventorySnapshot(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('InventorySnapshot must be a non-null object');
  }

  const snapshotId = (data.snapshotId || '').toString().trim();
  const productCode = (data.productCode || '').toString().trim();
  if (!productCode) {
    throw new Error('productCode is required');
  }

  const warehouses = Array.isArray(data.warehouses)
    ? data.warehouses.map(wh => {
        const warehouseName = (wh.warehouseName || '').toString().trim();
        if (!warehouseName) {
          throw new Error('warehouseName is required');
        }
        const batches = Array.isArray(wh.batches)
          ? wh.batches.map(validateInventoryLot)
          : [];
        return { warehouseName, batches };
      })
    : [];

  const warnings = Array.isArray(data.warnings) ? data.warnings : [];

  return {
    snapshotId: snapshotId || `snap_${Date.now()}`,
    productCode,
    timestamp: data.timestamp || new Date().toISOString(),
    warehouses,
    warnings
  };
}

module.exports = {
  validateInventoryLot,
  validateInventorySnapshot
};
