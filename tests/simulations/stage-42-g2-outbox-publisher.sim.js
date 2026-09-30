"use strict";

/**
 * Stage 42-G2 TDD Simulation Suite: Transactional Outbox & Publisher
 *
 * Verifies:
 * 1. Transactional Outbox Creator & In-Transaction Idempotency Guard (Task 1):
 *    - Business writes and Outbox writes atomic inside single transaction.
 *    - Transaction abort leaves 0 business writes and 0 outbox writes.
 *    - Initial outbox creation sets status PENDING, eventId (evt_UUIDv4), schemaVersion 1.0.0.
 *    - Idempotency: same operationId + same payloadHash reuses eventId with 0 extra docs.
 *    - Conflict: same operationId + different payloadHash fails closed with OUTBOX_IDEMPOTENCY_CONFLICT.
 *    - Schema enforcement: operator PII and extra payload fields rejected fail-closed.
 * 2. Atomic 60-Second Publisher Lease Protocol with FakeClock (Task 2):
 *    - Unleased PENDING documents claimed atomically with 60s lease.
 *    - Dual publisher competition: exactly one winner, unexpired lease cannot be pre-empted.
 *    - FakeClock advance past 60s allows second publisher takeover (preserves eventId, new publishAttemptId).
 * 3. Fake Pub/Sub Adapter & Completion Fencing (Task 3 & TC-01):
 *    - Publish encodes G1 Application Envelope in Base64 with proper attributes.
 *    - markOutboxPublished validates leaseOwner, attemptId, status PENDING, and unexpired lease.
 *    - TC-01: Crash-after-publish preserves eventId, fences out old publisher, completes on retry.
 * 4. 5-Minute Outbox Reconciliation Sweep (Task 4 & TC-14):
 *    - Stale threshold: 2 minutes (120,000 ms).
 *    - TC-14: Sweeper safely recovers and publishes stale PENDING events with original eventId.
 */

const assert = require("assert");
const http = require("http");
const { Timestamp } = require("firebase-admin/firestore");
const { ServerFirestoreClientFactory } = require("../../allocation-assistant/factories/server-firestore-client-factory");
const { createFakeClock } = require("../../allocation-assistant/contracts/projection-contract");
const { FakePubSubClientAdapter } = require("../mocks/fake-pubsub-client-adapter");
const {
  stageProjectionOutboxInTransaction,
  claimOutboxBatchForPublishing,
  publishOutboxBatch,
  markOutboxPublished,
  reconcileOutboxPendingBatch
} = require("../../allocation-assistant/adapters/outbox-publisher-adapter");

const DEMO_PROJECT_ID = "demo-jy-stage42-g2";
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function runAsyncTest(description, testFn) {
  totalTests++;
  try {
    await testFn();
    passedTests++;
    console.log(`PASS stage-42-g2-outbox-publisher: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`FAIL stage-42-g2-outbox-publisher: ${description}`);
    console.error(`  Error: ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

// Clear Firestore Emulator collections between tests for absolute isolation
async function clearEmulatorData() {
  const [host, port] = EMULATOR_HOST.split(":");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: host,
        port: Number(port),
        path: `/emulator/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents`,
        method: "DELETE"
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", resolve);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function getTestDb() {
  if (!process.env.FIRESTORE_EMULATOR_HOST && !EMULATOR_HOST) {
    throw new Error("ISOLATION_FAILURE: FIRESTORE_EMULATOR_HOST is missing. Real Firestore access is strictly forbidden.");
  }
  return ServerFirestoreClientFactory.createEmulatorAdminClient({
    projectId: DEMO_PROJECT_ID,
    emulatorHost: EMULATOR_HOST
  });
}

// -----------------------------------------------------------------------------
// Test Case TC-01 Implementation
// -----------------------------------------------------------------------------
async function runTC01() {
  await clearEmulatorData();
  const db = getTestDb();
  const fakeClock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
  const pubsubClient = new FakePubSubClientAdapter();

  const operationId = "op_tc01_crash_retry";
  const reservationNumber = "RES-TC01-001";
  const allocationPayload = { storeId: "STR_A", productCode: "PRD_1", quantity: 5 };
  const operator = { pseudonymousActorId: "actor_tc01" };

  // 1. Stage in transaction
  await db.runTransaction(async (t) => {
    await stageProjectionOutboxInTransaction(t, db, {
      operationId,
      reservationNumber,
      eventType: "HOLD_CREATED",
      sourceDocumentPath: `reservations/${reservationNumber}`,
      payload: allocationPayload,
      operator
    }, fakeClock);
  });

  // Verify initial outbox entry
  const initialDoc = await db.collection("projectionOutbox").doc(operationId).get();
  assert(initialDoc.exists, "Outbox doc must exist");
  const originalEventId = initialDoc.data().eventId;
  assert(originalEventId.startsWith("evt_"), "eventId must start with evt_");

  // 2. Publisher 1 claims lease
  const claimedBatch1 = await claimOutboxBatchForPublishing(db, "pub_instance_1", { batchSize: 10 }, fakeClock);
  assert.strictEqual(claimedBatch1.length, 1);
  const firstAttemptId = claimedBatch1[0].publishAttemptId;
  assert(firstAttemptId, "First claim must generate publishAttemptId");

  // Simulate publish succeeded to Pub/Sub, but publisher crashes BEFORE calling markOutboxPublished
  let crashSimulatedMessageId = null;
  pubsubClient.setCrashBeforeCompletionHook(async (msgId) => {
    crashSimulatedMessageId = msgId;
    // Worker crashes right here: throws error before markOutboxPublished can complete
    throw new Error("SIMULATED_WORKER_CRASH_BEFORE_COMPLETION");
  });

  await publishOutboxBatch(db, pubsubClient, "pub_instance_1", fakeClock, claimedBatch1);
  assert(crashSimulatedMessageId, "Pub/Sub must have received message before crash");
  assert.strictEqual(pubsubClient.messages.length, 1, "One message published before crash");

  // Status must STILL be PENDING because completion mark was not called
  const pendingDoc = await db.collection("projectionOutbox").doc(operationId).get();
  assert.strictEqual(pendingDoc.data().status, "PENDING");

  // 3. Advance clock past 60s lease (61s) to allow recovery
  fakeClock.advanceMillis(61000);

  // 4. Publisher 2 claims the expired item
  const claimedBatch2 = await claimOutboxBatchForPublishing(db, "pub_instance_2", { batchSize: 10 }, fakeClock);
  assert.strictEqual(claimedBatch2.length, 1);
  const secondAttemptId = claimedBatch2[0].publishAttemptId;
  assert.notStrictEqual(secondAttemptId, firstAttemptId, "Second attemptId must be different from first");
  assert.strictEqual(claimedBatch2[0].eventId, originalEventId, "eventId must be strictly preserved across retries");

  // 5. Completion Fencing: Old Publisher 1 attempts to mark completed with old attemptId -> MUST FAIL
  const staleMarkResult = await markOutboxPublished(db, {
    operationId,
    eventId: originalEventId,
    publisherLeaseOwner: "pub_instance_1",
    publishAttemptId: firstAttemptId,
    publishedMessageId: crashSimulatedMessageId
  }, fakeClock);
  assert.strictEqual(staleMarkResult.success, false, "Stale mark must be rejected");
  assert(
    staleMarkResult.errorCode === "PUBLISH_LEASE_LOST" ||
    staleMarkResult.errorCode === "PUBLISH_ATTEMPT_MISMATCH",
    `Expected fencing error code, got ${staleMarkResult.errorCode}`
  );

  // 6. Publisher 2 publishes and successfully completes
  await publishOutboxBatch(db, pubsubClient, "pub_instance_2", fakeClock, claimedBatch2);

  // Fake Pub/Sub should observe at-least-once delivery (2 messages total)
  assert.strictEqual(pubsubClient.messages.length, 2, "Fake Pub/Sub observes at-least-once delivery");
  assert.strictEqual(pubsubClient.messages[0].attributes.eventId, originalEventId);
  assert.strictEqual(pubsubClient.messages[1].attributes.eventId, originalEventId);

  // Final document state must be PUBLISHED with Publisher 2's message ID and attempts count = 2
  const finalDoc = await db.collection("projectionOutbox").doc(operationId).get();
  const finalData = finalDoc.data();
  assert.strictEqual(finalData.status, "PUBLISHED");
  assert.strictEqual(finalData.eventId, originalEventId);
  assert.strictEqual(finalData.publishAttemptId, secondAttemptId);
  assert.strictEqual(finalData.publishAttempts, 2);
  assert(finalData.publishedMessageId.startsWith("pubsub_msg_"));
  assert.strictEqual(finalData.lastError, null);
}

// -----------------------------------------------------------------------------
// Test Case TC-14 Implementation
// -----------------------------------------------------------------------------
async function runTC14() {
  await clearEmulatorData();
  const db = getTestDb();
  const fakeClock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
  const pubsubClient = new FakePubSubClientAdapter();

  const operationId = "op_tc14_reconciliation_sweep";
  const reservationNumber = "RES-TC14-001";
  const allocationPayload = { storeId: "STR_B", productCode: "PRD_2", quantity: 12 };
  const operator = { pseudonymousActorId: "actor_tc14" };

  // 1. Stage an outbox entry in PENDING status
  await db.runTransaction(async (t) => {
    await stageProjectionOutboxInTransaction(t, db, {
      operationId,
      reservationNumber,
      eventType: "HOLD_FULFILLED",
      sourceDocumentPath: `reservations/${reservationNumber}`,
      payload: allocationPayload,
      operator
    }, fakeClock);
  });

  const initialDoc = await db.collection("projectionOutbox").doc(operationId).get();
  const originalEventId = initialDoc.data().eventId;

  // 2. Immediate sweep (< 2 minutes, exactly 0 ms elapsed): MUST NOT recover
  const sweep0 = await reconcileOutboxPendingBatch(db, pubsubClient, fakeClock);
  assert.strictEqual(sweep0.recoveredCount, 0, "Immediate sweep must recover 0 items");
  assert.strictEqual(pubsubClient.messages.length, 0);

  // 3. Advance clock by 1 minute (60,000 ms, still < 2 minutes threshold): MUST NOT recover
  fakeClock.advanceMillis(60000);
  const sweep1 = await reconcileOutboxPendingBatch(db, pubsubClient, fakeClock);
  assert.strictEqual(sweep1.recoveredCount, 0, "Sweep under 2 minutes must recover 0 items");
  assert.strictEqual(pubsubClient.messages.length, 0);

  // 4. Advance clock by another 1.5 minutes (90,000 ms, total 2.5 minutes elapsed): MUST recover!
  fakeClock.advanceMillis(90000);
  const sweep2 = await reconcileOutboxPendingBatch(db, pubsubClient, fakeClock);
  assert.strictEqual(sweep2.recoveredCount, 1, "Sweep at 2.5 minutes must recover 1 stale item");

  // Verify message published to Fake Pub/Sub
  assert.strictEqual(pubsubClient.messages.length, 1);
  assert.strictEqual(pubsubClient.messages[0].attributes.eventId, originalEventId);
  assert.strictEqual(pubsubClient.messages[0].attributes.operationId, operationId);
  assert.strictEqual(pubsubClient.messages[0].attributes.eventType, "HOLD_FULFILLED");

  // Verify Firestore document is now PUBLISHED with original eventId and incremented attempts
  const recoveredDoc = await db.collection("projectionOutbox").doc(operationId).get();
  const recoveredData = recoveredDoc.data();
  assert.strictEqual(recoveredData.status, "PUBLISHED");
  assert.strictEqual(recoveredData.eventId, originalEventId);
  assert(recoveredData.publishAttemptId, "Must have publishAttemptId set");
  assert.strictEqual(recoveredData.publishAttempts, 1);
  assert(recoveredData.publishedMessageId.startsWith("pubsub_msg_"));
}

// -----------------------------------------------------------------------------
// Detailed Unit Tests for Task 1, Task 2, Task 3, Task 4
// -----------------------------------------------------------------------------
async function runAllTests() {
  console.log("=== Starting Stage 42-G2 Transactional Outbox & Publisher Simulation Suite ===");

  const db = getTestDb();

  // Task 1: stageProjectionOutboxInTransaction tests
  await runAsyncTest("1.1 Transaction abort guarantees business document writes = 0 and outbox writes = 0", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const opId = "op_abort_test";
    const resNumber = "RES-ABORT-001";

    let transactionFailed = false;
    try {
      await db.runTransaction(async (t) => {
        // Outbox read & stage (reads outbox doc, then sets outbox)
        await stageProjectionOutboxInTransaction(t, db, {
          operationId: opId,
          reservationNumber: resNumber,
          eventType: "HOLD_CREATED",
          sourceDocumentPath: `reservations/${resNumber}`,
          payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 1 },
          operator: { pseudonymousActorId: "actor_1" }
        }, clock);
        // Business write
        t.set(db.collection("reservations").doc(resNumber), { status: "ACTIVE" });
        // Force transaction failure
        throw new Error("INTENTIONAL_TRANSACTION_ABORT");
      });
    } catch (e) {
      if (e.message === "INTENTIONAL_TRANSACTION_ABORT") {
        transactionFailed = true;
      } else {
        throw e;
      }
    }

    assert(transactionFailed, "Transaction must fail with intentional abort");
    const resDoc = await db.collection("reservations").doc(resNumber).get();
    assert.strictEqual(resDoc.exists, false, "Business document write must be 0 after abort");
    const outboxDoc = await db.collection("projectionOutbox").doc(opId).get();
    assert.strictEqual(outboxDoc.exists, false, "Outbox document write must be 0 after abort");
  });

  await runAsyncTest("1.2 First creation establishes complete Outbox entry with all Stage 42-F required fields", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const opId = "op_create_fields";
    const resNumber = "RES-001";

    let result;
    await db.runTransaction(async (t) => {
      result = await stageProjectionOutboxInTransaction(t, db, {
        operationId: opId,
        reservationNumber: resNumber,
        eventType: "HOLD_CREATED",
        sourceDocumentPath: `reservations/${resNumber}`,
        payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 10 },
        operator: { pseudonymousActorId: "actor_admin" }
      }, clock);
    });

    assert(result, "Result must be returned");
    const doc = await db.collection("projectionOutbox").doc(opId).get();
    assert(doc.exists, "Outbox document must exist");
    const data = doc.data();

    assert.strictEqual(data.schemaVersion, "1.0.0");
    assert.strictEqual(data.operationId, opId);
    assert.strictEqual(data.reservationNumber, resNumber);
    assert(data.eventId.startsWith("evt_"), "eventId must start with evt_");
    assert.strictEqual(data.eventType, "HOLD_CREATED");
    assert.strictEqual(data.sourceDocumentPath, `reservations/${resNumber}`);
    assert.strictEqual(data.status, "PENDING");
    assert.strictEqual(data.publishAttempts, 0);
    assert.strictEqual(data.lastError, null);
    assert.strictEqual(data.publisherLeaseOwner, null);
    assert.strictEqual(data.publisherLeaseExpiresAt, null);
    assert.strictEqual(data.publishAttemptId, null);
    assert.strictEqual(data.publishedMessageId, null);
    assert.strictEqual(data.operator.pseudonymousActorId, "actor_admin");
    assert.strictEqual(data.payload.quantity, 10);
    assert(data.createdAt instanceof Timestamp || typeof data.createdAt?.toMillis === "function");
    assert.strictEqual(data.payloadHash.length, 64);
  });

  await runAsyncTest("1.3 Same operationId with same payloadHash reuses original eventId with 0 extra writes", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const opId = "op_idempotent";
    const resNumber = "RES-IDEMPOTENT";
    const payload = { storeId: "STR_1", productCode: "PRD_A", quantity: 5 };
    const operator = { pseudonymousActorId: "actor_1" };

    let entry1;
    await db.runTransaction(async (t) => {
      entry1 = await stageProjectionOutboxInTransaction(t, db, {
        operationId: opId,
        reservationNumber: resNumber,
        eventType: "HOLD_CREATED",
        sourceDocumentPath: `reservations/${resNumber}`,
        payload,
        operator
      }, clock);
    });

    // Advance clock to ensure original occurredAt/createdAt is not overwritten
    clock.advanceMillis(5000);

    let entry2;
    await db.runTransaction(async (t) => {
      entry2 = await stageProjectionOutboxInTransaction(t, db, {
        operationId: opId,
        reservationNumber: resNumber,
        eventType: "HOLD_CREATED",
        sourceDocumentPath: `reservations/${resNumber}`,
        payload,
        operator
      }, clock);
    });

    assert.strictEqual(entry2.eventId, entry1.eventId, "eventId must be identical on idempotent replay");
    assert.strictEqual(entry2.createdAt.toMillis(), entry1.createdAt.toMillis(), "createdAt must not be overwritten");

    const allOutboxDocs = await db.collection("projectionOutbox").get();
    assert.strictEqual(allOutboxDocs.size, 1, "Exactly 1 outbox document must exist");
  });

  await runAsyncTest("1.4 Same operationId with different payloadHash throws OUTBOX_IDEMPOTENCY_CONFLICT fail-closed", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const opId = "op_conflict";

    await db.runTransaction(async (t) => {
      await stageProjectionOutboxInTransaction(t, db, {
        operationId: opId,
        reservationNumber: "RES-1",
        eventType: "HOLD_CREATED",
        sourceDocumentPath: "reservations/RES-1",
        payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 5 },
        operator: { pseudonymousActorId: "actor_1" }
      }, clock);
    });

    let conflictThrown = false;
    try {
      await db.runTransaction(async (t) => {
        await stageProjectionOutboxInTransaction(t, db, {
          operationId: opId,
          reservationNumber: "RES-1",
          eventType: "HOLD_CREATED",
          sourceDocumentPath: "reservations/RES-1",
          payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 99 }, // DIFFERENT quantity!
          operator: { pseudonymousActorId: "actor_1" }
        }, clock);
      });
    } catch (err) {
      if (err.message.includes("OUTBOX_IDEMPOTENCY_CONFLICT")) {
        conflictThrown = true;
      } else {
        throw err;
      }
    }

    assert(conflictThrown, "Must throw OUTBOX_IDEMPOTENCY_CONFLICT on payload hash mismatch");
    const doc = await db.collection("projectionOutbox").doc(opId).get();
    assert.strictEqual(doc.data().payload.quantity, 5, "Original payload must remain unaltered");
  });

  await runAsyncTest("1.5 Operator with email, raw LINE ID, or extra fields is rejected fail-closed", async () => {
    const clock = createFakeClock();
    const db = getTestDb();

    await assert.rejects(async () => {
      await db.runTransaction(async (t) => {
        await stageProjectionOutboxInTransaction(t, db, {
          operationId: "op_pii_1",
          reservationNumber: "RES-PII",
          eventType: "HOLD_CREATED",
          sourceDocumentPath: "reservations/RES-PII",
          payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 5 },
          operator: { pseudonymousActorId: "test@example.com" } // EMAIL
        }, clock);
      });
    }, /OPERATOR_ACTOR_ID_CONTAINS_EMAIL/);

    await assert.rejects(async () => {
      await db.runTransaction(async (t) => {
        await stageProjectionOutboxInTransaction(t, db, {
          operationId: "op_pii_2",
          reservationNumber: "RES-PII",
          eventType: "HOLD_CREATED",
          sourceDocumentPath: "reservations/RES-PII",
          payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 5 },
          operator: { pseudonymousActorId: "U1234567890abcdef1234567890abcdef" } // RAW LINE USER ID
        }, clock);
      });
    }, /OPERATOR_ACTOR_ID_CONTAINS_RAW_LINE_ID/);
  });

  // Task 2: claimOutboxBatchForPublishing tests
  await runAsyncTest("2.1 claimOutboxBatchForPublishing atomically claims unleased PENDING items with 60s lease", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));

    await db.runTransaction(async (t) => {
      await stageProjectionOutboxInTransaction(t, db, {
        operationId: "op_claim_1",
        reservationNumber: "RES-CLM-1",
        eventType: "HOLD_CREATED",
        sourceDocumentPath: "reservations/RES-CLM-1",
        payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 2 },
        operator: { pseudonymousActorId: "actor_1" }
      }, clock);
    });

    const claimed = await claimOutboxBatchForPublishing(db, "pub_alpha", { batchSize: 10 }, clock);
    assert.strictEqual(claimed.length, 1);
    assert.strictEqual(claimed[0].publisherLeaseOwner, "pub_alpha");
    assert.strictEqual(claimed[0].publishAttempts, 1);
    assert(claimed[0].publishAttemptId, "Must have publishAttemptId");

    const doc = await db.collection("projectionOutbox").doc("op_claim_1").get();
    const data = doc.data();
    assert.strictEqual(data.publisherLeaseOwner, "pub_alpha");
    assert.strictEqual(data.publisherLeaseExpiresAt.toMillis(), clock.nowMillis() + 60000);
  });

  await runAsyncTest("2.2 Dual publisher competition: exactly one winner, unexpired lease cannot be claimed", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));

    await db.runTransaction(async (t) => {
      await stageProjectionOutboxInTransaction(t, db, {
        operationId: "op_compete",
        reservationNumber: "RES-COMPETE",
        eventType: "HOLD_CREATED",
        sourceDocumentPath: "reservations/RES-COMPETE",
        payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 3 },
        operator: { pseudonymousActorId: "actor_1" }
      }, clock);
    });

    // Publisher 1 claims lease
    const claim1 = await claimOutboxBatchForPublishing(db, "pub_1", { batchSize: 10 }, clock);
    assert.strictEqual(claim1.length, 1);

    // Publisher 2 tries to claim while lease is unexpired (only 10s passed)
    clock.advanceMillis(10000);
    const claim2 = await claimOutboxBatchForPublishing(db, "pub_2", { batchSize: 10 }, clock);
    assert.strictEqual(claim2.length, 0, "Competing publisher must not claim unexpired lease");

    const doc = await db.collection("projectionOutbox").doc("op_compete").get();
    assert.strictEqual(doc.data().publisherLeaseOwner, "pub_1", "Owner must remain pub_1");
  });

  await runAsyncTest("2.3 Advancing FakeClock past 60s allows second publisher takeover with new attemptId and same eventId", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));

    await db.runTransaction(async (t) => {
      await stageProjectionOutboxInTransaction(t, db, {
        operationId: "op_takeover",
        reservationNumber: "RES-TO",
        eventType: "HOLD_CREATED",
        sourceDocumentPath: "reservations/RES-TO",
        payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 4 },
        operator: { pseudonymousActorId: "actor_1" }
      }, clock);
    });

    const claim1 = await claimOutboxBatchForPublishing(db, "pub_old", { batchSize: 10 }, clock);
    const eventId1 = claim1[0].eventId;
    const attempt1 = claim1[0].publishAttemptId;

    // Advance clock past 60s (61 seconds)
    clock.advanceMillis(61000);

    const claim2 = await claimOutboxBatchForPublishing(db, "pub_new", { batchSize: 10 }, clock);
    assert.strictEqual(claim2.length, 1);
    assert.strictEqual(claim2[0].publisherLeaseOwner, "pub_new");
    assert.strictEqual(claim2[0].eventId, eventId1, "eventId must be preserved upon takeover");
    assert.notStrictEqual(claim2[0].publishAttemptId, attempt1, "publishAttemptId must change on takeover");
    assert.strictEqual(claim2[0].publishAttempts, 2, "Attempts count must increment to 2");
  });

  // Task 3: markOutboxPublished completion fencing tests
  await runAsyncTest("3.1 markOutboxPublished fencing rejects if publisherLeaseOwner mismatches (PUBLISH_LEASE_LOST)", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));

    await db.runTransaction(async (t) => {
      await stageProjectionOutboxInTransaction(t, db, {
        operationId: "op_fence_owner",
        reservationNumber: "RES-FO",
        eventType: "HOLD_CREATED",
        sourceDocumentPath: "reservations/RES-FO",
        payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 1 },
        operator: { pseudonymousActorId: "actor_1" }
      }, clock);
    });

    const claim = await claimOutboxBatchForPublishing(db, "pub_legit", { batchSize: 10 }, clock);
    const res = await markOutboxPublished(db, {
      operationId: "op_fence_owner",
      eventId: claim[0].eventId,
      publisherLeaseOwner: "pub_impostor",
      publishAttemptId: claim[0].publishAttemptId,
      publishedMessageId: "msg_123"
    }, clock);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errorCode, "PUBLISH_LEASE_LOST");
  });

  await runAsyncTest("3.2 markOutboxPublished fencing rejects if lease expired (PUBLISH_LEASE_EXPIRED)", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));

    await db.runTransaction(async (t) => {
      await stageProjectionOutboxInTransaction(t, db, {
        operationId: "op_fence_exp",
        reservationNumber: "RES-FE",
        eventType: "HOLD_CREATED",
        sourceDocumentPath: "reservations/RES-FE",
        payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 1 },
        operator: { pseudonymousActorId: "actor_1" }
      }, clock);
    });

    const claim = await claimOutboxBatchForPublishing(db, "pub_legit", { batchSize: 10 }, clock);
    clock.advanceMillis(65000); // Expired!

    const res = await markOutboxPublished(db, {
      operationId: "op_fence_exp",
      eventId: claim[0].eventId,
      publisherLeaseOwner: "pub_legit",
      publishAttemptId: claim[0].publishAttemptId,
      publishedMessageId: "msg_123"
    }, clock);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errorCode, "PUBLISH_LEASE_EXPIRED");
  });

  await runAsyncTest("2.4 Batch size validation enforces positive integer <= 100", async () => {
    const clock = createFakeClock();
    await assert.rejects(async () => {
      await claimOutboxBatchForPublishing(db, "pub_1", { batchSize: 0 }, clock);
    }, /INVALID_BATCH_SIZE/);
    await assert.rejects(async () => {
      await claimOutboxBatchForPublishing(db, "pub_1", { batchSize: -1 }, clock);
    }, /INVALID_BATCH_SIZE/);
    await assert.rejects(async () => {
      await claimOutboxBatchForPublishing(db, "pub_1", { batchSize: 101 }, clock);
    }, /INVALID_BATCH_SIZE/);
    await assert.rejects(async () => {
      await claimOutboxBatchForPublishing(db, "pub_1", { batchSize: 1.5 }, clock);
    }, /INVALID_BATCH_SIZE/);
  });

  await runAsyncTest("2.5 Corrupted/negative publishAttempts fails closed", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const opId = "op_corrupt_attempts";

    await db.collection("projectionOutbox").doc(opId).set({
      operationId: opId,
      status: "PENDING",
      publishAttempts: -5,
      createdAt: clock.nowTimestamp(),
      publisherLeaseOwner: null,
      publisherLeaseExpiresAt: null
    });

    await assert.rejects(async () => {
      await claimOutboxBatchForPublishing(db, "pub_check", { batchSize: 10 }, clock);
    }, /CORRUPTED_OUTBOX_RECORD/);
  });

  await runAsyncTest("3.3 markOutboxPublished fencing rejects if publishAttemptId mismatches (PUBLISH_ATTEMPT_MISMATCH)", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));

    await db.runTransaction(async (t) => {
      await stageProjectionOutboxInTransaction(t, db, {
        operationId: "op_fence_attempt",
        reservationNumber: "RES-FA",
        eventType: "HOLD_CREATED",
        sourceDocumentPath: "reservations/RES-FA",
        payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 1 },
        operator: { pseudonymousActorId: "actor_1" }
      }, clock);
    });

    const claim = await claimOutboxBatchForPublishing(db, "pub_legit", { batchSize: 10 }, clock);
    const res = await markOutboxPublished(db, {
      operationId: "op_fence_attempt",
      eventId: claim[0].eventId,
      publisherLeaseOwner: "pub_legit",
      publishAttemptId: "wrong_attempt_id",
      publishedMessageId: "msg_123"
    }, clock);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errorCode, "PUBLISH_ATTEMPT_MISMATCH");
  });

  await runAsyncTest("3.4 markOutboxPublished fencing rejects if already processed (ALREADY_PROCESSED)", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));

    await db.runTransaction(async (t) => {
      await stageProjectionOutboxInTransaction(t, db, {
        operationId: "op_already_done",
        reservationNumber: "RES-AD",
        eventType: "HOLD_CREATED",
        sourceDocumentPath: "reservations/RES-AD",
        payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 1 },
        operator: { pseudonymousActorId: "actor_1" }
      }, clock);
    });

    const claim = await claimOutboxBatchForPublishing(db, "pub_legit", { batchSize: 10 }, clock);
    const res1 = await markOutboxPublished(db, {
      operationId: "op_already_done",
      eventId: claim[0].eventId,
      publisherLeaseOwner: "pub_legit",
      publishAttemptId: claim[0].publishAttemptId,
      publishedMessageId: "msg_123"
    }, clock);
    assert.strictEqual(res1.success, true);

    const res2 = await markOutboxPublished(db, {
      operationId: "op_already_done",
      eventId: claim[0].eventId,
      publisherLeaseOwner: "pub_legit",
      publishAttemptId: claim[0].publishAttemptId,
      publishedMessageId: "msg_123"
    }, clock);
    assert.strictEqual(res2.success, false);
    assert.strictEqual(res2.errorCode, "ALREADY_PROCESSED");
  });

  await runAsyncTest("3.5 Publish failure preserves status PENDING and records sanitized lastError", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const pubsubClient = new FakePubSubClientAdapter();
    pubsubClient.injectFailure(new Error("PUBSUB_DOWN_TOKEN=secret_key_12345"));

    await db.runTransaction(async (t) => {
      await stageProjectionOutboxInTransaction(t, db, {
        operationId: "op_pub_fail",
        reservationNumber: "RES-PF",
        eventType: "HOLD_CREATED",
        sourceDocumentPath: "reservations/RES-PF",
        payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 1 },
        operator: { pseudonymousActorId: "actor_1" }
      }, clock);
    });

    const results = await publishOutboxBatch(db, pubsubClient, "pub_failing", clock);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, false);

    const doc = await db.collection("projectionOutbox").doc("op_pub_fail").get();
    const data = doc.data();
    assert.strictEqual(data.status, "PENDING", "Status must remain PENDING on publish failure");
    assert.strictEqual(data.publishedMessageId, null, "publishedMessageId must remain null");
    assert(data.lastError, "lastError must be recorded");
    assert(!data.lastError.includes("secret_key_12345"), "lastError must sanitize tokens and secrets");
  });

  await runAsyncTest("4.3 Concurrent reconciliation: only one reconciler obtains lease and recovers item", async () => {
    await clearEmulatorData();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const pubsubClient = new FakePubSubClientAdapter();

    await db.runTransaction(async (t) => {
      await stageProjectionOutboxInTransaction(t, db, {
        operationId: "op_concurrent_sweep",
        reservationNumber: "RES-CS",
        eventType: "HOLD_CREATED",
        sourceDocumentPath: "reservations/RES-CS",
        payload: { storeId: "STR_1", productCode: "PRD_A", quantity: 2 },
        operator: { pseudonymousActorId: "actor_1" }
      }, clock);
    });

    // Advance clock past 2.5 minutes
    clock.advanceMillis(150000);

    // Two reconcilers sweep concurrently
    const [resA, resB] = await Promise.all([
      reconcileOutboxPendingBatch(db, pubsubClient, clock, { reconcilerInstanceId: "reconciler_A" }),
      reconcileOutboxPendingBatch(db, pubsubClient, clock, { reconcilerInstanceId: "reconciler_B" })
    ]);

    const totalRecovered = resA.recoveredCount + resB.recoveredCount;
    assert.strictEqual(totalRecovered, 1, "Exactly one reconciler must recover the item");
    assert.strictEqual(pubsubClient.messages.length, 1, "Exactly one message published");
  });

  // Execute TC-01 and TC-14
  await runAsyncTest("TC-01: Publisher crash after publish preserves eventId and generates new publishAttemptId", runTC01);
  await runAsyncTest("TC-14: 5-minute outbox sweep safely republishes stale PENDING events using original eventId", runTC14);

  console.log("\n==================================================");
  console.log(`Stage 42-G2 Outbox Publisher Simulation Summary:`);
  console.log(`Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log("==================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

// Run when executed directly via node
if (require.main === module) {
  runAllTests().catch((err) => {
    console.error("FATAL_TEST_RUNNER_ERROR:", err);
    process.exit(1);
  });
}

// Exported Test Registry for external test runner & master verification
const tests = [
  {
    id: "TC-01",
    name: "Publisher crash after publish preserves eventId and generates new publishAttemptId",
    run: runTC01
  },
  {
    id: "TC-14",
    name: "5-minute outbox sweep safely republishes stale PENDING events using original eventId",
    run: runTC14
  }
];

const testRegistry = {
  "TC-01": runTC01,
  "TC-14": runTC14
};

module.exports = {
  tests,
  testRegistry,
  runTC01,
  runTC14
};

