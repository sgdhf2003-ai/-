/**
 * MockFormalReservationAdapter (In-Memory Reservation Adapter for Offline Simulation - Pack 4A)
 */

const { FormalReservationAdapter } = require('./formal-reservation-adapter');
const { validateSyncRequest, validateSyncResult } = require('../contracts/sync-contract');

class MockFormalReservationAdapter extends FormalReservationAdapter {
  constructor() {
    super();
    this.reservationsStore = new Map(); // holdIdempotencyKey -> SyncResult
    this.holdsStore = new Map(); // reservationNumber -> hold record
    this.inventoryAdjustments = [];
    this.simulatedFailureMode = 'NONE'; // 'NONE', 'UNKNOWN_OUTCOME', 'EXPLICIT_FAIL'
  }

  setSimulatedFailureMode(mode) {
    this.simulatedFailureMode = mode || 'NONE';
  }

  syncReservation(syncRequest) {
    const validatedReq = validateSyncRequest(syncRequest);
    const key = validatedReq.holdIdempotencyKey;

    const cached = this.reservationsStore.get(key);
    if (cached) {
      return validateSyncResult({
        ...cached,
        isReplay: true
      });
    }

    if (this.simulatedFailureMode === 'UNKNOWN_OUTCOME') {
      // Record hold internally but simulate network drop before returning response
      const hiddenResult = validateSyncResult({
        success: true,
        syncRequestId: validatedReq.syncRequestId,
        draftId: validatedReq.draftId,
        reservationId: `res_mock_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        status: 'SYNCED',
        syncedAt: new Date().toISOString(),
        isReplay: false
      });
      this.reservationsStore.set(key, hiddenResult);
      throw new Error('NETWORK_TIMEOUT_UNKNOWN_OUTCOME: Timeout waiting for reservation confirmation');
    }

    if (this.simulatedFailureMode === 'EXPLICIT_FAIL') {
      const failedResult = validateSyncResult({
        success: false,
        syncRequestId: validatedReq.syncRequestId,
        draftId: validatedReq.draftId,
        reservationId: '',
        status: 'SYNC_FAILED',
        syncedAt: new Date().toISOString(),
        errorCode: 'RESERVATION_REJECTED',
        isReplay: false
      });
      this.reservationsStore.set(key, failedResult);
      return failedResult;
    }

    const successResult = validateSyncResult({
      success: true,
      syncRequestId: validatedReq.syncRequestId,
      draftId: validatedReq.draftId,
      reservationId: `res_mock_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      status: 'SYNCED',
      syncedAt: new Date().toISOString(),
      isReplay: false
    });

    this.reservationsStore.set(key, successResult);
    return successResult;
  }

  queryReservationStatus(holdIdempotencyKey) {
    if (!holdIdempotencyKey) {
      return { found: false };
    }
    const record = this.reservationsStore.get(holdIdempotencyKey);
    if (record) {
      return {
        found: true,
        status: record.status,
        record: { ...record }
      };
    }
    return { found: false };
  }

  appendHoldRecord(holdRecord, options = {}) {
    if (!holdRecord || !holdRecord.id) {
      return { success: false, persisted: false, errorCode: 'HOLD_RECORD_INVALID' };
    }

    if (Array.isArray(options.headers)) {
      const keys = Object.keys(holdRecord);
      const sameHeaders = options.headers.length === keys.length &&
        options.headers.every((header, index) => header === keys[index]);
      if (!sameHeaders) {
        return { success: false, persisted: false, errorCode: 'HOLD_SCHEMA_MISMATCH' };
      }
    }

    const existing = this.holdsStore.get(holdRecord.id);
    if (existing) {
      return {
        success: true,
        persisted: true,
        reservationNumber: holdRecord.id,
        status: existing.status,
        record: { ...existing },
        isReplay: true
      };
    }

    const record = { ...holdRecord };
    this.holdsStore.set(record.id, record);
    return {
      success: true,
      persisted: true,
      reservationNumber: record.id,
      status: record.status,
      record: { ...record },
      isReplay: false
    };
  }

  queryHoldByReservationNumber(reservationNumber) {
    const record = this.holdsStore.get(reservationNumber);
    if (!record) return { found: false };
    return { found: true, record: { ...record } };
  }

  updateHoldStatus(update = {}) {
    const reservationNumber = update.reservationNumber;
    const existing = this.holdsStore.get(reservationNumber);
    if (!existing) {
      return { success: false, persisted: false, errorCode: 'HOLD_NOT_FOUND' };
    }

    const updated = {
      ...existing,
      status: update.status,
      fulfilledQuantity: update.fulfilledQuantity,
      remainingQuantity: update.remainingQuantity,
      updatedAt: update.updatedAt || new Date().toISOString()
    };
    this.holdsStore.set(reservationNumber, updated);
    return {
      success: true,
      persisted: true,
      reservationNumber,
      status: updated.status,
      record: { ...updated }
    };
  }

  recordInventoryAdjustment(adjustment = {}) {
    const entry = {
      ...adjustment,
      recordedAt: adjustment.recordedAt || new Date().toISOString()
    };
    this.inventoryAdjustments.push(entry);
    return {
      success: true,
      persisted: true,
      adjustment: { ...entry }
    };
  }
}

module.exports = {
  MockFormalReservationAdapter
};
