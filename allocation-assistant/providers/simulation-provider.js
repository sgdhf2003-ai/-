/**
 * SimulationProvider (In-Memory Draft Store & Idempotency Cache with Audit Logging & Inventory Adapter Integration)
 */

const { AllocationProvider } = require('./allocation-provider');
const { validateAllocationDraft, DRAFT_STATUSES } = require('../contracts/draft-contract');
const { AuditLogger } = require('../audit/audit-logger');
const { evaluateAllocationRules } = require('../rules/allocation-rules');

class SimulationProvider extends AllocationProvider {
  constructor(options = {}) {
    super();
    this.draftsStore = new Map(); // draftId -> draft object
    this.idempotencyCache = new Map(); // idempotencyKey -> { payloadHash, response }
    this.auditLogger = new AuditLogger();
    this.inventoryAdapter = options.inventoryAdapter || null;
  }

  setInventoryAdapter(adapter) {
    this.inventoryAdapter = adapter;
  }

  _hashPayload(payload) {
    return JSON.stringify(payload || {});
  }

  _checkIdempotency(key, payload) {
    if (!key) return null;
    const cached = this.idempotencyCache.get(key);
    if (!cached) return null;

    const currentHash = this._hashPayload(payload);
    if (cached.payloadHash === currentHash) {
      return { ...cached.response, isReplay: true };
    } else {
      throw new Error('IDEMPOTENCY_CONFLICT: Key reused with conflicting payload');
    }
  }

  _saveIdempotency(key, payload, response) {
    if (!key) return;
    this.idempotencyCache.set(key, {
      payloadHash: this._hashPayload(payload),
      response: { ...response }
    });
  }

  createDraft(payload) {
    const key = payload ? payload.idempotencyKey : null;
    const replay = this._checkIdempotency(key, payload);
    if (replay) return replay;

    const draftId = payload.draftId || `draft_sim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const items = Array.isArray(payload.items) ? payload.items : [];

    // Simple OCR parsing fallback if rawText provided and items empty
    if (items.length === 0 && payload.rawText) {
      const parts = payload.rawText.split('*');
      const productCode = (parts[0] || 'UNKNOWN_ITEM').trim();
      const requestedQuantity = parseInt(parts[1] || '1', 10) || 1;
      items.push({
        itemId: `item_1`,
        productCode,
        requestedQuantity,
        parsedConfidence: 0.95,
        rawOcrText: payload.rawText
      });
    }

    const draftData = {
      draftId,
      tenantContext: {
        tenantId: payload.tenantId || 'tenant-jy-001',
        companyId: payload.companyId || 'comp-jingyang-taiwan'
      },
      status: DRAFT_STATUSES.DRAFT,
      sourceSystem: payload.sourceSystem || 'SIMULATION',
      sourceDraftId: payload.sourceDraftId || '',
      idempotencyKey: key || '',
      salesOwner: payload.salesOwner || 'sim_clerk',
      items
    };

    const validatedDraft = validateAllocationDraft(draftData);
    this.draftsStore.set(draftId, validatedDraft);

    this.auditLogger.logEvent({
      operator: payload.salesOwner || 'sim_clerk',
      action: 'CREATE_DRAFT',
      draftId,
      correlationId: payload.correlationId || '',
      tenantId: validatedDraft.tenantContext.tenantId,
      companyId: validatedDraft.tenantContext.companyId,
      details: `Created draft ${draftId}`
    });

    const response = {
      success: true,
      draftId,
      status: validatedDraft.status,
      isReplay: false,
      errorCode: ''
    };

    this._saveIdempotency(key, payload, response);
    return response;
  }

  analyzeAllocation(draftId, idempotencyKey, explicitSnapshot) {
    const key = idempotencyKey;
    const payload = { draftId, explicitSnapshot };
    const replay = this._checkIdempotency(key, payload);
    if (replay) return replay;

    const draft = this.draftsStore.get(draftId);
    if (!draft) {
      throw new Error(`DRAFT_NOT_FOUND: Draft ${draftId} does not exist`);
    }

    if (draft.status === DRAFT_STATUSES.CANCELLED) {
      throw new Error(`INVALID_DRAFT_STATE: Draft ${draftId} is CANCELLED and cannot be analyzed`);
    }

    let suggestion = null;
    const firstItem = draft.items[0];

    if (firstItem) {
      let snapshot = explicitSnapshot || null;

      if (!snapshot && this.inventoryAdapter) {
        try {
          snapshot = this.inventoryAdapter.getInventorySnapshot(firstItem.productCode, draft.tenantContext);
        } catch (err) {
          snapshot = null;
        }
      }

      if (!snapshot) {
        snapshot = {
          snapshotId: `snap_empty_${Date.now()}`,
          productCode: firstItem.productCode,
          timestamp: new Date().toISOString(),
          warehouses: []
        };
      }

      const evalResult = evaluateAllocationRules({
        item: firstItem,
        snapshot,
        customerApprovedMixedBatch: false
      });

      suggestion = evalResult.suggestion;
    }

    this.auditLogger.logEvent({
      operator: draft.salesOwner || 'sim_clerk',
      action: 'ANALYZE_ALLOCATION',
      draftId,
      correlationId: draft.idempotencyKey || '',
      tenantId: draft.tenantContext.tenantId,
      companyId: draft.tenantContext.companyId,
      details: `Analyzed allocation for draft ${draftId}`
    });

    const response = {
      success: true,
      draftId,
      status: DRAFT_STATUSES.ALLOCATION_REVIEW,
      suggestion,
      isReplay: false,
      errorCode: ''
    };

    this._saveIdempotency(key, payload, response);
    return response;
  }

  confirmAllocation(draftId, confirmedItems, idempotencyKey) {
    const key = idempotencyKey;
    const payload = { draftId, confirmedItems };
    const replay = this._checkIdempotency(key, payload);
    if (replay) return replay;

    const draft = this.draftsStore.get(draftId);
    if (!draft) {
      throw new Error(`DRAFT_NOT_FOUND: Draft ${draftId} does not exist`);
    }

    if (draft.status === DRAFT_STATUSES.CANCELLED) {
      throw new Error(`INVALID_DRAFT_STATE: Draft ${draftId} is CANCELLED`);
    }

    draft.status = DRAFT_STATUSES.ALLOCATION_CONFIRMED;
    draft.updatedAt = new Date().toISOString();
    this.draftsStore.set(draftId, draft);

    this.auditLogger.logEvent({
      operator: draft.salesOwner || 'sim_clerk',
      action: 'CONFIRM_ALLOCATION',
      draftId,
      correlationId: idempotencyKey || '',
      tenantId: draft.tenantContext.tenantId,
      companyId: draft.tenantContext.companyId,
      details: `Confirmed allocation for draft ${draftId}`
    });

    const response = {
      success: true,
      draftId,
      status: DRAFT_STATUSES.ALLOCATION_CONFIRMED,
      isReplay: false,
      errorCode: ''
    };

    this._saveIdempotency(key, payload, response);
    return response;
  }

  cancelAllocation(draftId) {
    const draft = this.draftsStore.get(draftId);
    if (!draft) {
      throw new Error(`DRAFT_NOT_FOUND: Draft ${draftId} does not exist`);
    }

    draft.status = DRAFT_STATUSES.CANCELLED;
    draft.updatedAt = new Date().toISOString();
    this.draftsStore.set(draftId, draft);

    this.auditLogger.logEvent({
      operator: draft.salesOwner || 'sim_clerk',
      action: 'CANCEL_ALLOCATION',
      draftId,
      correlationId: draft.idempotencyKey || '',
      tenantId: draft.tenantContext.tenantId,
      companyId: draft.tenantContext.companyId,
      details: `Cancelled draft ${draftId}`
    });

    return {
      success: true,
      draftId,
      status: DRAFT_STATUSES.CANCELLED,
      errorCode: ''
    };
  }

  getAllocationStatus(draftId) {
    const draft = this.draftsStore.get(draftId);
    if (!draft) {
      throw new Error(`DRAFT_NOT_FOUND: Draft ${draftId} does not exist`);
    }

    return {
      success: true,
      draft,
      errorCode: ''
    };
  }
}

module.exports = {
  SimulationProvider
};
