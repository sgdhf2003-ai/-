/**
 * SandboxInventoryProvider (Pack 5B)
 */

const { SimulationProvider } = require('../providers/simulation-provider');
const { MockSheetInventoryAdapter } = require('../adapters/mock-sheet-inventory-adapter');
const { AllocationGateway } = require('../gateway/allocation-gateway');
const { AllocationGatewayClient } = require('./allocation-gateway-client');

class SandboxInventoryProvider {
  constructor(options = {}) {
    this.mode = 'READONLY_SANDBOX';
    this.inventoryAdapter = options.inventoryAdapter || new MockSheetInventoryAdapter();
    this.provider = options.provider || new SimulationProvider({ inventoryAdapter: this.inventoryAdapter });
    this.gateway = options.gateway || new AllocationGateway({ provider: this.provider });
  }

  createGatewayClient(options = {}) {
    return new AllocationGatewayClient({
      gateway: this.gateway,
      uiState: options.uiState
    });
  }

  executeFormalWrite(params) {
    throw new Error('SANDBOX_WRITE_FORBIDDEN: Formal spreadsheet writes are strictly prohibited in sandbox mode');
  }
}

module.exports = {
  SandboxInventoryProvider
};
