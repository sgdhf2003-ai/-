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
    if (/^(?:結案|部分出貨)\s*#?\s*(.+)$/i.test(trimmed)) {
      const match = trimmed.match(/^(?:結案|部分出貨)\s*#?\s*(.+)$/i);
      return {
        isFulfillmentCommand: true,
        action: 'CLOSE_FULFILL',
        reservationNumber: match[1].trim()
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

    let status = 'FULFILLED';
    let remainingQuantity = 0;
    let lineNotificationMessage = '';

    if (action === 'FULL_FULFILL' || action === 'CLOSE_FULFILL') {
      status = 'FULFILLED';
      lineNotificationMessage = `🚚 單據 ${reservationNumber} 已完成全額出貨結案！庫存已正式扣除並記錄發票。`;
    } else if (action === 'PARTIAL_FULFILL') {
      status = 'PARTIALLY_FULFILLED';
      const fulfilledQty = Number(payload.fulfilledQuantity || 0);
      const totalQty = Number(payload.totalQuantity || 0);
      remainingQuantity = Math.max(0, totalQty - fulfilledQty);
      lineNotificationMessage = `✏️ 單據 ${reservationNumber} 已部分出貨 (${fulfilledQty} PCS)，剩餘 ${remainingQuantity} PCS 繼續保留中。`;
    } else if (action === 'CANCEL_FULFILL') {
      status = 'CANCELLED';
      lineNotificationMessage = `❌ 單據 ${reservationNumber} 已取消保留，預留庫存已釋放歸還至可用庫存池。`;
    }

    return {
      success: true,
      reservationNumber,
      action,
      status,
      remainingQuantity,
      lineNotificationMessage
    };
  }
}

module.exports = {
  FulfillmentAdapter
};
