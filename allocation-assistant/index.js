/**
 * JYAI Allocation Assistant Package Entry Point (Phase 5C)
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

const { SyncIdempotencyGuard } = require('./sync/sync-idempotency-guard');
const { AllocationSyncEngine } = require('./sync/allocation-sync-engine');

const { AllocationUIState } = require('./ui/allocation-ui-state');
const { AllocationGatewayClient } = require('./ui/allocation-gateway-client');
const { AllocationViewRenderer } = require('./ui/allocation-view-renderer');
const { AllocationSandboxView } = require('./ui/allocation-sandbox-view');
const { SandboxInventoryProvider } = require('./ui/sandbox-inventory-provider');
const { DEMO_PRESETS, SandboxDemoCards } = require('./ui/sandbox-demo-cards');

const { OcrCandidateMatcher } = require('./ocr/ocr-candidate-matcher');
const { ImageOcrAdapter } = require('./ocr/image-ocr-adapter');
const { LiffMicroEditPopup } = require('./ui/liff-micro-edit-popup');

module.exports = {
  // Constants
  DRAFT_STATUSES,
  SEVERITIES,
  OCR_CONFIDENCE_THRESHOLD,
  DEMO_PRESETS,

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

  // Sync Engine & Guard
  SyncIdempotencyGuard,
  AllocationSyncEngine,

  // UI State Manager, Client Hook, Renderer, Sandbox View, Provider & Demo Cards
  AllocationUIState,
  AllocationGatewayClient,
  AllocationViewRenderer,
  AllocationSandboxView,
  SandboxInventoryProvider,
  SandboxDemoCards,

  // OCR & LIFF Components
  OcrCandidateMatcher,
  ImageOcrAdapter,
  LiffMicroEditPopup
};
