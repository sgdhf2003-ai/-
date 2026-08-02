const { evaluateUserPermission, sanitizeReadbackAuditRecord } = require('../rules/allocation-rules');

class AllocationGatewayClient {
  constructor({ gateway, uiState, tenantParams = {} }) {
    if (!gateway || !uiState) {
      throw new Error('gateway and uiState are required for AllocationGatewayClient');
    }
    this.gateway = gateway;
    this.uiState = uiState;
    this.gatewayParams = {
      contractVersion: tenantParams.contractVersion || 'v1.0.0',
      tenantId: tenantParams.tenantId || 'tenant-jy-001',
      companyId: tenantParams.companyId || 'comp-jy',
      providerMode: tenantParams.providerMode || 'SIMULATION'
    };
  }

  _generateKey(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  }

  createFormalHold(holdPayload, userContext) {
    const role = userContext ? userContext.role : null;
    const perm = evaluateUserPermission(role, 'upsertHold', holdPayload ? holdPayload.status : null);
    if (!perm.allowed) {
      return { ok: false, errorCode: perm.errorCode, message: perm.message };
    }

    if (!holdPayload || typeof holdPayload !== 'object' || !holdPayload.item) {
      return { ok: false, errorCode: 'INVALID_HOLD_PAYLOAD', message: '劃扣資料不完整' };
    }

    const reservationNumber = holdPayload.reservationNumber || holdPayload.id || `RES-${Date.now()}`;
    const holdRecord = {
      ...holdPayload,
      id: reservationNumber,
      reservationNumber,
      status: holdPayload.status || 'ACTIVE',
      notificationBypassed: true,
      updatedAt: new Date().toISOString()
    };

    return {
      ok: true,
      reservationNumber,
      holdRecord,
      notificationBypassed: true,
      message: '正式保留劃扣建立成功'
    };
  }

  fulfillHold(fulfillPayload, userContext) {
    const role = userContext ? userContext.role : null;
    const perm = evaluateUserPermission(role, 'fulfillHold');
    if (!perm.allowed) {
      return { ok: false, errorCode: perm.errorCode, message: perm.message };
    }

    if (!fulfillPayload || !fulfillPayload.reservationNumber || !fulfillPayload.quantity || fulfillPayload.quantity <= 0) {
      return { ok: false, errorCode: 'INVALID_FULFILL_PAYLOAD', message: '部分銷扣出貨數量無效' };
    }

    const remainingQty = Math.max(0, (fulfillPayload.totalQuantity || fulfillPayload.quantity) - fulfillPayload.quantity);
    const ledgerRow = [
      fulfillPayload.reservationNumber,
      fulfillPayload.action || 'FULFILL_PARTIAL',
      fulfillPayload.item || '品項',
      fulfillPayload.quantity,
      remainingQty,
      remainingQty === 0 ? 'FULFILLED' : 'PARTIAL_FULFILLED',
      new Date().toISOString()
    ];

    return {
      ok: true,
      reservationNumber: fulfillPayload.reservationNumber,
      remainingQuantity: remainingQty,
      ledgerRow,
      notificationBypassed: true,
      message: '劃扣銷扣出貨成功'
    };
  }

  cancelReleaseHold(cancelPayload, userContext) {
    const role = userContext ? userContext.role : null;
    const perm = evaluateUserPermission(role, 'cancelRelease');
    if (!perm.allowed) {
      return { ok: false, errorCode: perm.errorCode, message: perm.message };
    }

    if (!cancelPayload || !cancelPayload.reservationNumber) {
      return { ok: false, errorCode: 'INVALID_CANCEL_PAYLOAD', message: '取消釋放劃扣單號無效' };
    }

    const ledgerRow = [
      cancelPayload.reservationNumber,
      'CANCEL_RELEASE',
      cancelPayload.item || '品項',
      cancelPayload.quantity || 0,
      0,
      'CANCELLED',
      new Date().toISOString()
    ];

    return {
      ok: true,
      reservationNumber: cancelPayload.reservationNumber,
      remainingQuantity: 0,
      ledgerRow,
      notificationBypassed: true,
      message: '劃扣保留取消與庫存釋放成功'
    };
  }

  queryReadbackAudit(record, userContext) {
    const role = userContext ? userContext.role : null;
    return sanitizeReadbackAuditRecord(record, role);
  }

  submitRawText(rawText) {
    try {
      this.uiState.lastError = null;
      this.uiState.setRawOrderText(rawText);

      const correlationId = this._generateKey('corr');
      const createIdemKey = this._generateKey('idem_create');

      const createRes = this.gateway.createDraft({
        ...this.gatewayParams,
        idempotencyKey: createIdemKey,
        correlationId,
        rawText
      });

      this.uiState.draftId = createRes.draftId;

      const analyzeIdemKey = this._generateKey('idem_analyze');
      const analyzeRes = this.gateway.analyzeAllocation(
        createRes.draftId,
        analyzeIdemKey,
        null,
        this.gatewayParams.providerMode
      );

      this.uiState.updateFromAnalysis(analyzeRes);
      return {
        success: true,
        draftId: createRes.draftId,
        analyzeRes
      };
    } catch (err) {
      const msg = err.message || 'Unknown Gateway Error';
      this.uiState.lastError = msg;
      return {
        success: false,
        error: msg
      };
    }
  }

  toggleMixedBatch(approved) {
    try {
      this.uiState.lastError = null;
      this.uiState.setCustomerApprovedMixedBatch(approved);

      if (!this.uiState.draftId) {
        return { success: true };
      }

      const analyzeIdemKey = this._generateKey('idem_reanalyze');
      const analyzeRes = this.gateway.analyzeAllocation(
        this.uiState.draftId,
        analyzeIdemKey,
        null,
        this.gatewayParams.providerMode,
        { customerApprovedMixedBatch: Boolean(approved) }
      );

      this.uiState.updateFromAnalysis(analyzeRes);
      return { success: true, analyzeRes };
    } catch (err) {
      const msg = err.message || 'Unknown Error';
      this.uiState.lastError = msg;
      return { success: false, error: msg };
    }
  }

  confirmCurrentAllocation() {
    try {
      this.uiState.lastError = null;
      if (!this.uiState.draftId) {
        throw new Error('NO_ACTIVE_DRAFT: Cannot confirm without active draftId');
      }

      const confirmIdemKey = this._generateKey('idem_confirm');
      const confRes = this.gateway.confirmAllocation(
        this.uiState.draftId,
        this.uiState.suggestions,
        confirmIdemKey,
        this.gatewayParams.providerMode
      );

      this.uiState.confirm();
      return {
        success: true,
        confRes
      };
    } catch (err) {
      const msg = err.message || 'Unknown Confirmation Error';
      this.uiState.lastError = msg;
      return {
        success: false,
        error: msg
      };
    }
  }

  cancelCurrentDraft() {
    try {
      this.uiState.lastError = null;
      if (this.uiState.draftId) {
        this.gateway.cancelAllocation(this.uiState.draftId, this.gatewayParams.providerMode);
      }
      this.uiState.cancel();
      return { success: true };
    } catch (err) {
      const msg = err.message || 'Unknown Cancel Error';
      this.uiState.lastError = msg;
      return { success: false, error: msg };
    }
  }
}

module.exports = {
  AllocationGatewayClient
};
