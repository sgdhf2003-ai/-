/**
 * AllocationGateway Orchestrator & Router (Updated Pack 2C)
 */

const { SimulationProvider } = require('../providers/simulation-provider');
const { ExternalProvider } = require('../providers/external-provider');

class AllocationGateway {
  constructor(providers = {}) {
    const simProv = providers.SIMULATION || providers.simulationProvider || (providers.providerMap && providers.providerMap.SIMULATION) || new SimulationProvider();
    const extProv = providers.EXTERNAL || providers.externalProvider || (providers.providerMap && providers.providerMap.EXTERNAL) || new ExternalProvider();

    this.providers = {
      SIMULATION: simProv,
      EXTERNAL: extProv
    };
  }

  _validateContractVersion(contractVersion) {
    if (contractVersion !== 'v1.0.0') {
      throw new Error(`Invalid or unsupported contractVersion: ${contractVersion}. Expected v1.0.0`);
    }
  }

  getProvider(mode = 'SIMULATION') {
    const provider = this.providers[mode];
    if (!provider) {
      throw new Error(`Unknown provider mode: ${mode}`);
    }
    return provider;
  }

  dispatch(providerMode, action, payload) {
    const provider = this.getProvider(providerMode);
    if (typeof provider[action] !== 'function') {
      throw new Error(`Action ${action} is not supported on provider ${providerMode}`);
    }
    return provider[action](payload);
  }

  createDraft(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Payload must be a non-null object');
    }
    this._validateContractVersion(payload.contractVersion);

    const providerMode = payload.providerMode || 'SIMULATION';
    const provider = this.getProvider(providerMode);

    const response = provider.createDraft(payload);
    return {
      ...response,
      correlationId: payload.correlationId || ''
    };
  }

  analyzeAllocation(draftId, idempotencyKey, inventorySnapshot, providerMode = 'SIMULATION') {
    const provider = this.getProvider(providerMode);
    return provider.analyzeAllocation(draftId, idempotencyKey, inventorySnapshot);
  }

  confirmAllocation(draftId, confirmedItems, idempotencyKey, providerMode = 'SIMULATION') {
    const provider = this.getProvider(providerMode);
    return provider.confirmAllocation(draftId, confirmedItems, idempotencyKey);
  }

  cancelAllocation(draftId, providerMode = 'SIMULATION') {
    const provider = this.getProvider(providerMode);
    return provider.cancelAllocation(draftId);
  }

  getAllocationStatus(draftId, providerMode = 'SIMULATION') {
    const provider = this.getProvider(providerMode);
    return provider.getAllocationStatus(draftId);
  }
}

module.exports = {
  AllocationGateway
};
