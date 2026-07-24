/**
 * SyncRequest & SyncResult Plain Object Contracts (Pack 4A)
 */

function validateSyncRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('SyncRequest must be a non-null object');
  }

  const syncRequestId = (payload.syncRequestId || payload.requestId || `sync_req_${Date.now()}`).toString();
  const draftId = (payload.draftId || '').toString();
  const holdIdempotencyKey = (payload.holdIdempotencyKey || payload.idempotencyKey || '').toString();

  if (!draftId || !holdIdempotencyKey) {
    throw new Error('draftId and holdIdempotencyKey are required in SyncRequest');
  }

  const tenantId = (payload.tenantContext && payload.tenantContext.tenantId) || 'tenant-jy-001';
  const companyId = (payload.tenantContext && payload.tenantContext.companyId) || 'comp-jy';

  const items = Array.isArray(payload.items)
    ? payload.items.map(item => ({
        productCode: (item.productCode || '').toString(),
        warehouseName: (item.warehouseName || '').toString(),
        batchNumber: (item.batchNumber || '').toString(),
        quantity: Math.max(1, parseInt(item.quantity || item.allocatedQuantity || 0, 10))
      }))
    : [];

  return Object.freeze({
    syncRequestId,
    requestId: syncRequestId, // backward-compatibility alias
    draftId,
    holdIdempotencyKey,
    idempotencyKey: holdIdempotencyKey, // backward-compatibility alias
    tenantContext: Object.freeze({ tenantId, companyId }),
    items: Object.freeze(items),
    reservationData: payload.reservationData || null,
    requestedAt: payload.requestedAt || new Date().toISOString()
  });
}

function validateSyncResult(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('SyncResult must be a non-null object');
  }

  const validStatuses = ['SYNCED', 'SYNC_FAILED', 'SYNC_PENDING'];
  const status = (payload.status || (payload.success ? 'SYNCED' : 'SYNC_FAILED')).toString().toUpperCase();

  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid SyncResult status: ${payload.status}`);
  }

  return Object.freeze({
    success: Boolean(payload.success),
    syncRequestId: (payload.syncRequestId || payload.requestId || '').toString(),
    draftId: (payload.draftId || '').toString(),
    reservationId: (payload.reservationId || '').toString(),
    status,
    syncedAt: payload.syncedAt || new Date().toISOString(),
    errorCode: (payload.errorCode || '').toString(),
    isReplay: Boolean(payload.isReplay)
  });
}

module.exports = {
  validateSyncRequest,
  validateSyncResult
};
