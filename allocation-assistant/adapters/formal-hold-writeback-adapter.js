/**
 * Formal Hold Writeback Adapter (Pack 7B)
 * Formats reservation data into structured Google Sheet rows and generates RES-YYYYMMDD-XXX reservation numbers.
 */

const HOLDS_HEADERS = [
  'id',
  'storeId',
  'storeName',
  'salesOwner',
  'item',
  'quantity',
  'reservationStatus',
  'holdAddress',
  'holdDate',
  'expiresAt',
  'reminderAt',
  'note',
  'status',
  'createdAt',
  'updatedAt'
];

class FormalHoldWritebackAdapter {
  constructor(options = {}) {
    this.sheetAdapter = typeof options.appendHoldRecord === 'function'
      ? options
      : options.sheetAdapter || options.adapter || null;
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

  static get HOLDS_HEADERS() {
    return HOLDS_HEADERS.slice();
  }

  formatHoldRecord(reservation = {}) {
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days
    const reminder = new Date(expires.getTime() - 7 * 24 * 60 * 60 * 1000);

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
    const reminderAt = reservation.reminderAt || reminder.toISOString().split('T')[0];
    const note = reservation.note || reservation.sourceNote || '';
    const status = 'RESERVED';
    const createdAt = reservation.createdAt || now.toISOString();
    const updatedAt = reservation.updatedAt || createdAt;

    return {
      id: reservationNumber,
      storeId,
      storeName,
      salesOwner,
      item,
      quantity,
      reservationStatus,
      holdAddress,
      holdDate,
      expiresAt,
      reminderAt,
      note,
      status,
      createdAt,
      updatedAt
    };
  }

  formatHoldRow(reservation = {}) {
    const record = HOLDS_HEADERS.every(header => Object.prototype.hasOwnProperty.call(reservation, header))
      ? reservation
      : this.formatHoldRecord(reservation);
    return HOLDS_HEADERS.map(header => record[header]);
  }

  isConflictingReplay(existingRecord = {}, holdRecord = {}) {
    const replayComparisonFields = HOLDS_HEADERS.filter(header => !['createdAt', 'updatedAt'].includes(header));
    return replayComparisonFields.some(header => existingRecord[header] !== holdRecord[header]);
  }

  executeWriteback(reservationPayload = {}) {
    const holdRecord = this.formatHoldRecord(reservationPayload);
    const reservationNumber = holdRecord.id;
    const item = holdRecord.item;
    const quantity = holdRecord.quantity;
    const status = holdRecord.status;

    if (!this.sheetAdapter || typeof this.sheetAdapter.appendHoldRecord !== 'function') {
      return {
        success: false,
        reservationNumber,
        status: 'WRITE_FAILED',
        holdRecord,
        errorCode: 'HOLD_WRITE_ADAPTER_MISSING',
        lineConfirmationMessage: `⚠️ 去保留尚未寫入正式紀錄，缺少 Sheet 寫入能力：${reservationNumber}`
      };
    }

    let writeResult;
    try {
      writeResult = this.sheetAdapter.appendHoldRecord(holdRecord, { headers: HOLDS_HEADERS.slice() });
    } catch (err) {
      return {
        success: false,
        reservationNumber,
        status: 'WRITE_FAILED',
        holdRecord,
        errorCode: err && err.message ? err.message : 'HOLD_WRITE_FAILED',
        lineConfirmationMessage: `⚠️ 去保留寫入失敗：${reservationNumber}`
      };
    }

    if (!writeResult || writeResult.success !== true || writeResult.persisted !== true) {
      return {
        success: false,
        reservationNumber,
        status: 'WRITE_FAILED',
        holdRecord,
        errorCode: (writeResult && writeResult.errorCode) || 'HOLD_WRITE_FAILED',
        lineConfirmationMessage: `⚠️ 去保留尚未確認寫入正式紀錄：${reservationNumber}`
      };
    }

    if (writeResult.isReplay && writeResult.record && this.isConflictingReplay(writeResult.record, holdRecord)) {
      return {
        success: false,
        reservationNumber,
        status: 'WRITE_FAILED',
        holdRecord,
        errorCode: 'HOLD_IDEMPOTENCY_CONFLICT',
        lineConfirmationMessage: `⚠️ 去保留重送資料與既有正式紀錄不一致：${reservationNumber}`
      };
    }

    const lineConfirmationMessage = `✅ 已成功完成去保留劃扣！\n正式單號：${reservationNumber}\n品項數量：${item} * ${quantity} PCS\n狀態：${status}`;

    return {
      success: true,
      reservationNumber,
      status,
      holdRecord,
      rowData: HOLDS_HEADERS.map(header => holdRecord[header]),
      persisted: true,
      isReplay: Boolean(writeResult.isReplay),
      lineConfirmationMessage
    };
  }
}

module.exports = {
  FormalHoldWritebackAdapter
};
