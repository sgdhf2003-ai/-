/**
 * AllocationDraft & AllocationDraftItem Contract Validators
 */

const { validateTenantContext } = require('./tenant-context');

const DRAFT_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  OCR_REVIEW: 'OCR_REVIEW',
  ALLOCATION_REVIEW: 'ALLOCATION_REVIEW',
  ALLOCATION_CONFIRMED: 'ALLOCATION_CONFIRMED',
  SYNC_PENDING: 'SYNC_PENDING',
  SYNC_IN_PROGRESS: 'SYNC_IN_PROGRESS',
  SYNCED: 'SYNCED',
  SYNC_FAILED: 'SYNC_FAILED',
  CANCELLED: 'CANCELLED'
});

function validateAllocationDraftItem(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('AllocationDraftItem must be a non-null object');
  }

  const itemId = (data.itemId || '').toString().trim();
  const productCode = (data.productCode || '').toString().trim();
  if (!productCode) {
    throw new Error('productCode is required');
  }

  const requestedQuantity = Number(data.requestedQuantity);
  if (isNaN(requestedQuantity) || requestedQuantity <= 0) {
    throw new Error('requestedQuantity must be greater than 0');
  }

  const parsedConfidence = data.parsedConfidence !== undefined ? Number(data.parsedConfidence) : 1.0;

  return {
    itemId: itemId || `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    productCode,
    requestedQuantity,
    parsedConfidence: isNaN(parsedConfidence) ? 1.0 : parsedConfidence,
    rawOcrText: (data.rawOcrText || '').toString()
  };
}

function validateAllocationDraft(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('AllocationDraft must be a non-null object');
  }

  const draftId = (data.draftId || '').toString().trim();
  if (!draftId) {
    throw new Error('draftId is required');
  }

  const tenantContext = validateTenantContext(data.tenantContext);

  const status = (data.status || DRAFT_STATUSES.DRAFT).toString().trim();
  if (!Object.values(DRAFT_STATUSES).includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const items = Array.isArray(data.items)
    ? data.items.map(validateAllocationDraftItem)
    : [];

  return {
    draftId,
    tenantContext,
    status,
    sourceSystem: (data.sourceSystem || 'MANUAL').toString(),
    sourceDraftId: (data.sourceDraftId || '').toString(),
    idempotencyKey: (data.idempotencyKey || '').toString(),
    salesOwner: (data.salesOwner || '').toString(),
    storeId: (data.storeId || '').toString(),
    storeName: (data.storeName || '').toString(),
    items,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString()
  };
}

module.exports = {
  DRAFT_STATUSES,
  validateAllocationDraftItem,
  validateAllocationDraft
};
