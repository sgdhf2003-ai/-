/**
 * Simulation Test: AllocationGatewayClient (Pack 3B)
 */

const assert = require('assert');
const {
  AllocationGatewayClient,
  AllocationGateway,
  AllocationUIState,
  MockSheetInventoryAdapter,
  SimulationProvider
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-gateway-client: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-gateway-client: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

function createSetup() {
  const adapter = new MockSheetInventoryAdapter();
  adapter.setRawSheetData('EQA-6522', [
    { productCode: 'EQA-6522', warehouseName: '林口倉', batchNumber: '7J25', availableQuantity: 20 }
  ]);
  adapter.setRawSheetData('EQA-MIX', [
    { productCode: 'EQA-MIX', warehouseName: '林口倉', batchNumber: 'B1', availableQuantity: 10 },
    { productCode: 'EQA-MIX', warehouseName: '林口倉', batchNumber: 'B2', availableQuantity: 10 }
  ]);

  const provider = new SimulationProvider({ inventoryAdapter: adapter });
  const gateway = new AllocationGateway({ SIMULATION: provider });
  const uiState = new AllocationUIState();
  const client = new AllocationGatewayClient({ gateway, uiState });

  return { adapter, provider, gateway, uiState, client };
}

// 1. submitRawText Drive UI State
runTest('submitRawText creates draft and drives UIState to ALLOCATION_REVIEW', () => {
  const { uiState, client } = createSetup();
  const res = client.submitRawText('EQA-6522 * 10');

  assert.strictEqual(res.success, true);
  assert.strictEqual(uiState.status, 'ALLOCATION_REVIEW');
  assert.strictEqual(uiState.suggestions.length, 1);
  assert.strictEqual(uiState.suggestions[0].batchNumber, '7J25');
});

// 2. toggleMixedBatch Triggers Re-analysis
runTest('toggleMixedBatch updates consent and triggers re-analysis', () => {
  const { uiState, client } = createSetup();
  client.submitRawText('EQA-MIX * 15');

  assert.strictEqual(uiState.warnings.some(w => w.warningCode === 'BATCH_MIXING_REQUIRED'), true);
  assert.strictEqual(uiState.suggestions.length, 0);

  client.toggleMixedBatch(true);
  assert.strictEqual(uiState.customerApprovedMixedBatch, true);
  assert.strictEqual(uiState.suggestions.length, 2);
});

// 3. confirmCurrentAllocation Lock Mechanics
runTest('confirmCurrentAllocation calls confirmAllocation and locks UIState', () => {
  const { uiState, client } = createSetup();
  client.submitRawText('EQA-6522 * 10');

  const confRes = client.confirmCurrentAllocation();
  assert.strictEqual(confRes.success, true);
  assert.strictEqual(uiState.status, 'ALLOCATION_CONFIRMED');
  assert.strictEqual(uiState.isLocked, true);
});

// 4. Error Normalization
runTest('catches Gateway errors and sets error details on UIState', () => {
  const { uiState, client } = createSetup();

  // Trigger error with invalid contract version via direct injection
  client.gatewayParams.contractVersion = 'v9.9.9';
  const res = client.submitRawText('EQA-6522 * 10');

  assert.strictEqual(res.success, false);
  assert.ok(uiState.lastError);
  assert.ok(uiState.lastError.includes('contractVersion'));
});

// 5. Operation Handler: createFormalHold Role Authorization
runTest('createFormalHold permits admin/assistant and blocks sales/unauthenticated', () => {
  const { client } = createSetup();
  const holdPayload = { item: 'EQA-6522', quantity: 10, storeName: '台北門市' };

  // Authorized assistant role
  const resAssistant = client.createFormalHold(holdPayload, { role: 'assistant' });
  assert.strictEqual(resAssistant.ok, true);
  assert.strictEqual(resAssistant.notificationBypassed, true);
  assert.ok(resAssistant.reservationNumber.startsWith('RES-'));

  // Unauthorized sales role
  const resSales = client.createFormalHold(holdPayload, { role: 'sales' });
  assert.strictEqual(resSales.ok, false);
  assert.strictEqual(resSales.errorCode, 'UNAUTHORIZED_ROLE');

  // Unauthenticated user
  const resNull = client.createFormalHold(holdPayload, null);
  assert.strictEqual(resNull.ok, false);
  assert.strictEqual(resNull.errorCode, 'INVALID_SESSION_USER');
});

// 6. Operation Handler: fulfillHold Partial Fulfillment
runTest('fulfillHold calculates remaining quantity and generates ledger row for authorized roles', () => {
  const { client } = createSetup();
  const fulfillPayload = { reservationNumber: 'RES-20260801-001', totalQuantity: 10, quantity: 4, item: 'EQA-6522' };

  const res = client.fulfillHold(fulfillPayload, { role: 'assistant' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.remainingQuantity, 6);
  assert.strictEqual(res.ledgerRow[1], 'FULFILL_PARTIAL');
  assert.strictEqual(res.ledgerRow[4], 6);
  assert.strictEqual(res.notificationBypassed, true);
});

// 7. Operation Handler: cancelReleaseHold Cancel Release
runTest('cancelReleaseHold generates CANCEL_RELEASE ledger row with zero remaining quantity', () => {
  const { client } = createSetup();
  const cancelPayload = { reservationNumber: 'RES-20260801-001', quantity: 6, item: 'EQA-6522' };

  const res = client.cancelReleaseHold(cancelPayload, { role: 'boss' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.remainingQuantity, 0);
  assert.strictEqual(res.ledgerRow[1], 'CANCEL_RELEASE');
  assert.strictEqual(res.ledgerRow[5], 'CANCELLED');
});

// 8. Operation Handler: queryReadbackAudit Redaction Enforcer
runTest('queryReadbackAudit applies sanitizeReadbackAuditRecord for role-based redaction', () => {
  const { client } = createSetup();
  const rawAuditRecord = {
    reservationNumber: 'RES-20260801-001',
    status: 'ACTIVE',
    internalLogs: 'RAW_DB_STACK_TRACE',
    systemProperties: { scriptId: '1vRepq' }
  };

  // Assistant receives redacted payload
  const resAssistant = client.queryReadbackAudit(rawAuditRecord, { role: 'assistant' });
  assert.strictEqual(resAssistant.ok, true);
  assert.strictEqual(resAssistant.record.readbackRedacted, true);
  assert.strictEqual(resAssistant.record.internalLogs, undefined);

  // Admin receives unredacted payload
  const resAdmin = client.queryReadbackAudit(rawAuditRecord, { role: 'admin' });
  assert.strictEqual(resAdmin.ok, true);
  assert.strictEqual(resAdmin.record.internalLogs, 'RAW_DB_STACK_TRACE');

  // Sales receives query denied
  const resSales = client.queryReadbackAudit(rawAuditRecord, { role: 'sales' });
  assert.strictEqual(resSales.ok, false);
  assert.strictEqual(resSales.errorCode, 'READBACK_QUERY_DENIED');
});

console.log(`\nAllocation Gateway Client Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
