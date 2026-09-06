"use strict";

/**
 * TDD Simulation Suite: Projection Worker Isolation & Idempotency Contract (Stage 42-E Phase 1)
 *
 * Verifies local contract boundaries for Projection Worker isolation, idempotency, and DLQ handling:
 * 1. Only authorized worker identity (valid worker auth token) can process Projection Events; invalid token returns UNAUTHORIZED_WORKER (0 Sheet writes).
 * 2. Projection Key format strictly enforced: PROJECTION_${operationId}.
 * 3. Duplicate operationId retry: returns duplicated: true, does not write duplicate records, maintains single projection state.
 * 4. Projection State schema validation: records projectionKey, operationId, reservationNumber, projectedAt, and status ('PROJECTED').
 * 5. Projection write failure handling: Firestore COMMITTED result is never rolled back; returns SHEET_PROJECTION_ERROR and enqueues in-memory DLQ record.
 * 6. DLQ retry success: updates existing Projection State status to 'PROJECTED', maintains single state record without duplicate writes.
 * 7. Direct client / API guard: Non-worker callers (e.g. client_pwa, public_api) fail closed with UNAUTHORIZED_WORKER.
 */

const assert = require("assert");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS projection-worker-contract: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`FAIL projection-worker-contract: ${description}`);
    console.error(`  Error: ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

// Local In-Memory Projection Worker Harness
class LocalProjectionWorkerHarness {
  constructor(options = {}) {
    this.validWorkerToken = options.validWorkerToken || "TRUSTED_WORKER_SECRET_TOKEN_2026";
    this.projectionStates = new Map(); // projectionKey -> ProjectionState
    this.dlqQueue = [];
    this.sheetWriteCount = 0;
    this.simulatedSheetFailure = false;
  }

  setSimulatedSheetFailure(fail) {
    this.simulatedSheetFailure = fail;
  }

  processProjectionEvent(event, callerAuthToken, callerType = "worker") {
    // Contract 1 & 7: Check caller type and worker token
    if (callerType !== "worker" || !callerAuthToken || callerAuthToken !== this.validWorkerToken) {
      return {
        ok: false,
        errorCode: "UNAUTHORIZED_WORKER",
        message: "Projection Worker execution denied: caller is not an authorized worker",
        sheetWriteCount: this.sheetWriteCount
      };
    }

    const { operationId, reservationNumber } = event;
    if (!operationId || !reservationNumber) {
      return {
        ok: false,
        errorCode: "INVALID_PROJECTION_EVENT",
        message: "Missing operationId or reservationNumber",
        sheetWriteCount: this.sheetWriteCount
      };
    }

    // Contract 2: Enforce Projection Key format
    const projectionKey = `PROJECTION_${operationId}`;

    // Contract 3: Idempotency check for duplicate operationId
    const existing = this.projectionStates.get(projectionKey);
    if (existing && existing.status === "PROJECTED") {
      return {
        ok: true,
        duplicated: true,
        projectionKey,
        status: existing.status,
        projectionState: existing,
        sheetWriteCount: this.sheetWriteCount
      };
    }

    // Contract 5: Handle projection write failure
    if (this.simulatedSheetFailure) {
      const dlqRecord = {
        dlqId: `DLQ_${operationId}_${Date.now()}`,
        projectionKey,
        operationId,
        reservationNumber,
        event,
        failedAt: new Date().toISOString(),
        retryCount: 0,
        error: "SHEET_PROJECTION_ERROR"
      };
      this.dlqQueue.push(dlqRecord);

      return {
        ok: false,
        errorCode: "SHEET_PROJECTION_ERROR",
        message: "Google Sheet write failed; event pushed to in-memory DLQ for retry",
        dlqRecord,
        firestoreRollbackTriggered: false, // Contract 5: Firestore COMMITTED result is NEVER rolled back
        sheetWriteCount: this.sheetWriteCount
      };
    }

    // Perform successful projection write
    this.sheetWriteCount++;
    const projectionState = {
      projectionKey,
      operationId,
      reservationNumber,
      projectedAt: new Date().toISOString(),
      status: "PROJECTED"
    };

    this.projectionStates.set(projectionKey, projectionState);

    return {
      ok: true,
      duplicated: false,
      projectionKey,
      status: "PROJECTED",
      projectionState,
      sheetWriteCount: this.sheetWriteCount
    };
  }

  retryDlqRecord(dlqId, callerAuthToken, callerType = "worker") {
    if (callerType !== "worker" || !callerAuthToken || callerAuthToken !== this.validWorkerToken) {
      return {
        ok: false,
        errorCode: "UNAUTHORIZED_WORKER",
        message: "DLQ retry denied: caller is not an authorized worker"
      };
    }

    const dlqIndex = this.dlqQueue.findIndex(r => r.dlqId === dlqId);
    if (dlqIndex === -1) {
      return {
        ok: false,
        errorCode: "DLQ_RECORD_NOT_FOUND"
      };
    }

    const dlqRecord = this.dlqQueue[dlqIndex];
    this.simulatedSheetFailure = false; // Clear failure flag for retry

    const result = this.processProjectionEvent(dlqRecord.event, callerAuthToken, callerType);

    if (result.ok) {
      this.dlqQueue.splice(dlqIndex, 1);
    }

    return {
      ...result,
      dlqRetried: true,
      dlqRemainingCount: this.dlqQueue.length
    };
  }
}

function main() {
  const WORKER_TOKEN = "TRUSTED_WORKER_SECRET_TOKEN_2026";
  const harness = new LocalProjectionWorkerHarness({ validWorkerToken: WORKER_TOKEN });

  // -----------------------------------------------------------------------------
  // Test 1: Only authorized worker identity can process Projection Event
  // -----------------------------------------------------------------------------
  runTest("1. Only authorized worker identity can process Projection Event (invalid token returns UNAUTHORIZED_WORKER, 0 Sheet writes)", () => {
    const event = { operationId: "OP-42E-001", reservationNumber: "RES-42E-001" };

    // Invalid token call
    const resInvalid = harness.processProjectionEvent(event, "INVALID_TOKEN", "worker");
    assert.strictEqual(resInvalid.ok, false);
    assert.strictEqual(resInvalid.errorCode, "UNAUTHORIZED_WORKER");
    assert.strictEqual(resInvalid.sheetWriteCount, 0);

    // Missing token call
    const resMissing = harness.processProjectionEvent(event, null, "worker");
    assert.strictEqual(resMissing.ok, false);
    assert.strictEqual(resMissing.errorCode, "UNAUTHORIZED_WORKER");
    assert.strictEqual(resMissing.sheetWriteCount, 0);
  });

  // -----------------------------------------------------------------------------
  // Test 2: Projection Key must be PROJECTION_${operationId}
  // -----------------------------------------------------------------------------
  runTest("2. Projection Key format strictly equals PROJECTION_${operationId}", () => {
    const operationId = "OP-42E-002";
    const event = { operationId, reservationNumber: "RES-42E-002" };

    const res = harness.processProjectionEvent(event, WORKER_TOKEN, "worker");
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.projectionKey, `PROJECTION_${operationId}`);
  });

  // -----------------------------------------------------------------------------
  // Test 3: Duplicate operationId retry returns duplicated: true with 0 secondary writes
  // -----------------------------------------------------------------------------
  runTest("3. Duplicate operationId retry returns duplicated: true and does not generate a second projection state", () => {
    const operationId = "OP-42E-002"; // Same operationId from Test 2
    const event = { operationId, reservationNumber: "RES-42E-002" };

    const initialWriteCount = harness.sheetWriteCount;
    const initialStatesCount = harness.projectionStates.size;

    const resRetry = harness.processProjectionEvent(event, WORKER_TOKEN, "worker");

    assert.strictEqual(resRetry.ok, true);
    assert.strictEqual(resRetry.duplicated, true);
    assert.strictEqual(harness.sheetWriteCount, initialWriteCount, "Sheet write count must not increment on duplicate operationId");
    assert.strictEqual(harness.projectionStates.size, initialStatesCount, "Total projection state count must remain unchanged");
  });

  // -----------------------------------------------------------------------------
  // Test 4: Projection State schema verification
  // -----------------------------------------------------------------------------
  runTest("4. Projection State contains required fields: projectionKey, operationId, reservationNumber, projectedAt, status", () => {
    const operationId = "OP-42E-004";
    const reservationNumber = "RES-42E-004";
    const event = { operationId, reservationNumber };

    const res = harness.processProjectionEvent(event, WORKER_TOKEN, "worker");
    assert.strictEqual(res.ok, true);

    const state = res.projectionState;
    assert.ok(state);
    assert.strictEqual(state.projectionKey, `PROJECTION_${operationId}`);
    assert.strictEqual(state.operationId, operationId);
    assert.strictEqual(state.reservationNumber, reservationNumber);
    assert.strictEqual(typeof state.projectedAt, "string");
    assert.strictEqual(state.status, "PROJECTED");
  });

  // -----------------------------------------------------------------------------
  // Test 5: Projection failure pushes to DLQ without Firestore rollback
  // -----------------------------------------------------------------------------
  runTest("5. Projection failure returns SHEET_PROJECTION_ERROR, enqueues in-memory DLQ record, and leaves Firestore COMMITTED state intact", () => {
    harness.setSimulatedSheetFailure(true);

    const operationId = "OP-42E-005";
    const reservationNumber = "RES-42E-005";
    const event = { operationId, reservationNumber };

    const res = harness.processProjectionEvent(event, WORKER_TOKEN, "worker");

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "SHEET_PROJECTION_ERROR");
    assert.strictEqual(res.firestoreRollbackTriggered, false, "Firestore COMMITTED transaction must NOT be rolled back");
    assert.ok(res.dlqRecord);
    assert.strictEqual(res.dlqRecord.operationId, operationId);
    assert.strictEqual(harness.dlqQueue.length, 1);

    harness.setSimulatedSheetFailure(false);
  });

  // -----------------------------------------------------------------------------
  // Test 6: DLQ retry success transitions state to PROJECTED without duplicate records
  // -----------------------------------------------------------------------------
  runTest("6. DLQ retry success transitions Projection State status to PROJECTED and preserves single state record", () => {
    assert.strictEqual(harness.dlqQueue.length, 1);
    const dlqRecord = harness.dlqQueue[0];

    const resRetry = harness.retryDlqRecord(dlqRecord.dlqId, WORKER_TOKEN, "worker");

    assert.strictEqual(resRetry.ok, true);
    assert.strictEqual(resRetry.dlqRetried, true);
    assert.strictEqual(resRetry.dlqRemainingCount, 0);
    assert.strictEqual(resRetry.status, "PROJECTED");

    const state = harness.projectionStates.get(`PROJECTION_${dlqRecord.operationId}`);
    assert.ok(state);
    assert.strictEqual(state.status, "PROJECTED");
  });

  // -----------------------------------------------------------------------------
  // Test 7: Direct PWA / General API Access Rejection
  // -----------------------------------------------------------------------------
  runTest("7. Direct client/PWA or general API calls to Projection Worker are rejected with UNAUTHORIZED_WORKER", () => {
    const event = { operationId: "OP-42E-007", reservationNumber: "RES-42E-007" };

    const resPwa = harness.processProjectionEvent(event, WORKER_TOKEN, "client_pwa");
    assert.strictEqual(resPwa.ok, false);
    assert.strictEqual(resPwa.errorCode, "UNAUTHORIZED_WORKER");

    const resApi = harness.processProjectionEvent(event, WORKER_TOKEN, "public_api");
    assert.strictEqual(resApi.ok, false);
    assert.strictEqual(resApi.errorCode, "UNAUTHORIZED_WORKER");
  });

  // -----------------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------------
  console.log(`\n==================================================`);
  console.log(`Projection Worker Contract Simulation Summary:`);
  console.log(`Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log(`==================================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

main();
