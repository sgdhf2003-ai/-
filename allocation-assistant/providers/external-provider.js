/**
 * ExternalProvider Stub (Fail-Closed)
 */

const { AllocationProvider } = require('./allocation-provider');

class ExternalProvider extends AllocationProvider {
  createDraft() {
    throw new Error('EXTERNAL_PROVIDER_DISABLED: External ERP provider is disabled in current environment.');
  }

  analyzeAllocation() {
    throw new Error('EXTERNAL_PROVIDER_DISABLED: External ERP provider is disabled in current environment.');
  }

  confirmAllocation() {
    throw new Error('EXTERNAL_PROVIDER_DISABLED: External ERP provider is disabled in current environment.');
  }

  cancelAllocation() {
    throw new Error('EXTERNAL_PROVIDER_DISABLED: External ERP provider is disabled in current environment.');
  }

  getAllocationStatus() {
    throw new Error('EXTERNAL_PROVIDER_DISABLED: External ERP provider is disabled in current environment.');
  }
}

module.exports = {
  ExternalProvider
};
