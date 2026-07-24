/**
 * JYAI Allocation Assistant Package Entry Point (Phase 2B)
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
  validateAuditEvent,
  validateSyncRequest,
  validateSyncResult
} = require('./contracts/audit-contract');

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
  MockSheetInventoryAdapter
};
