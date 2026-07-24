/**
 * Base Abstract AllocationProvider Class
 */

class AllocationProvider {
  createDraft(payload) {
    throw new Error('AllocationProvider.createDraft() must be implemented');
  }

  analyzeAllocation(draftId, idempotencyKey, inventorySnapshot) {
    throw new Error('AllocationProvider.analyzeAllocation() must be implemented');
  }

  confirmAllocation(draftId, confirmedItems, idempotencyKey) {
    throw new Error('AllocationProvider.confirmAllocation() must be implemented');
  }

  cancelAllocation(draftId) {
    throw new Error('AllocationProvider.cancelAllocation() must be implemented');
  }

  getAllocationStatus(draftId) {
    throw new Error('AllocationProvider.getAllocationStatus() must be implemented');
  }
}

module.exports = {
  AllocationProvider
};
