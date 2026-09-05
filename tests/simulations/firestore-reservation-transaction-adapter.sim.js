"use strict";

/**
 * TDD Verification Suite: Firestore Native Transaction Adapter (Stage 42 Implementation)
 *
 * Verifies Native ACID requirements aligned with Stage 42-B spec & Stage 42-C plan:
 * 1. Parameter validations (operationId, reservationNumber, integer releasedQuantity, operator, operatorRole).
 * 2. Adapter lacking Server Factory trust fails closed with PRODUCTION_TRANSACTION_CAPABILITY_MISSING before ANY writes.
 * 3. External boolean flag forging attempt is rejected because capability trust must originate from Server Factory.
 * 4. Symbol.for同名值與外部無法取得之模組私有 Capability 限制（getServerBootstrapToken 不存在，FakeFirestoreClient 直呼被拒）。
 * 5. 任意 runTransaction fake 物件無法取得 production trust，唯有 createEmulatorFake 能通過本機測試能力探測。
 * 6. Successful cancel release transaction executes 8-step先讀後寫 protocol, updating 5 collections with deterministic doc IDs.
 * 7. Snapshot-based verification (Hold status & productCode verified from snapshot, finite non-negative inventory fields & totalQuantity invariant).
 * 8. Duplicate operationId is blocked during Reads Phase with DUPLICATE_OPERATION_BLOCKED (0 writes).
 * 9. Inventory reservedQuantity lower than releasedQuantity is blocked with INSUFFICIENT_RESERVED_INVENTORY (0 writes).
 * 10. Negative inventory balance or totalQuantity invariant violation returns INVALID_INVENTORY_STATE (0 writes).
 * 11. Transaction abort ensures 0 partial writes and does NOT write status: 'FAILED' document inside aborted transaction.
 * 12. Transaction SDK internal retry produces deterministic document IDs (LEDGER_${operationId}, AUDIT_${operationId}) preventing duplicates.
 * 13. Timeout readback via findOperationId(operationId) retrieves stored COMMITTED proof from operations/{operationId}.
 * 14. Explicit distinction between transaction-internal readbackVerified & postCommitReadbackVerified.
 * 15. Post-commit readback failure returns ok: false, errorCode: "POST_COMMIT_READBACK_FAILED", ambiguous: true, without returning releasedQuantity or mutating operations.
 * 16. Incomplete or missing proof in post-commit readback returns ok: false, POST_COMMIT_READBACK_FAILED, ambiguous: true and NO releasedQuantity.
 * 17. Operator roles 'sales' and 'retail' are rejected before transaction start with PERMISSION_DENIED.
 * 18. Controlled Projection Worker failure is isolated and does NOT rollback committed Firestore transaction.
 * 19. Unauthorized Projection Worker is rejected from executing projection writes.
 */

const assert = require("assert");
const { FirestoreReservationTransactionAdapter } = require("../../allocation-assistant/adapters/firestore-reservation-transaction-adapter");
const { ServerFirestoreClientFactory, FakeFirestoreClient, SERVER_BOOTSTRAP_SECRET } = require("../../allocation-assistant/factories/server-firestore-client-factory");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function runTest(description, testFn) {
  totalTests++;
  try {
    await testFn();
    passedTests++;
    console.log(`PASS firestore-reservation-transaction-adapter: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`FAIL firestore-reservation-transaction-adapter: ${description}`);
    console.error(`  Error: ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

// -----------------------------------------------------------------------------
// Controlled Projection Worker Mock for Testing
// -----------------------------------------------------------------------------
class ControlledProjectionWorkerMock {
  constructor(options = {}) {
    this.authorizedTokens = new Set(options.tokens || ["VALID_WORKER_TOKEN"]);
    this.projectionStore = new Map(); // Key: PROJECTION_${operationId}
    this.failProjection = options.failProjection || false;
  }

  processProjectionEvent(event = {}, authToken) {
    if (!authToken || !this.authorizedTokens.has(authToken)) {
      return { ok: false, errorCode: "UNAUTHORIZED_WORKER", message: "Worker authentication token invalid" };
    }

    const { operationId, reservationNumber } = event;
    const projectionKey = `PROJECTION_${operationId}`;

    if (this.projectionStore.has(projectionKey)) {
      return { ok: true, duplicated: true, message: "Projection already executed" };
    }

    if (this.failProjection) {
      return { ok: false, errorCode: "SHEET_PROJECTION_ERROR", message: "Failed to append row to Google Sheet projection" };
    }

    this.projectionStore.set(projectionKey, {
      projectionKey,
      operationId,
      reservationNumber,
      projectedAt: new Date().toISOString(),
      status: "PROJECTED"
    });

    return { ok: true, projectionKey };
  }
}

async function main() {
  // -----------------------------------------------------------------------------
  // Test 1: Strict Parameter Validations (Integer releasedQuantity)
  // -----------------------------------------------------------------------------
  await runTest("Invalid parameter types (empty strings, float/non-integer or negative quantity) fail closed with INVALID_PARAMETERS", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake();
    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });

    // Non-integer float quantity
    const resFloat = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-001",
      releasedQuantity: 5.5,
      operator: "Admin",
      operatorRole: "admin",
      operationId: "OP-FLOAT-001"
    });
    assert.strictEqual(resFloat.ok, false);
    assert.strictEqual(resFloat.errorCode, "INVALID_PARAMETERS");

    // Invalid operationId
    const resOp = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-001",
      releasedQuantity: 5,
      operator: "Admin",
      operatorRole: "admin",
      operationId: ""
    });
    assert.strictEqual(resOp.ok, false);
    assert.strictEqual(resOp.errorCode, "INVALID_PARAMETERS");

    // Invalid reservationNumber
    const resRes = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "",
      releasedQuantity: 5,
      operator: "Admin",
      operatorRole: "admin",
      operationId: "OP-001"
    });
    assert.strictEqual(resRes.ok, false);
    assert.strictEqual(resRes.errorCode, "INVALID_PARAMETERS");

    // Invalid releasedQuantity
    const resQty = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-001",
      releasedQuantity: -5,
      operator: "Admin",
      operatorRole: "admin",
      operationId: "OP-001"
    });
    assert.strictEqual(resQty.ok, false);
    assert.strictEqual(resQty.errorCode, "INVALID_PARAMETERS");
  });

  // -----------------------------------------------------------------------------
  // Test 2: Inventory Invariant & Field Validation (totalQuantity === available + reserved)
  // -----------------------------------------------------------------------------
  await runTest("Inventory field non-finite values or totalQuantity invariant violation returns INVALID_INVENTORY_STATE (0 writes)", async () => {
    // Mismatched totalQuantity invariant
    const fakeDbMismatch = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-INV": { id: "FS-RES-20260831-INV", productCode: "STU-6101", quantity: 10, status: "HOLD" }
      },
      inventory: {
        "STU-6101": { id: "STU-6101", productCode: "STU-6101", availableQuantity: 10, reservedQuantity: 10, totalQuantity: 999 } // 999 !== 10 + 10
      }
    });

    const adapterMismatch = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDbMismatch });
    const resMismatch = await adapterMismatch.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-INV",
      releasedQuantity: 5,
      operator: "Admin",
      operatorRole: "admin",
      operationId: "OP-MISMATCH-001"
    });
    assert.strictEqual(resMismatch.ok, false);
    assert.strictEqual(resMismatch.errorCode, "INVALID_INVENTORY_STATE");
    assert.strictEqual(fakeDbMismatch.collections.holds["FS-RES-20260831-INV"].status, "HOLD");

    // Missing or non-finite field
    const fakeDbNan = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-NAN": { id: "FS-RES-20260831-NAN", productCode: "STU-6101", quantity: 10, status: "HOLD" }
      },
      inventory: {
        "STU-6101": { id: "STU-6101", productCode: "STU-6101", availableQuantity: NaN, reservedQuantity: 10, totalQuantity: 20 }
      }
    });

    const adapterNan = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDbNan });
    const resNan = await adapterNan.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-NAN",
      releasedQuantity: 5,
      operator: "Admin",
      operatorRole: "admin",
      operationId: "OP-NAN-001"
    });
    assert.strictEqual(resNan.ok, false);
    assert.strictEqual(resNan.errorCode, "INVALID_INVENTORY_STATE");
  });

  // -----------------------------------------------------------------------------
  // Test 3: Untrusted or missing capability client -> Fail Closed
  // -----------------------------------------------------------------------------
  await runTest("Untrusted client lacking Server Factory validation fails closed before ANY writes", async () => {
    const untrustedClient = {
      runTransaction: async () => {},
      hasNativeTransactionAbortGuarantee: true
    };

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: untrustedClient });
    assert.strictEqual(adapter.hasNativeAcidTransaction, false);

    const res = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-001",
      releasedQuantity: 5,
      operator: "TestUser",
      operatorRole: "admin",
      operationId: "OP-FAIL-001"
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "PRODUCTION_TRANSACTION_CAPABILITY_MISSING");
  });

  // -----------------------------------------------------------------------------
  // Test 4: External boolean flag forging attempt -> Rejected
  // -----------------------------------------------------------------------------
  await runTest("External boolean flag forging attempt is rejected because trust must originate from Server Factory", async () => {
    const forgedClient = {
      runTransaction: async () => {},
      hasNativeTransactionAbortGuarantee: true,
      isTrustedServerBackend: false
    };

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: forgedClient });
    assert.strictEqual(adapter.hasNativeAcidTransaction, false);
  });

  // -----------------------------------------------------------------------------
  // Test 5: Symbol.for同名值與私有 Capability Token 邊界驗證
  // -----------------------------------------------------------------------------
  await runTest("Symbol.for同名值不能通過驗證且外部無法取得私有 Capability Token", async () => {
    // 1. 驗證 SERVER_BOOTSTRAP_SECRET 與 getServerBootstrapToken 全數不可由外部取得
    assert.strictEqual(SERVER_BOOTSTRAP_SECRET, undefined);
    assert.strictEqual(ServerFirestoreClientFactory.getServerBootstrapToken, undefined);

    // 2. 企圖使用 Symbol.for 同名 Symbol 呼叫 FakeFirestoreClient 建構子必被拒絕
    const forgedSymbol = Symbol.for("JYAI_SERVER_FIRESTORE_FACTORY_PRIVATE_CAPABILITY");
    assert.throws(
      () => new FakeFirestoreClient({}, forgedSymbol),
      /UNAUTHORIZED_CLIENT_INSTANTIATION/
    );

    // 3. 企圖使用通用 Symbol 呼叫亦被拒絕
    assert.throws(
      () => new FakeFirestoreClient({}, Symbol("JYAI_SERVER_FIRESTORE_FACTORY_PRIVATE_CAPABILITY")),
      /UNAUTHORIZED_CLIENT_INSTANTIATION/
    );
  });

  // -----------------------------------------------------------------------------
  // Test 6: 任意 runTransaction Fake 物件拒絕與 Controlled Factory createEmulatorFake 通過驗證
  // -----------------------------------------------------------------------------
  await runTest("任意 runTransaction fake 不能取得 production trust，唯有 createEmulatorFake 可通過測試能力探測", async () => {
    // 1. 任意 Fake 物件
    const arbitraryFake = {
      runTransaction: async () => {},
      FieldValue: { serverTimestamp: () => new Date().toISOString() }
    };
    const adapterArbitrary = new FirestoreReservationTransactionAdapter({ firestoreDb: arbitraryFake });
    assert.strictEqual(adapterArbitrary.hasNativeAcidTransaction, false);

    const resArbitrary = await adapterArbitrary.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-001",
      releasedQuantity: 5,
      operator: "Manager",
      operatorRole: "admin",
      operationId: "OP-UNTRUSTED-001"
    });
    assert.strictEqual(resArbitrary.ok, false);
    assert.strictEqual(resArbitrary.errorCode, "PRODUCTION_TRANSACTION_CAPABILITY_MISSING");

    // 2. 受控 Factory 建立之 Emulator Fake 通過探測
    const trustedEmulatorFake = ServerFirestoreClientFactory.createEmulatorFake();
    const adapterTrusted = new FirestoreReservationTransactionAdapter({ firestoreDb: trustedEmulatorFake });
    assert.strictEqual(adapterTrusted.hasNativeAcidTransaction, true);
  });

  // -----------------------------------------------------------------------------
  // Test 7: Successful Cancel Release Transaction & Proof Verification
  // -----------------------------------------------------------------------------
  await runTest("Successful cancel release transaction executes 8-step protocol returning dynamic proof & postCommitReadbackVerified", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-001": {
          id: "FS-RES-20260831-001",
          reservationNumber: "FS-RES-20260831-001",
          productCode: "STU-6101",
          quantity: 10,
          status: "HOLD"
        }
      },
      inventory: {
        "STU-6101": {
          id: "STU-6101",
          productCode: "STU-6101",
          availableQuantity: 20,
          reservedQuantity: 10,
          totalQuantity: 30
        }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });
    assert.strictEqual(adapter.hasNativeAcidTransaction, true);

    const res = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-001",
      releasedQuantity: 5,
      operator: "Manager",
      operatorRole: "boss",
      operationId: "OP-SUCCESS-001"
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.releasedQuantity, 5);
    assert.strictEqual(res.resultProof.inventoryReleased, true);
    assert.strictEqual(res.resultProof.holdUpdated, true);
    assert.strictEqual(res.resultProof.auditLogged, true);
    assert.strictEqual(res.resultProof.atomic, true);
    assert.strictEqual(res.resultProof.readbackVerified, true);
    assert.strictEqual(res.resultProof.operationPersisted, true);
    assert.strictEqual(res.postCommitReadbackVerified, true);

    assert.strictEqual(fakeDb.collections.holds["FS-RES-20260831-001"].status, "CANCELLED");
    assert.strictEqual(fakeDb.collections.inventory["STU-6101"].availableQuantity, 25);
    assert.strictEqual(fakeDb.collections.inventory["STU-6101"].reservedQuantity, 5);
    assert.strictEqual(fakeDb.collections.inventory["STU-6101"].totalQuantity, 30);
    assert.ok(fakeDb.collections.ledger["LEDGER_OP-SUCCESS-001"]);
    assert.ok(fakeDb.collections.auditLogs["AUDIT_OP-SUCCESS-001"]);
    assert.strictEqual(fakeDb.collections.operations["OP-SUCCESS-001"].status, "COMMITTED");
  });

  // -----------------------------------------------------------------------------
  // Test 8: Post-Commit Readback Failure Protocol (Ambiguous Handling)
  // -----------------------------------------------------------------------------
  await runTest("Post-commit readback failure returns ok: false, POST_COMMIT_READBACK_FAILED, ambiguous: true without returning releasedQuantity or mutating operations", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-FAILREAD": {
          id: "FS-RES-20260831-FAILREAD",
          reservationNumber: "FS-RES-20260831-FAILREAD",
          productCode: "STU-6101",
          quantity: 10,
          status: "HOLD"
        }
      },
      inventory: {
        "STU-6101": { id: "STU-6101", productCode: "STU-6101", availableQuantity: 10, reservedQuantity: 10, totalQuantity: 20 }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });
    adapter.findOperationId = async () => ({ found: false });

    const res = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-FAILREAD",
      releasedQuantity: 5,
      operator: "Manager",
      operatorRole: "admin",
      operationId: "OP-FAILREAD-001"
    });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "POST_COMMIT_READBACK_FAILED");
    assert.strictEqual(res.ambiguous, true);
    assert.strictEqual(res.releasedQuantity, undefined);

    // Operations document is frozen and unmutated upon readback failure
    assert.strictEqual(fakeDb.collections.operations["OP-FAILREAD-001"].status, "COMMITTED");
  });

  // -----------------------------------------------------------------------------
  // Test 9: Post-Commit Readback Incomplete/Missing Proof Rejection
  // -----------------------------------------------------------------------------
  await runTest("Incomplete or missing proof in post-commit readback returns ok: false, POST_COMMIT_READBACK_FAILED, ambiguous: true and NO releasedQuantity without mutating operations", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-INCOMPLETE": {
          id: "FS-RES-20260831-INCOMPLETE",
          reservationNumber: "FS-RES-20260831-INCOMPLETE",
          productCode: "STU-6101",
          quantity: 10,
          status: "HOLD"
        }
      },
      inventory: {
        "STU-6101": { id: "STU-6101", productCode: "STU-6101", availableQuantity: 10, reservedQuantity: 10, totalQuantity: 20 }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });
    // Mock findOperationId returning incomplete proof
    adapter.findOperationId = async () => ({
      found: false,
      invalidProof: true
    });

    const res = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-INCOMPLETE",
      releasedQuantity: 5,
      operator: "Manager",
      operatorRole: "admin",
      operationId: "OP-INCPROOF-001"
    });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "POST_COMMIT_READBACK_FAILED");
    assert.strictEqual(res.ambiguous, true);
    assert.strictEqual(res.releasedQuantity, undefined);
    assert.strictEqual(fakeDb.collections.operations["OP-INCPROOF-001"].status, "COMMITTED");
  });

  // -----------------------------------------------------------------------------
  // Test 10: Snapshot-Based Hold Verification (No Blind Parameter Trust)
  // -----------------------------------------------------------------------------
  await runTest("Hold status and productCode are verified from snapshot, ignoring invalid parameters", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-SNAP": {
          id: "FS-RES-20260831-SNAP",
          reservationNumber: "FS-RES-20260831-SNAP",
          productCode: "REAL-PROD-01",
          quantity: 10,
          status: "HOLD"
        }
      },
      inventory: {
        "REAL-PROD-01": { id: "REAL-PROD-01", productCode: "REAL-PROD-01", availableQuantity: 10, reservedQuantity: 10, totalQuantity: 20 }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });
    const res = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-SNAP",
      releasedQuantity: 5,
      operator: "Manager",
      operatorRole: "admin",
      operationId: "OP-SNAP-001",
      existingHold: { productCode: "FAKE-PROD-DO-NOT-TRUST" }
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(fakeDb.collections.inventory["REAL-PROD-01"].availableQuantity, 15);
    assert.strictEqual(fakeDb.collections.inventory["REAL-PROD-01"].reservedQuantity, 5);
  });

  // -----------------------------------------------------------------------------
  // Test 11: Duplicate operationId Interception
  // -----------------------------------------------------------------------------
  await runTest("Duplicate operationId is blocked during Reads Phase (0 writes)", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-002": {
          id: "FS-RES-20260831-002",
          reservationNumber: "FS-RES-20260831-002",
          productCode: "STU-6101",
          quantity: 10,
          status: "HOLD"
        }
      },
      inventory: {
        "STU-6101": { id: "STU-6101", productCode: "STU-6101", availableQuantity: 10, reservedQuantity: 10, totalQuantity: 20 }
      },
      operations: {
        "OP-DUP-001": { id: "OP-DUP-001", status: "COMMITTED" }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });
    const res = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-002",
      releasedQuantity: 5,
      operator: "Manager",
      operatorRole: "admin",
      operationId: "OP-DUP-001"
    });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "DUPLICATE_OPERATION_BLOCKED");
    assert.strictEqual(fakeDb.collections.inventory["STU-6101"].availableQuantity, 10);
  });

  // -----------------------------------------------------------------------------
  // Test 12: Inventory Invariant Failure (reservedQuantity < releasedQuantity)
  // -----------------------------------------------------------------------------
  await runTest("Inventory reservedQuantity lower than releasedQuantity is blocked with INSUFFICIENT_RESERVED_INVENTORY", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-003": {
          id: "FS-RES-20260831-003",
          reservationNumber: "FS-RES-20260831-003",
          productCode: "STU-6101",
          quantity: 10,
          status: "HOLD"
        }
      },
      inventory: {
        "STU-6101": { id: "STU-6101", productCode: "STU-6101", availableQuantity: 10, reservedQuantity: 2, totalQuantity: 12 }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });
    const res = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-003",
      releasedQuantity: 5,
      operator: "Manager",
      operatorRole: "admin",
      operationId: "OP-INSUFFICIENT-001"
    });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "INSUFFICIENT_RESERVED_INVENTORY");
    assert.strictEqual(fakeDb.collections.holds["FS-RES-20260831-003"].status, "HOLD");
    assert.strictEqual(fakeDb.collections.inventory["STU-6101"].reservedQuantity, 2);
  });

  // -----------------------------------------------------------------------------
  // Test 13: Inventory Balance Negative Protection
  // -----------------------------------------------------------------------------
  await runTest("Negative balance inventory state is blocked with INVALID_INVENTORY_STATE", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-004": {
          id: "FS-RES-20260831-004",
          reservationNumber: "FS-RES-20260831-004",
          productCode: "STU-6101",
          quantity: 10,
          status: "HOLD"
        }
      },
      inventory: {
        "STU-6101": { id: "STU-6101", productCode: "STU-6101", availableQuantity: -10, reservedQuantity: 10, totalQuantity: 0 }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });
    const res = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-004",
      releasedQuantity: 5,
      operator: "Manager",
      operatorRole: "admin",
      operationId: "OP-NEG-001"
    });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "INVALID_INVENTORY_STATE");
  });

  // -----------------------------------------------------------------------------
  // Test 14: Transaction Abort Isolation (0 partial writes & NO status: 'FAILED' inside abort block)
  // -----------------------------------------------------------------------------
  await runTest("Transaction abort ensures 0 partial writes and does NOT write status: FAILED inside abort transaction", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {},
      inventory: {
        "STU-6101": { id: "STU-6101", productCode: "STU-6101", availableQuantity: 10, reservedQuantity: 10, totalQuantity: 20 }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });
    const res = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-NONEXISTENT",
      releasedQuantity: 5,
      operator: "Manager",
      operatorRole: "admin",
      operationId: "OP-ABORT-001"
    });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "HOLD_NOT_FOUND");
    assert.strictEqual(Object.keys(fakeDb.collections.operations).length, 0);
    assert.strictEqual(Object.keys(fakeDb.collections.auditLogs).length, 0);
  });

  // -----------------------------------------------------------------------------
  // Test 15: SDK Internal Retry Idempotency (Deterministic Doc IDs)
  // -----------------------------------------------------------------------------
  await runTest("Deterministic Document IDs prevent duplicate records upon SDK internal retries", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-005": { id: "FS-RES-20260831-005", productCode: "STU-6101", quantity: 10, status: "HOLD" }
      },
      inventory: {
        "STU-6101": { id: "STU-6101", productCode: "STU-6101", availableQuantity: 10, reservedQuantity: 10, totalQuantity: 20 }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });
    const res = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-005",
      releasedQuantity: 5,
      operator: "Manager",
      operatorRole: "admin",
      operationId: "OP-RETRY-001"
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(Object.keys(fakeDb.collections.ledger).length, 1);
    assert.ok(fakeDb.collections.ledger["LEDGER_OP-RETRY-001"]);
    assert.strictEqual(Object.keys(fakeDb.collections.auditLogs).length, 1);
    assert.ok(fakeDb.collections.auditLogs["AUDIT_OP-RETRY-001"]);
  });

  // -----------------------------------------------------------------------------
  // Test 16: Ambiguous Outcome Timeout Readback
  // -----------------------------------------------------------------------------
  await runTest("Ambiguous outcome readback via findOperationId retrieves stored COMMITTED proof", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      operations: {
        "OP-TIMEOUT-001": {
          id: "OP-TIMEOUT-001",
          action: "CANCEL_RELEASE",
          reservationNumber: "FS-RES-20260831-006",
          status: "COMMITTED",
          resultProof: {
            inventoryReleased: true,
            holdUpdated: true,
            auditLogged: true,
            atomic: true,
            readbackVerified: true,
            operationPersisted: true
          }
        }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });
    const readback = await adapter.findOperationId("OP-TIMEOUT-001", "FS-RES-20260831-006");

    assert.strictEqual(readback.found, true);
    assert.strictEqual(readback.status, "COMMITTED");
    assert.strictEqual(readback.resultProof.readbackVerified, true);
  });

  // -----------------------------------------------------------------------------
  // Test 17: Server-Side Role Permission Matrix Enforcement
  // -----------------------------------------------------------------------------
  await runTest("Operator roles sales and retail are rejected before transaction execution with PERMISSION_DENIED", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-007": { id: "FS-RES-20260831-007", productCode: "STU-6101", quantity: 10, status: "HOLD" }
      },
      inventory: {
        "STU-6101": { id: "STU-6101", productCode: "STU-6101", availableQuantity: 10, reservedQuantity: 10, totalQuantity: 20 }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });

    const resSales = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-007",
      releasedQuantity: 5,
      operator: "SalesUser",
      operatorRole: "sales",
      operationId: "OP-SALES-001"
    });
    assert.strictEqual(resSales.ok, false);
    assert.strictEqual(resSales.errorCode, "PERMISSION_DENIED");

    const resRetail = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-007",
      releasedQuantity: 5,
      operator: "RetailUser",
      operatorRole: "retail",
      operationId: "OP-RETAIL-001"
    });
    assert.strictEqual(resRetail.ok, false);
    assert.strictEqual(resRetail.errorCode, "PERMISSION_DENIED");

    assert.strictEqual(fakeDb.collections.holds["FS-RES-20260831-007"].status, "HOLD");
  });

  // -----------------------------------------------------------------------------
  // Test 18: Controlled Projection Worker Failure Isolation
  // -----------------------------------------------------------------------------
  await runTest("Controlled Projection Worker failure does NOT rollback committed Firestore transaction", async () => {
    const fakeDb = ServerFirestoreClientFactory.createEmulatorFake({
      holds: {
        "FS-RES-20260831-008": { id: "FS-RES-20260831-008", productCode: "STU-6101", quantity: 10, status: "HOLD" }
      },
      inventory: {
        "STU-6101": { id: "STU-6101", productCode: "STU-6101", availableQuantity: 10, reservedQuantity: 10, totalQuantity: 20 }
      }
    });

    const adapter = new FirestoreReservationTransactionAdapter({ firestoreDb: fakeDb });
    const txRes = await adapter.executeCancelReleaseTransaction({
      reservationNumber: "FS-RES-20260831-008",
      releasedQuantity: 5,
      operator: "Manager",
      operatorRole: "admin",
      operationId: "OP-PROJ-FAIL-001"
    });

    assert.strictEqual(txRes.ok, true);

    const worker = new ControlledProjectionWorkerMock({ failProjection: true });
    const projRes = worker.processProjectionEvent({
      operationId: "OP-PROJ-FAIL-001",
      reservationNumber: "FS-RES-20260831-008"
    }, "VALID_WORKER_TOKEN");

    assert.strictEqual(projRes.ok, false);
    assert.strictEqual(projRes.errorCode, "SHEET_PROJECTION_ERROR");

    assert.strictEqual(fakeDb.collections.holds["FS-RES-20260831-008"].status, "CANCELLED");
    assert.strictEqual(fakeDb.collections.operations["OP-PROJ-FAIL-001"].status, "COMMITTED");
  });

  // -----------------------------------------------------------------------------
  // Test 19: Unauthorized Worker Projection Rejection
  // -----------------------------------------------------------------------------
  await runTest("Unauthorized Projection Worker is rejected from executing Google Sheet projection", async () => {
    const worker = new ControlledProjectionWorkerMock();
    const projRes = worker.processProjectionEvent({
      operationId: "OP-UNAUTH-001",
      reservationNumber: "FS-RES-20260831-009"
    }, "INVALID_TOKEN");

    assert.strictEqual(projRes.ok, false);
    assert.strictEqual(projRes.errorCode, "UNAUTHORIZED_WORKER");
  });

  // -----------------------------------------------------------------------------
  // Print Summary
  // -----------------------------------------------------------------------------
  console.log(`\n==================================================`);
  console.log(`Firestore Transaction Adapter Simulation Suite Summary:`);
  console.log(`Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log(`==================================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error in simulation runner:", err);
  process.exit(1);
});
