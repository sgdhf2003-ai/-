/**
 * JYAI Allocation Assistant Package Entry Point (Phase 4B)
 */

const { validateTenantContext } = require('./contracts/tenant-context');
const {
  DRAFT_STATUSES,
  validateAllocationDraftItem,
  validateAllocationDraft
} = require('./contracts/draft-contract');
const {
  validateInventoryLot,
  validateInventorySnapshot
} = require('./contracts/inventory-contract');
const {
  SEVERITIES,
  validateAllocationWarning,
  validateAllocationSuggestionItem,
  validateAllocationSuggestion
} = require('./contracts/suggestion-contract');
const {
  validateAuditEvent
} = require('./contracts/audit-contract');
const {
  validateSyncRequest,
  validateSyncResult
} = require('./contracts/sync-contract');

const { AllocationProvider } = require('./providers/allocation-provider');
const { SimulationProvider } = require('./providers/simulation-provider');
const { ExternalProvider } = require('./providers/external-provider');
const { AllocationGateway } = require('./gateway/allocation-gateway');

const {
  OCR_CONFIDENCE_THRESHOLD,
  evaluateAllocationRules
} = require('./rules/allocation-rules');

const { AuditLogger } = require('./audit/audit-logger');

const { ReadOnlyInventoryAdapter } = require('./adapters/readonly-inventory-adapter');
const { mapSheetRowsToInventorySnapshot } = require('./adapters/inventory-sheet-mapper');
const { MockSheetInventoryAdapter } = require('./adapters/mock-sheet-inventory-adapter');

const { FormalReservationAdapter } = require('./adapters/formal-reservation-adapter');
const { MockFormalReservationAdapter } = require('./adapters/mock-formal-reservation-adapter');

const { AllocationSyncEngine } = require('./sync/allocation-sync-engine');

const { AllocationUIState } = require('./ui/allocation-ui-state');
const { AllocationGatewayClient } = require('./ui/allocation-gateway-client');
const { AllocationViewRenderer } = require('./ui/allocation-view-renderer');

module.exports = {
  // Constants
  DRAFT_STATUSES,
  SEVERITIES,
  OCR_CONFIDENCE_THRESHOLD,

  // Validators
  validateTenantContext,
  validateAllocationDraftItem,
  validateAllocationDraft,
  validateInventoryLot,
  validateInventorySnapshot,
  validateAllocationWarning,
  validateAllocationSuggestionItem,
  validateAllocationSuggestion,
  validateAuditEvent,
  validateSyncRequest,
  validateSyncResult,

  // Providers & Gateway
  AllocationProvider,
  SimulationProvider,
  ExternalProvider,
  AllocationGateway,

  // Rules Evaluator
  evaluateAllocationRules,

  // Audit Logger
  AuditLogger,

  // Adapters & Mappers
  ReadOnlyInventoryAdapter,
  mapSheetRowsToInventorySnapshot,
  MockSheetInventoryAdapter,
  FormalReservationAdapter,
  MockFormalReservationAdapter,

  // Sync Engine
  AllocationSyncEngine,

  // UI State Manager, Client Hook & Renderer
  AllocationUIState,
  AllocationGatewayClient,
  AllocationViewRenderer
};
