/**
 * AuditEvent, SyncRequest & SyncResult Contract Validators
 */

function validateAuditEvent(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('AuditEvent must be a non-null object');
  }

  const eventId = (data.eventId || '').toString().trim();
  const action = (data.action || '').toString().trim();
  if (!action) {
    throw new Error('action is required');
  }

  return {
    eventId: eventId || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: data.timestamp || new Date().toISOString(),
    operator: (data.operator || 'SYSTEM').toString(),
    action,
    draftId: (data.draftId || '').toString(),
    details: (data.details || '').toString()
  };
}

function validateSyncRequest(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('SyncRequest must be a non-null object');
  }

  const requestId = (data.requestId || '').toString().trim();
  const draftId = (data.draftId || '').toString().trim();
  const idempotencyKey = (data.idempotencyKey || '').toString().trim();

  if (!draftId || !idempotencyKey) {
    throw new Error('draftId and idempotencyKey are required');
  }

  return {
    requestId: requestId || `sync_req_${Date.now()}`,
    draftId,
    idempotencyKey,
    reservationData: data.reservationData || {}
  };
}

function validateSyncResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('SyncResult must be a non-null object');
  }

  const success = Boolean(data.success);
  return {
    success,
    reservationId: (data.reservationId || '').toString(),
    syncedAt: data.syncedAt || new Date().toISOString(),
    errorCode: (data.errorCode || '').toString()
  };
}

module.exports = {
  validateAuditEvent,
  validateSyncRequest,
  validateSyncResult
};
