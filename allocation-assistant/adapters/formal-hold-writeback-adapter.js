/**
 * Formal Hold Writeback Adapter (Pack 7B)
 * Formats reservation data into structured Google Sheet rows and generates RES-YYYYMMDD-XXX reservation numbers.
 */

const { MockFormalReservationAdapter } = require('./mock-formal-reservation-adapter');

class FormalHoldWritebackAdapter {
  constructor(options = {}) {
    this.sheetAdapter = options.sheetAdapter || new MockFormalReservationAdapter();
    this.sequenceCounter = options.initialSequence || 1;
  }

  static generateReservationNumber(date = new Date(), sequence = 1) {
    const d = date instanceof Date ? date : new Date(date);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const seq = String(sequence).padStart(3, '0');
    return `RES-${yyyy}${mm}${dd}-${seq}`;
  }

  formatHoldRow(reservation = {}) {
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days

    const id = reservation.id || `hold_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const reservationNumber = reservation.reservationNumber || FormalHoldWritebackAdapter.generateReservationNumber(now, this.sequenceCounter++);
    const storeId = reservation.storeId || 'store_default';
    const storeName = reservation.storeName || '未指定店家';
    const salesOwner = reservation.salesOwner || '系統助理';
    const item = reservation.productCode || reservation.item || '未指定品項';
    const quantity = Number(reservation.quantity || reservation.allocatedQuantity || 0);
    const reservationStatus = '已收訂 (劃扣)';
    const whName = reservation.warehouseName || '預設倉';
    const batch = reservation.batchNumber ? ` - 批號 ${reservation.batchNumber}` : '';
    const holdAddress = `${whName}${batch}`;
    const holdDate = reservation.holdDate || now.toISOString().split('T')[0];
    const expiresAt = reservation.expiresAt || expires.toISOString().split('T')[0];
    const status = 'RESERVED';

    return [
      id,
      reservationNumber,
      storeId,
      storeName,
      salesOwner,
      item,
      quantity,
      reservationStatus,
      holdAddress,
      holdDate,
      expiresAt,
      status
    ];
  }

  executeWriteback(reservationPayload = {}) {
    const rowData = this.formatHoldRow(reservationPayload);
    const reservationNumber = rowData[1];
    const item = rowData[5];
    const quantity = rowData[6];
    const status = rowData[11];

    if (this.sheetAdapter && typeof this.sheetAdapter.appendHoldRow === 'function') {
      this.sheetAdapter.appendHoldRow(rowData);
    }

    const lineConfirmationMessage = `✅ 已成功完成去保留劃扣！\n正式單號：${reservationNumber}\n品項數量：${item} * ${quantity} PCS\n狀態：${status}`;

    return {
      success: true,
      reservationNumber,
      status,
      rowData,
      lineConfirmationMessage
    };
  }
}

module.exports = {
  FormalHoldWritebackAdapter
};
