/**
 * AllocationGatewayClient Hook & Controller (Pack 3B)
 */

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
