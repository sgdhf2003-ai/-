/**
 * Simulation Test: Audit Trail & AuditLogger (Pack 1D)
 */

const assert = require('assert');
const { AuditLogger, validateAuditEvent } = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-audit: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-audit: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. AuditLogger Event Creation & Validation
runTest('AuditLogger records valid AuditEvent with correlationId and tenant metadata', () => {
  const logger = new AuditLogger();
  const evt = logger.logEvent({
    operator: 'clerk01',
    action: 'CREATE_DRAFT',
    draftId: 'draft_test_100',
    correlationId: 'corr_aud_001',
    tenantId: 'tenant-jy-001',
    companyId: 'comp-jy',
    details: 'Created draft for test'
  });

  assert.ok(evt.eventId);
  assert.strictEqual(evt.operator, 'clerk01');
  assert.strictEqual(evt.action, 'CREATE_DRAFT');
  assert.strictEqual(evt.correlationId, 'corr_aud_001');
  assert.strictEqual(evt.tenantId, 'tenant-jy-001');
  assert.strictEqual(evt.companyId, 'comp-jy');
  assert.ok(evt.occurredAt);
  assert.ok(evt.payloadDigest);
});

// 2. Querying Audit Logs
runTest('AuditLogger queries events by draftId and correlationId', () => {
  const logger = new AuditLogger();
  logger.logEvent({ action: 'CREATE_DRAFT', draftId: 'draft_A', correlationId: 'corr_X' });
  logger.logEvent({ action: 'ANALYZE_ALLOCATION', draftId: 'draft_A', correlationId: 'corr_X' });
  logger.logEvent({ action: 'CREATE_DRAFT', draftId: 'draft_B', correlationId: 'corr_Y' });

  const draftAEvents = logger.getEventsByDraftId('draft_A');
  assert.strictEqual(draftAEvents.length, 2);

  const corrXEvents = logger.getEventsByCorrelationId('corr_X');
  assert.strictEqual(corrXEvents.length, 2);
});

console.log(`\nAllocation Audit Trail Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
