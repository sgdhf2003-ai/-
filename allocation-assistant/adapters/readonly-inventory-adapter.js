/**
 * Abstract Base Class: ReadOnlyInventoryAdapter (Pack 2A)
 */

class ReadOnlyInventoryAdapter {
  getInventorySnapshot(productCode, tenantContext) {
    throw new Error('UNIMPLEMENTED_METHOD: getInventorySnapshot() must be implemented by subclass');
  }

  getWarehouseList(tenantContext) {
    throw new Error('UNIMPLEMENTED_METHOD: getWarehouseList() must be implemented by subclass');
  }
}

module.exports = {
  ReadOnlyInventoryAdapter
};
