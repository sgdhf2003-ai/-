/**
 * LiveSheetInventoryAdapter & Two-Table Reconciliation Evaluator (Stage 39-B)
 */

const { ReadOnlyInventoryAdapter } = require('./readonly-inventory-adapter');

function isProductCodeMatchInRow(row, targetProductCode) {
  if (!Array.isArray(row) || !targetProductCode) return false;
  const targetUpper = targetProductCode.toString().trim().toUpperCase();
  if (!targetUpper) return false;

  for (let colIdx = 0; colIdx <= 4; colIdx++) {
    const val = (row[colIdx] || '').toString().trim();
    if (!val) continue;

    const lines = val.replace(/\r/g, '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim().toUpperCase();
      if (!line) continue;

      if (line === targetUpper) return true;

      const firstWord = line.split(/\s+/)[0];
      if (firstWord === targetUpper) return true;

      if (line.indexOf(targetUpper) === 0) {
        const nextChar = line.charAt(targetUpper.length);
        if (!nextChar || /[\s\-\/_()（）]/.test(nextChar)) return true;
      }
    }
  }

  return false;
}

function parseMasterInventoryRow(row) {
  if (!Array.isArray(row)) {
    return {
      productCode: '',
      productName: '',
      inventoryQuantity: 0,
      availableQuantity: 0,
      reservedQuantity: 0,
      batchNumber: ''
    };
  }

  const rawC = (row[2] || '').toString().trim(); // C: 編號 / 型號
  let productCode = '';
  let productName = '';

  if (rawC) {
    const parts = rawC.split(/\s+/);
    productCode = parts[0];
    productName = parts.slice(1).join(' ');
  }

  const parseQty = (val) => {
    const num = parseInt(val, 10);
    return isNaN(num) ? 0 : Math.max(0, num);
  };

  const inventoryQuantity = parseQty(row[10]); // K: 庫存
  const availableQuantity = parseQty(row[11]); // L: 可用庫存
  const reservedQuantity = parseQty(row[12]);  // M: 保留數量
  const batchNumber = (row[6] || '').toString().trim(); // G: 批號

  return {
    productCode,
    productName,
    inventoryQuantity,
    availableQuantity,
    reservedQuantity,
    batchNumber
  };
}

function evaluateTwoTableReconciliation(options = {}) {
  const { master, warehouseRows = [], requestedQuantity = 0, customerApprovedMixedBatch = false } = options;

  if (!master || !master.productCode) {
    return {
      reconciled: false,
      status: 'ALLOCATION_REVIEW',
      masterSummary: master || {},
      suggestions: [],
      warnings: [
        {
          warningCode: 'INVALID_MASTER_RECORD',
          severity: 'CRITICAL',
          message: '庫存查詢表主檔資料無效或缺失。'
        }
      ]
    };
  }

  // 1. Calculate warehouse stock sum across LinKou and ZhongYi sheets
  let warehouseSum = 0;
  warehouseRows.forEach(row => {
    const qty = parseInt(row.availableQuantity, 10);
    if (!isNaN(qty) && qty > 0) {
      warehouseSum += qty;
    }
  });

  const masterInventory = master.inventoryQuantity;
  const masterAvailable = master.availableQuantity;

  // 2. Strict Rule: Compare Master Inventory (K) with Warehouse Sum
  if (warehouseSum !== masterInventory) {
    const drift = warehouseSum - masterInventory;
    return {
      reconciled: false,
      status: 'ALLOCATION_REVIEW',
      masterSummary: {
        ...master,
        warehouseSum
      },
      suggestions: [], // STRICT: Do NOT generate formal suggestions or apply Safe Minimum fallback
      warnings: [
        {
          warningCode: 'RECONCILIATION_DRIFT_DETECTED',
          severity: 'CRITICAL',
          message: `庫存查詢表總庫存 (${masterInventory}) 與分倉合計 (${warehouseSum}) 不一致，差異: ${drift} PCS。`,
          details: {
            masterInventory,
            warehouseSum,
            drift
          }
        }
      ]
    };
  }

  // 3. Allocation Evaluation up to Available Quantity (L)
  if (requestedQuantity > masterAvailable) {
    return {
      reconciled: true,
      status: 'ALLOCATION_REVIEW',
      masterSummary: master,
      suggestions: [],
      warnings: [
        {
          warningCode: 'INSUFFICIENT_AVAILABLE_STOCK',
          severity: 'CRITICAL',
          message: `需求數量 (${requestedQuantity}) 超過庫存查詢表可用庫存 (${masterAvailable})。`
        }
      ]
    };
  }

  // Check single batch or mixed batch
  const validBatches = warehouseRows.filter(r => parseInt(r.availableQuantity, 10) > 0);
  const singleBatch = validBatches.find(r => parseInt(r.availableQuantity, 10) >= requestedQuantity);

  if (singleBatch) {
    return {
      reconciled: true,
      status: 'ALLOCATION_CONFIRMED',
      masterSummary: master,
      suggestions: [
        {
          productCode: master.productCode,
          productName: master.productName,
          warehouseName: singleBatch.warehouseName,
          batchNumber: singleBatch.batchNumber || master.batchNumber,
          allocatedQuantity: requestedQuantity
        }
      ],
      warnings: []
    };
  }

  if (!customerApprovedMixedBatch) {
    return {
      reconciled: true,
      status: 'ALLOCATION_REVIEW',
      masterSummary: master,
      suggestions: [],
      warnings: [
        {
          warningCode: 'BATCH_MIXING_REQUIRED',
          severity: 'WARNING',
          message: '單批庫存不足需求數量，需要跨倉或跨批號混批配貨。'
        }
      ]
    };
  }

  let remaining = requestedQuantity;
  const suggestions = [];
  validBatches.forEach(b => {
    if (remaining <= 0) return;
    const bQty = parseInt(b.availableQuantity, 10);
    const alloc = Math.min(bQty, remaining);
    if (alloc > 0) {
      suggestions.push({
        productCode: master.productCode,
        productName: master.productName,
        warehouseName: b.warehouseName,
        batchNumber: b.batchNumber || master.batchNumber,
        allocatedQuantity: alloc
      });
      remaining -= alloc;
    }
  });

  return {
    reconciled: true,
    status: 'ALLOCATION_CONFIRMED',
    masterSummary: master,
    suggestions,
    warnings: []
  };
}

class LiveSheetInventoryAdapter extends ReadOnlyInventoryAdapter {
  constructor(options = {}) {
    super();
    this.fetcher = options.fetcher || null;
    this.fallbackSnapshot = options.fallbackSnapshot || {
      "STU-6101": [
        { warehouseName: "林口倉", batchNumber: "J013", availableQuantity: 2, productName: "STU 60X120 (PEARL)" },
        { warehouseName: "忠義倉", batchNumber: "J013", availableQuantity: 1, productName: "STU 60X120 (PEARL)" }
      ]
    };
  }

  validateRequestSecurity(req = {}) {
    const queryString = (req.queryString || req.url || '').toString();
    if (queryString.toLowerCase().includes('sessiontoken=')) {
      return {
        ok: false,
        errorCode: 'INSECURE_SESSION_TOKEN_IN_URL',
        message: 'Security Violation: sessionToken MUST NOT be transmitted via GET query string parameters'
      };
    }

    return { ok: true };
  }

  getInventorySnapshot(productCode, options = {}) {
    if (!productCode) {
      throw new Error('INVALID_PRODUCT_CODE: productCode is required');
    }

    if (this.fetcher) {
      try {
        const liveResult = this.fetcher(productCode, options);
        return liveResult;
      } catch (err) {
        if (options.fallbackSnapshotAllowed) {
          return {
            ok: true,
            isFallbackSnapshot: true,
            productCode,
            timestamp: new Date().toISOString(),
            warnings: [
              {
                warningCode: 'INVENTORY_FALLBACK_SNAPSHOT_USED',
                severity: 'WARNING',
                message: `即時 API 連線失敗 (${err.message})，已自動降級使用記憶體快照。`
              }
            ]
          };
        }

        return {
          ok: false,
          errorCode: 'INVENTORY_API_FAILURE',
          message: err.message
        };
      }
    }

    if (options.fallbackSnapshotAllowed) {
      return {
        ok: true,
        isFallbackSnapshot: true,
        productCode,
        timestamp: new Date().toISOString(),
        warnings: [
          {
            warningCode: 'INVENTORY_FALLBACK_SNAPSHOT_USED',
            severity: 'WARNING',
            message: '未設定即時 Fetcher，已自動使用記憶體快照。'
          }
        ]
      };
    }

    return {
      ok: false,
      errorCode: 'INVENTORY_FETCHER_MISSING',
      message: 'No live fetcher configured for LiveSheetInventoryAdapter'
    };
  }

  getWarehouseList() {
    return ['林口倉', '忠義倉'];
  }
}

module.exports = {
  isProductCodeMatchInRow,
  parseMasterInventoryRow,
  evaluateTwoTableReconciliation,
  LiveSheetInventoryAdapter
};
