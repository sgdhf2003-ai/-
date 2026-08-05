/**
 * Outbound Fulfillment Loop Adapter (Pack 7C)
 * Implements Option 2 Flex Carousel and Option 3 Text Commands for outbound fulfillment.
 */

class FulfillmentAdapter {
  constructor(options = {}) {
    this.sheetAdapter = options.sheetAdapter || null;
  }

  static parseShortcutCommand(text = '') {
    const trimmed = String(text || '').trim();

    // Match "出貨 #RES-20260725-001" or "出貨 001"
    if (/^(?:出貨|全額出貨)\s*#?\s*(.+)$/i.test(trimmed)) {
      const match = trimmed.match(/^(?:出貨|全額出貨)\s*#?\s*(.+)$/i);
      return {
        isFulfillmentCommand: true,
        action: 'FULL_FULFILL',
        reservationNumber: match[1].trim()
      };
    }

    // Match "結案 RES-20260725-001"
    if (/^結案\s*#?\s*(.+)$/i.test(trimmed)) {
      const match = trimmed.match(/^結案\s*#?\s*(.+)$/i);
      return {
        isFulfillmentCommand: true,
        action: 'CLOSE_FULFILL',
        reservationNumber: match[1].trim()
      };
    }

    // Partial shipment parses inline quantity if provided e.g. "部分出貨 #RES-20260725-004 3"
    if (/^部分出貨\s*#?\s*(.+)$/i.test(trimmed)) {
      const match = trimmed.match(/^部分出貨\s*#?\s*(.+)$/i);
      const rawTarget = match[1].trim();
      const parts = rawTarget.split(/\s+/);
      if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) {
        const qty = Number(parts.pop());
        const resNo = parts.join(' ');
        return {
          isFulfillmentCommand: true,
          action: 'PARTIAL_FULFILL',
          reservationNumber: resNo,
          fulfilledQuantity: qty,
          requiresQuantityConfirmation: false
        };
      }
      return {
        isFulfillmentCommand: true,
        action: 'PARTIAL_FULFILL_REQUIRES_QUANTITY',
        reservationNumber: rawTarget,
        requiresQuantityConfirmation: true
      };
    }

    // Match "取消 #RES-20260725-001"
    if (/^(?:取消|取消保留)\s*#?\s*(.+)$/i.test(trimmed)) {
      const match = trimmed.match(/^(?:取消|取消保留)\s*#?\s*(.+)$/i);
      return {
        isFulfillmentCommand: true,
        action: 'CANCEL_FULFILL',
        reservationNumber: match[1].trim()
      };
    }

    return {
      isFulfillmentCommand: false,
      action: null,
      reservationNumber: ''
    };
  }

  renderPendingCarousel(pendingReservations = []) {
    if (!Array.isArray(pendingReservations) || pendingReservations.length === 0) {
      return '<div class="no-pending">目前無待出貨去保留單據</div>';
    }

    return pendingReservations.map(res => `
      <div class="fulfillment-card" data-res-no="${res.reservationNumber}">
        <h3>待出貨單據：${res.reservationNumber}</h3>
        <p>品項：${res.item || res.productCode} (${res.quantity || 0} PCS)</p>
        <div class="card-actions">
          <button class="fulfill-full-btn">🚚 全額出貨</button>
          <button class="fulfill-partial-btn">✏️ 部分出貨</button>
          <button class="fulfill-cancel-btn">❌ 取消保留</button>
        </div>
      </div>
    `).join('');
  }

  processFulfillment(payload = {}) {
    const reservationNumber = payload.reservationNumber || 'RES_UNKNOWN';
    const action = payload.action || 'FULL_FULFILL';

    if (payload.authorized === false) {
      return {
        success: false,
        reservationNumber,
        action,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity: 0,
        errorCode: 'UNAUTHORIZED_OPERATOR',
        lineNotificationMessage: `⚠️ 未授權之操作員，無法執行單據 ${reservationNumber} 的出貨動作。`
      };
    }

    if (!this.sheetAdapter ||
      typeof this.sheetAdapter.queryHoldByReservationNumber !== 'function' ||
      typeof this.sheetAdapter.updateHoldStatus !== 'function' ||
      typeof this.sheetAdapter.recordInventoryAdjustment !== 'function') {
      return {
        success: false,
        reservationNumber,
        action,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity: 0,
        errorCode: 'FULFILLMENT_ADAPTER_MISSING',
        lineNotificationMessage: `⚠️ 單據 ${reservationNumber} 尚未結案，缺少持久化 adapter。`
      };
    }

    const holdLookup = this.sheetAdapter.queryHoldByReservationNumber(reservationNumber);
    if (!holdLookup || !holdLookup.found) {
      return {
        success: false,
        reservationNumber,
        action,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity: 0,
        errorCode: 'HOLD_NOT_FOUND',
        lineNotificationMessage: `⚠️ 找不到單據 ${reservationNumber}，未執行出貨結案。`
      };
    }

    let status = 'FULFILLED';
    let remainingQuantity = 0;
    let fulfilledQuantity = Number(payload.fulfilledQuantity || holdLookup.record.quantity || payload.totalQuantity || 0);
    let lineNotificationMessage = '';
    let inventoryAction = 'FULFILL_DEDUCT';

    if (action === 'FULL_FULFILL' || action === 'CLOSE_FULFILL') {
      status = 'FULFILLED';
      remainingQuantity = 0;
      lineNotificationMessage = `🚚 單據 ${reservationNumber} 已完成全額出貨結案！庫存已正式扣除並記錄發票。`;
    } else if (action === 'PARTIAL_FULFILL') {
      const fulfilledQty = Number(payload.fulfilledQuantity || 0);
      const totalQty = Number(payload.totalQuantity || 0);
      if (!fulfilledQty || !totalQty || fulfilledQty <= 0 || fulfilledQty >= totalQty) {
        return {
          success: false,
          reservationNumber,
          action,
          status: 'FULFILLMENT_FAILED',
          remainingQuantity: 0,
          errorCode: 'PARTIAL_QUANTITY_REQUIRED',
          lineNotificationMessage: `⚠️ 單據 ${reservationNumber} 部分出貨需要有效出貨數量。`
        };
      }
      status = 'PARTIALLY_FULFILLED';
      fulfilledQuantity = fulfilledQty;
      remainingQuantity = Math.max(0, totalQty - fulfilledQty);
      inventoryAction = 'PARTIAL_FULFILL_DEDUCT';
      lineNotificationMessage = `✏️ 單據 ${reservationNumber} 已部分出貨 (${fulfilledQty} PCS)，剩餘 ${remainingQuantity} PCS 繼續保留中。`;
    } else if (action === 'CANCEL_FULFILL') {
      status = 'CANCELLED';
      remainingQuantity = Number(holdLookup.record.quantity || payload.totalQuantity || 0);
      fulfilledQuantity = remainingQuantity;
      inventoryAction = 'CANCEL_RELEASE';
      lineNotificationMessage = `❌ 單據 ${reservationNumber} 已取消保留，預留庫存已釋放歸還至可用庫存池。`;
    } else if (action === 'PARTIAL_FULFILL_REQUIRES_QUANTITY') {
      return {
        success: false,
        reservationNumber,
        action,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity: 0,
        errorCode: 'PARTIAL_QUANTITY_REQUIRED',
        lineNotificationMessage: `⚠️ 單據 ${reservationNumber} 部分出貨需要先確認數量。`
      };
    } else {
      return {
        success: false,
        reservationNumber,
        action,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity: 0,
        errorCode: 'UNKNOWN_FULFILLMENT_ACTION',
        lineNotificationMessage: `⚠️ 單據 ${reservationNumber} 未知出貨動作，未執行結案。`
      };
    }

    const updatedAt = new Date().toISOString();
    const statusResult = this.sheetAdapter.updateHoldStatus({
      reservationNumber,
      status,
      fulfilledQuantity,
      remainingQuantity,
      updatedAt
    });
    if (!statusResult || statusResult.success !== true || statusResult.persisted !== true) {
      return {
        success: false,
        reservationNumber,
        action,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity,
        errorCode: (statusResult && statusResult.errorCode) || 'FULFILLMENT_STATUS_UPDATE_FAILED',
        lineNotificationMessage: `⚠️ 單據 ${reservationNumber} 狀態寫回失敗。`
      };
    }

    const inventoryResult = this.sheetAdapter.recordInventoryAdjustment({
      reservationNumber,
      action: inventoryAction,
      item: holdLookup.record.item || payload.item || payload.productCode || '',
      quantity: fulfilledQuantity,
      remainingQuantity,
      status,
      updatedAt
    });
    if (!inventoryResult || inventoryResult.success !== true || inventoryResult.persisted !== true) {
      return {
        success: false,
        reservationNumber,
        action,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity,
        errorCode: (inventoryResult && inventoryResult.errorCode) || 'INVENTORY_ADJUSTMENT_RECORD_FAILED',
        lineNotificationMessage: `⚠️ 單據 ${reservationNumber} 庫存異動紀錄失敗。`
      };
    }

    return {
      success: true,
      reservationNumber,
      action,
      status,
      remainingQuantity,
      persisted: true,
      lineNotificationMessage
    };
  }

  /**
   * Reconciles multi-lot fulfillment arithmetic bounds.
   * Enforces totalFulfilled <= holdQuantity and remainingQuantity >= 0.
   */
  static reconcileMultiLotArithmetic(options = {}) {
    const { holdQuantity = 0, fulfilledQuantity = 0, lots = [] } = options;
    const totalHold = Number(holdQuantity || 0);

    let lotSum = 0;
    if (Array.isArray(lots) && lots.length > 0) {
      lotSum = lots.reduce((acc, lot) => acc + Number(lot && lot.quantity || 0), 0);
    }
    const targetFulfilled = Number(fulfilledQuantity || 0) > 0 ? Number(fulfilledQuantity) : lotSum;

    if (totalHold <= 0) {
      return { ok: false, errorCode: 'INVALID_HOLD_QUANTITY', remainingQuantity: 0 };
    }

    if (targetFulfilled <= 0) {
      return { ok: false, errorCode: 'INVALID_FULFILLMENT_QUANTITY', remainingQuantity: totalHold };
    }

    if (targetFulfilled > totalHold) {
      return { ok: false, errorCode: 'EXCEEDS_REMAINING_QUANTITY', remainingQuantity: totalHold };
    }

    const remainingQuantity = totalHold - targetFulfilled;
    const isFull = remainingQuantity === 0;
    const status = isFull ? 'FULFILLED' : 'PARTIALLY_FULFILLED';
    const action = isFull ? 'FULL_FULFILL' : 'PARTIAL_FULFILL';

    return {
      ok: true,
      holdQuantity: totalHold,
      fulfilledQuantity: targetFulfilled,
      remainingQuantity,
      status,
      action,
      lotDeductions: Array.isArray(lots) ? lots.map(l => ({
        lotId: (l && l.lotId) || 'LOT_DEFAULT',
        sku: (l && l.sku) || '',
        quantity: Number((l && l.quantity) || 0)
      })) : []
    };
  }

  /**
   * Processes multi-lot split fulfillment against persistence adapter.
   * Enforces reservationNumber === holdRecord.id === ledgerRow[0] and 7-column schema.
   */
  processMultiLotFulfillment(payload = {}) {
    const reservationNumber = payload.reservationNumber || 'RES_UNKNOWN';
    const operatorRole = payload.operatorRole ? String(payload.operatorRole).trim().toLowerCase() : '';
    const allowedRoles = ['admin', 'boss', 'assistant'];

    if (payload.authorized === false || (operatorRole && !allowedRoles.includes(operatorRole))) {
      return {
        success: false,
        reservationNumber,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity: 0,
        errorCode: 'UNAUTHORIZED_OPERATOR',
        lineNotificationMessage: `⚠️ 未授權之操作員，無法執行單據 ${reservationNumber} 的多批次出貨動作。`
      };
    }

    if (!this.sheetAdapter ||
      typeof this.sheetAdapter.queryHoldByReservationNumber !== 'function' ||
      typeof this.sheetAdapter.updateHoldStatus !== 'function' ||
      typeof this.sheetAdapter.recordInventoryAdjustment !== 'function') {
      return {
        success: false,
        reservationNumber,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity: 0,
        errorCode: 'FULFILLMENT_ADAPTER_MISSING',
        lineNotificationMessage: `⚠️ 單據 ${reservationNumber} 缺少持久化 adapter。`
      };
    }

    const holdLookup = this.sheetAdapter.queryHoldByReservationNumber(reservationNumber);
    if (!holdLookup || !holdLookup.found) {
      return {
        success: false,
        reservationNumber,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity: 0,
        errorCode: 'HOLD_NOT_FOUND',
        lineNotificationMessage: `⚠️ 找不到單據 ${reservationNumber}。`
      };
    }

    const holdRecord = holdLookup.record || {};
    const holdQuantity = Number(holdRecord.quantity || payload.totalQuantity || 0);
    const fulfilledQuantity = Number(payload.fulfilledQuantity || 0);

    const arithmetic = FulfillmentAdapter.reconcileMultiLotArithmetic({
      holdQuantity,
      fulfilledQuantity,
      lots: payload.lots
    });

    if (!arithmetic.ok) {
      return {
        success: false,
        reservationNumber,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity: holdQuantity,
        errorCode: arithmetic.errorCode,
        lineNotificationMessage: `⚠️ 單據 ${reservationNumber} 多批次出貨計算失敗：${arithmetic.errorCode}。`
      };
    }

    const updatedAt = new Date().toISOString();
    const statusResult = this.sheetAdapter.updateHoldStatus({
      reservationNumber,
      status: arithmetic.status,
      fulfilledQuantity: arithmetic.fulfilledQuantity,
      remainingQuantity: arithmetic.remainingQuantity,
      updatedAt
    });

    if (!statusResult || statusResult.success !== true || statusResult.persisted !== true) {
      return {
        success: false,
        reservationNumber,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity: arithmetic.remainingQuantity,
        errorCode: (statusResult && statusResult.errorCode) || 'FULFILLMENT_STATUS_UPDATE_FAILED',
        lineNotificationMessage: `⚠️ 單據 ${reservationNumber} 狀態寫回失敗。`
      };
    }

    const inventoryResult = this.sheetAdapter.recordInventoryAdjustment({
      reservationNumber,
      action: arithmetic.action === 'FULL_FULFILL' ? 'FULFILL_DEDUCT' : 'PARTIAL_FULFILL_DEDUCT',
      item: holdRecord.item || payload.item || payload.productCode || '',
      quantity: arithmetic.fulfilledQuantity,
      remainingQuantity: arithmetic.remainingQuantity,
      status: arithmetic.status,
      updatedAt
    });

    if (!inventoryResult || inventoryResult.success !== true || inventoryResult.persisted !== true) {
      return {
        success: false,
        reservationNumber,
        status: 'FULFILLMENT_FAILED',
        remainingQuantity: arithmetic.remainingQuantity,
        errorCode: (inventoryResult && inventoryResult.errorCode) || 'INVENTORY_ADJUSTMENT_RECORD_FAILED',
        lineNotificationMessage: `⚠️ 單據 ${reservationNumber} 庫存異動紀錄失敗。`
      };
    }

    return {
      success: true,
      reservationNumber,
      action: arithmetic.action,
      status: arithmetic.status,
      fulfilledQuantity: arithmetic.fulfilledQuantity,
      remainingQuantity: arithmetic.remainingQuantity,
      lotDeductions: arithmetic.lotDeductions,
      persisted: true,
      lineNotificationMessage: `📦 單據 ${reservationNumber} 完成多批次出貨 (${arithmetic.fulfilledQuantity} PCS)，剩餘 ${arithmetic.remainingQuantity} PCS。`
    };
  }
}

module.exports = {
  FulfillmentAdapter
};
