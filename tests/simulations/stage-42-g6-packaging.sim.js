/**
 * Stage 42-G6: System Packaging & Encapsulation Simulation Tests
 *
 * Covers:
 * - Suite 1: E2E Lifecycle Pipeline (Environment Guard, Transactional Outbox Staging, PubSub Dispatch, Projection Worker Execution)
 * - Suite 2: Unified Failure Handling & Worker Fencing (Fail-closed Tamper Quarantine, Lease Expiration, DLQ Intake & Worker Fencing, Sanitized Alerting)
 * - Suite 3: Reconciler Orchestration, Compensation & Pruning (Audit Self-Healing, TC-13 Reconstruction, Negative Offset Compensation, Retention Pruning)
 */

const assert = require("assert");
const http = require("http");
const admin = require("firebase-admin");
const { Timestamp, FieldValue } = require("firebase-admin/firestore");

const {
  ProjectionEngine,
  createProjectionEngine,
  validateEmulatorHost,
  validateProjectEnvironment,
  validateProjectionEnvironment,
  computePayloadHash64,
  serializeCanonicalJson,
  createFakeClock,
  validateAllocationPayload,
  buildApplicationEnvelope
} = require("../../allocation-assistant/projection");

const { FakeGoogleSheetsClientAdapter } = require("../mocks/fake-google-sheets-client-adapter");
const { ServerFirestoreClientFactory } = require("../../allocation-assistant/factories/server-firestore-client-factory");

const DEMO_PROJECT_ID = "demo-jy-stage42-g6";

let testDb = null;

function getTestFirestore() {
  if (!testDb) {
    const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
    validateEmulatorHost(host);
    validateProjectEnvironment(process.env, DEMO_PROJECT_ID);

    testDb = ServerFirestoreClientFactory.createEmulatorAdminClient({
      projectId: DEMO_PROJECT_ID,
      emulatorHost: host
    });
  }
  return testDb;
}

async function clearEmulatorData() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  const [hostname, port] = host.split(":");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname,
        port: Number(port),
        path: `/emulator/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents`,
        method: "DELETE"
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve());
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function makeClock(isoString = "2026-10-23T10:00:00.000Z") {
  const millis = Date.parse(isoString);
  return createFakeClock(millis);
}

class FakePubSubClient {
  constructor() {
    this.publishedMessages = [];
  }
  async publish(topic, msg) {
    const messageId = `MSG_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.publishedMessages.push({ topic, ...msg, messageId });
    return messageId;
  }
}

class FakeAlertingAdapter {
  constructor() {
    this.alerts = [];
  }
  async sendAlert(payload, deduplicationKey) {
    const key = (payload && payload.idempotencyKey) || deduplicationKey;
    this.alerts.push({ payload, deduplicationKey: key, timestamp: Date.now() });
    return { outcome: "SENT", messageId: `ALERT_${this.alerts.length}` };
  }
}

function makeSampleEnvelope(opId, eventType = "HOLD_CREATED", qty = 100) {
  return buildApplicationEnvelope({
    operationId: opId,
    reservationNumber: `RES-${opId}`,
    eventType,
    operatorId: "ACTOR_SALES_01",
    allocationData: {
      storeId: "STORE_NORTH_01",
      productCode: "TL-6060-IVORY",
      quantity: qty
    }
  });
}

function makeSampleCloudEvent(envelope, deliveryAttempt = 5) {
  const base64Data = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
  return {
    specversion: "1.0",
    id: `evt_dlq_${envelope.operationId}`,
    source: "//pubsub.googleapis.com/projects/demo-jy-stage42-g6/topics/dlq",
    type: "google.cloud.pubsub.topic.v1.messagePublished",
    time: "2026-10-23T10:50:00.000Z",
    data: {
      message: {
        data: base64Data,
        messageId: `msg_${envelope.operationId}`,
        publishTime: "2026-10-23T10:50:00.000Z",
        attributes: {
          schemaVersion: envelope.schemaVersion || "1.0.0",
          eventType: envelope.eventType,
          operationId: envelope.operationId,
          eventId: envelope.eventId
        }
      },
      deliveryAttempt
    }
  };
}

// ==========================================
// Suite 1: E2E Lifecycle Pipeline
// ==========================================

async function testSuite1_E2ELifecycle(db) {
  console.log("\n--- Suite 1: E2E Lifecycle Pipeline ---");

  // G6-S1-01: Environment Guard Fail-Closed Verification
  {
    assert.throws(
      () => validateEmulatorHost(""),
      /FAIL_CLOSED_EMULATOR_GUARD: FIRESTORE_EMULATOR_HOST is missing/
    );
    assert.throws(
      () => validateEmulatorHost("http://127.0.0.1:8080"),
      /must not contain a URL scheme/
    );
    assert.throws(
      () => validateEmulatorHost("192.168.1.100:8080"),
      /Host must be local/
    );
    assert.throws(
      () => validateProjectEnvironment({ GCLOUD_PROJECT: "a", GOOGLE_CLOUD_PROJECT: "b" }),
      /Environment project mismatch/
    );
    const validConfig = validateProjectionEnvironment({
      env: {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        GCLOUD_PROJECT: DEMO_PROJECT_ID,
        GOOGLE_CLOUD_PROJECT: DEMO_PROJECT_ID
      },
      sheetConfig: { spreadsheetId: "SHEET_123" },
      topic: "TOPIC_ABC"
    });
    assert.strictEqual(validConfig.projectId, DEMO_PROJECT_ID);
    assert.strictEqual(validConfig.sheetConfig.spreadsheetId, "SHEET_123");
    console.log("  PASS G6-S1-01: Environment guard fail-closed verification");
  }

  // G6-S1-02: Atomic Outbox Staging via engine.stageOutbox
  {
    const clock = makeClock("2026-10-23T10:05:00.000Z");
    const engine = createProjectionEngine({ firestoreDb: db, clock });
    const opId = "OP_G6_STAGE_01";
    const envelope = makeSampleEnvelope(opId);

    await db.runTransaction(async (transaction) => {
      // Atomically stage outbox (read before write)
      await engine.stageOutbox(transaction, envelope);
      // Simulate business write
      transaction.set(db.collection("reservations").doc(`RES-${opId}`), { status: "ACTIVE" });
    });

    const outboxDoc = await db.collection("projectionOutbox").doc(opId).get();
    assert.ok(outboxDoc.exists, "Outbox record must exist");
    const data = outboxDoc.data();
    assert.strictEqual(data.status, "PENDING");
    assert.strictEqual(data.operationId, opId);
    assert.strictEqual(data.payloadHash, envelope.payloadHash);
    console.log("  PASS G6-S1-02: Atomic outbox staging inside business transaction");
  }

  // G6-S1-03: Outbox Batch Dispatch via engine.dispatchOutboxBatch
  {
    const clock = makeClock("2026-10-23T10:10:00.000Z");
    const pubsubClient = new FakePubSubClient();
    const engine = createProjectionEngine({
      firestoreDb: db,
      pubsubClient,
      topic: "projects/demo/topics/projections",
      clock
    });

    const dispatchRes = await engine.dispatchOutboxBatch({ batchSize: 5 });
    assert.strictEqual(dispatchRes.publishedCount, 1);
    assert.strictEqual(pubsubClient.publishedMessages.length, 1);

    const outboxDoc = (await db.collection("projectionOutbox").doc("OP_G6_STAGE_01").get()).data();
    assert.strictEqual(outboxDoc.status, "PUBLISHED");
    assert.ok(outboxDoc.publishedAt);
    console.log("  PASS G6-S1-03: Outbox batch claimed, published to PubSub, and marked PUBLISHED");
  }

  // G6-S1-04: Projection Worker Execution via engine.processProjectionEvent
  {
    const clock = makeClock("2026-10-23T10:15:00.000Z");
    const sheetsClient = new FakeGoogleSheetsClientAdapter();
    const engine = createProjectionEngine({ firestoreDb: db, sheetsClient, clock });
    const opId = "OP_G6_WORK_01";
    const envelope = makeSampleEnvelope(opId, "HOLD_CREATED", 250);

    const result = await engine.processProjectionEvent(envelope);
    assert.strictEqual(result.status, "ACK");
    assert.strictEqual(result.outcome, "PROJECTION_SUCCEEDED");

    // Verify Firestore state
    const opDoc = (await db.collection("projectionOperations").doc(opId).get()).data();
    assert.strictEqual(opDoc.status, "SUCCEEDED");
    assert.strictEqual(opDoc.claimVersion, 1);

    // Verify Sheets row
    const rows = sheetsClient.getRows("PROJECTION_LOG");
    assert.strictEqual(rows.length, 1);
    const row = rows[0];
    assert.strictEqual(row[0], `PROJECTION_${opId}`);
    assert.strictEqual(row[1], opId);
    assert.strictEqual(row[3], `RES-${opId}`);
    assert.strictEqual(row[6], 250); // quantity
    assert.strictEqual(row[11], envelope.payloadHash); // 12th column hash
    console.log("  PASS G6-S1-04: Normal projection event written to Sheets with 12 columns and finalized SUCCEEDED");
  }

  // G6-S1-05: Duplicate Projection Event Idempotency
  {
    const clock = makeClock("2026-10-23T10:20:00.000Z");
    const sheetsClient = new FakeGoogleSheetsClientAdapter();
    const engine = createProjectionEngine({ firestoreDb: db, sheetsClient, clock });
    const opId = "OP_G6_WORK_01"; // reuse from previous test
    const envelope = makeSampleEnvelope(opId, "HOLD_CREATED", 250);

    const duplicateRes = await engine.processProjectionEvent(envelope);
    assert.strictEqual(duplicateRes.status, "ACK");
    assert.strictEqual(duplicateRes.outcome, "ALREADY_COMPLETED");
    assert.strictEqual(sheetsClient.getRows("PROJECTION_LOG").length, 0, "0 duplicate sheet writes");
    console.log("  PASS G6-S1-05: Duplicate projection event returns fixed ACK with 0 duplicate sheet rows");
  }
}

// ==========================================
// Suite 2: Unified Failure Handling & Worker Fencing
// ==========================================

async function testSuite2_FailureAndFencing(db) {
  console.log("\n--- Suite 2: Unified Failure Handling & Worker Fencing ---");

  // G6-S2-01: Tampered Payload Mismatch Transitions to MANUAL_REVIEW_REQUIRED
  {
    const clock = makeClock("2026-10-23T10:30:00.000Z");
    const sheetsClient = new FakeGoogleSheetsClientAdapter();
    const engine = createProjectionEngine({ firestoreDb: db, sheetsClient, clock });
    const opId = "OP_G6_TAMPER_01";
    const envelope = makeSampleEnvelope(opId);
    // Tamper the payloadHash
    envelope.payloadHash = "deadbeef".repeat(8);

    const res = await engine.processProjectionEvent(envelope);
    assert.strictEqual(res.status, "ACK", "Non-retryable tamper error returns ACK to clear worker queue");
    assert.strictEqual(res.outcome, "MANUAL_REVIEW_REQUIRED");

    const opDoc = (await db.collection("projectionOperations").doc(opId).get()).data();
    assert.strictEqual(opDoc.status, "MANUAL_REVIEW_REQUIRED");
    assert.strictEqual(sheetsClient.getRows("PROJECTION_LOG").length, 0, "0 sheet writes on tamper");
    console.log("  PASS G6-S2-01: Tampered payload caught, transitioned to MANUAL_REVIEW_REQUIRED with 0 sheet writes");
  }

  // G6-S2-02: Expired Processing Lease Allows Worker Takeover
  {
    const t0 = makeClock("2026-10-23T10:40:00.000Z");
    const sheetsClient = new FakeGoogleSheetsClientAdapter();
    const opId = "OP_G6_TAKEOVER_01";
    const envelope = makeSampleEnvelope(opId);

    // Initial claim by worker 1
    // Seed initial processing state manually
    await db.collection("projectionOperations").doc(opId).set({
      operationId: opId,
      status: "PROCESSING",
      workerId: "WORKER_A",
      claimVersion: 1,
      leaseExpiresAt: Timestamp.fromMillis(t0.nowTimestamp().toMillis() + 180000),
      payloadHash: envelope.payloadHash,
      projectionSnapshot: envelope.payload
    });

    // Advance clock past lease (190s)
    const t1 = makeClock("2026-10-23T10:43:10.000Z");
    const engine2 = createProjectionEngine({ firestoreDb: db, sheetsClient, engineId: "WORKER_B", clock: t1 });

    const takeoverRes = await engine2.processProjectionEvent(envelope);
    assert.strictEqual(takeoverRes.status, "ACK");
    assert.strictEqual(takeoverRes.outcome, "PROJECTION_SUCCEEDED");

    const docAfter = (await db.collection("projectionOperations").doc(opId).get()).data();
    assert.strictEqual(docAfter.status, "SUCCEEDED");
    assert.strictEqual(docAfter.claimVersion, 2, "Claim version incremented on takeover");
    console.log("  PASS G6-S2-02: Expired processing lease enables clean worker takeover with incremented claimVersion");
  }

  // G6-S2-03: DLQ CloudEvent Intake Fences Worker
  {
    const clock = makeClock("2026-10-23T10:50:00.000Z");
    const alertingClient = new FakeAlertingAdapter();
    const engine = createProjectionEngine({ firestoreDb: db, alertingClient, clock });
    const opId = "OP_G6_DLQ_FENCE_01";
    const envelope = makeSampleEnvelope(opId);

    // Initial state: PENDING
    await db.collection("projectionOperations").doc(opId).set({
      operationId: opId,
      eventId: envelope.eventId,
      status: "PENDING",
      payloadHash: envelope.payloadHash,
      projectionSnapshot: envelope.payload,
      createdAt: clock.nowTimestamp()
    });

    // Simulate CloudEvent delivered to DLQ subscriber
    const dlqPayload = makeSampleCloudEvent(envelope, 5);

    const dlqRes = await engine.processDeadLetterEvent(dlqPayload);
    assert.strictEqual(dlqRes.status, "DEAD_LETTERED");
    assert.strictEqual(dlqRes.ack, true);

    const docAfter = (await db.collection("projectionOperations").doc(opId).get()).data();
    assert.strictEqual(docAfter.status, "DEAD_LETTERED");

    // Verify stale G3 worker cannot finalize or overwrite DEAD_LETTERED
    const sheetsClient = new FakeGoogleSheetsClientAdapter();
    const staleWorkerEngine = createProjectionEngine({ firestoreDb: db, sheetsClient, clock });
    const staleRes = await staleWorkerEngine.processProjectionEvent(envelope);
    assert.strictEqual(staleRes.outcome, "DEAD_LETTERED");
    assert.strictEqual(sheetsClient.getRows("PROJECTION_LOG").length, 0, "Fenced worker writes 0 rows");
    console.log("  PASS G6-S2-03: DLQ intake fences active worker and transitions operation to DEAD_LETTERED");
  }

  // G6-S2-04: DLQ Terminal State Protection (SUCCEEDED Cannot Be Overwritten)
  {
    const clock = makeClock("2026-10-23T11:00:00.000Z");
    const alertingClient = new FakeAlertingAdapter();
    const engine = createProjectionEngine({ firestoreDb: db, alertingClient, clock });
    const opId = "OP_G6_DLQ_SUCCEEDED_01";
    const envelope = makeSampleEnvelope(opId);

    // Operation already SUCCEEDED
    await db.collection("projectionOperations").doc(opId).set({
      operationId: opId,
      eventId: envelope.eventId,
      status: "SUCCEEDED",
      payloadHash: envelope.payloadHash,
      completedAt: clock.nowTimestamp()
    });

    const dlqPayload = makeSampleCloudEvent(envelope, 5);

    const dlqRes = await engine.processDeadLetterEvent(dlqPayload);
    assert.strictEqual(dlqRes.status, "SUCCEEDED", "Status must remain SUCCEEDED");
    assert.strictEqual(dlqRes.ack, true);

    const finalDoc = (await db.collection("projectionOperations").doc(opId).get()).data();
    assert.strictEqual(finalDoc.status, "SUCCEEDED", "SUCCEEDED operation must never be demoted");
    console.log("  PASS G6-S2-04: SUCCEEDED terminal status protected from demotion by DLQ delivery");
  }

  // G6-S2-05: Sanitized Alerting with Deterministic Idempotency Key
  {
    const clock = makeClock("2026-10-23T11:05:00.000Z");
    const alertingClient = new FakeAlertingAdapter();
    const engine = createProjectionEngine({ firestoreDb: db, alertingClient, clock });
    const opId = "OP_G6_ALERT_01";
    const envelope = makeSampleEnvelope(opId);

    // Initial state: PENDING
    await db.collection("projectionOperations").doc(opId).set({
      operationId: opId,
      eventId: envelope.eventId,
      status: "PENDING",
      payloadHash: envelope.payloadHash,
      createdAt: clock.nowTimestamp()
    });

    const dlqPayload = makeSampleCloudEvent(envelope, 5);

    await engine.processDeadLetterEvent(dlqPayload);
    assert.strictEqual(alertingClient.alerts.length, 1);
    const sentAlert = alertingClient.alerts[0];
    assert.ok(sentAlert.deduplicationKey);
    assert.strictEqual(typeof sentAlert.deduplicationKey, "string");
    // Verify sanitization: alert payload doesn't expose sensitive raw structures
    const alertString = JSON.stringify(sentAlert.payload);
    assert.ok(!alertString.includes("Bearer"), "PII/Tokens must be redacted in alerts");
    console.log("  PASS G6-S2-05: Sanitized alerting emitted with deterministic deduplication key");
  }
}

// ==========================================
// Suite 3: Reconciler Orchestration, Compensation & Pruning
// ==========================================

async function testSuite3_ReconcilerOrchestration(db) {
  console.log("\n--- Suite 3: Reconciler Orchestration, Compensation & Pruning ---");
  await clearEmulatorData();

  // G6-S3-01: Audit Self-Healing Restores Missing Sheet Row from 12-Column Snapshot
  {
    const clock = makeClock("2026-10-23T11:15:00.000Z");
    const sheetsClient = new FakeGoogleSheetsClientAdapter();
    const engine = createProjectionEngine({ firestoreDb: db, sheetsClient, clock });
    const opId = "OP_G6_RECON_01";
    const envelope = makeSampleEnvelope(opId, "HOLD_CREATED", 500);

    // Operation is SUCCEEDED in Firestore with snapshot, but Sheet row is missing
    await db.collection("projectionOperations").doc(opId).set({
      operationId: opId,
      projectionKey: `PROJECTION_${opId}`,
      status: "SUCCEEDED",
      attemptCount: 1,
      payloadHash: envelope.payloadHash,
      projectionSnapshot: {
        reservationNumber: `RES-${opId}`,
        eventType: "HOLD_CREATED",
        storeId: "STORE_NORTH_01",
        productCode: "TL-6060-IVORY",
        quantity: 500,
        pseudonymousActorId: "ACTOR_SALES_01",
        occurredAt: "2026-10-23T10:00:00.000Z",
        payloadHash: envelope.payloadHash
      },
      projectionSnapshotExpiresAt: Timestamp.fromMillis(clock.nowTimestamp().toMillis() + 90 * 86400 * 1000),
      completedAt: clock.nowTimestamp()
    });

    const cycleRes = await engine.runAuditReconciliationCycle({ batchSize: 10 });
    assert.strictEqual(cycleRes.reconciledCount, 1);

    // Verify sheet row restored
    const rows = sheetsClient.getRows("PROJECTION_LOG");
    assert.strictEqual(rows.length, 1);
    const row = rows[0];
    assert.strictEqual(row[0], `PROJECTION_${opId}`);
    assert.strictEqual(row[1], opId);
    assert.strictEqual(row[6], 500);
    assert.strictEqual(row[11], envelope.payloadHash);
    console.log("  PASS G6-S3-01: Audit cycle restores missing sheet row from 12-column snapshot");
  }

  // G6-S3-02: Audit Idempotency on Existing Matching Sheet Row
  {
    const clock = makeClock("2026-10-23T11:20:00.000Z");
    const sheetsClient = new FakeGoogleSheetsClientAdapter();
    const engine = createProjectionEngine({ firestoreDb: db, sheetsClient, clock });
    const opId = "OP_G6_RECON_01";
    const envelope = makeSampleEnvelope(opId, "HOLD_CREATED", 500);

    // Pre-populate matching sheet row
    sheetsClient.appendRow("PROJECTION_LOG", [
      `PROJECTION_${opId}`, opId, `RES-${opId}`, "HOLD_CREATED", "STORE_NORTH_01",
      "TL-6060-IVORY", 500, "ACTOR_SALES_01", "2026-10-23T10:00:00.000Z",
      "2026-10-23T11:20:00.000Z", 1, envelope.payloadHash
    ]);

    const cycleRes = await engine.runAuditReconciliationCycle({ batchSize: 10 });
    assert.strictEqual(cycleRes.details[0].outcome, "MATCH");
    assert.strictEqual(sheetsClient.getRows("PROJECTION_LOG").length, 1, "0 duplicate sheet rows created");
    console.log("  PASS G6-S3-02: Audit cycle verifies matching row with 0 duplicate append");
  }

  // G6-S3-03: Compensating Transaction Writes Negative Offset & Leaves DEAD_LETTERED Untouched
  {
    const clock = makeClock("2026-10-23T11:30:00.000Z");
    const sheetsClient = new FakeGoogleSheetsClientAdapter();
    const engine = createProjectionEngine({ firestoreDb: db, sheetsClient, clock });
    const opId = "OP_G6_COMP_01";
    const envelope = makeSampleEnvelope(opId, "HOLD_CREATED", 100);

    // 1. Initial write
    sheetsClient.appendRow("PROJECTION_LOG", [
      `PROJECTION_${opId}`, opId, `RES-${opId}`, "HOLD_CREATED", "STORE_NORTH_01",
      "TL-6060-IVORY", 100, "ACTOR_SALES_01", "2026-10-23T10:00:00.000Z",
      "2026-10-23T11:20:00.000Z", 1, envelope.payloadHash
    ]);

    // 2. Dead-letter document
    await db.collection("projectionOperations").doc(opId).set({
      operationId: opId,
      status: "DEAD_LETTERED",
      payloadHash: envelope.payloadHash,
      deadLetteredAt: clock.nowTimestamp(),
      deadLetterReason: "MAX_RETRIES_EXCEEDED"
    });

    const reversalData = {
      operationId: `REV_${opId}`,
      originalOperationId: opId,
      reservationNumber: `RES-${opId}`,
      storeId: "STORE_NORTH_01",
      productCode: "TL-6060-IVORY",
      quantity: 100,
      occurredAt: "2026-10-23T11:30:00.000Z",
      pseudonymousActorId: "RECONCILER_01",
      payloadHash: envelope.payloadHash
    };

    const compRes = await engine.executeCompensationReversal(reversalData);
    assert.strictEqual(compRes.outcome, "COMPENSATED");

    // Verify sheet rows: original +100, reversal -100
    const rows = sheetsClient.getRows("PROJECTION_LOG");
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0][6], 100);
    assert.strictEqual(rows[1][6], -100);
    assert.strictEqual(rows[1][3], "FULFILLMENT_REVERSAL");

    // Verify DEAD_LETTERED document has ZERO mutation
    const dlDoc = (await db.collection("projectionOperations").doc(opId).get()).data();
    assert.strictEqual(dlDoc.status, "DEAD_LETTERED");
    assert.strictEqual(dlDoc.deadLetterReason, "MAX_RETRIES_EXCEEDED");
    console.log("  PASS G6-S3-03: Compensating transaction appends negative offset row with zero mutation on DEAD_LETTERED doc");
  }

  // G6-S3-04: Retention Pruning Deletes 90d Snapshots and Tombstones 400d Records
  {
    const clock = makeClock("2026-10-23T12:00:00.000Z");
    const nowMillis = clock.nowTimestamp().toMillis();
    const engine = createProjectionEngine({ firestoreDb: db, clock });

    // Recent op: 10 days old
    await db.collection("projectionOperations").doc("OP_PRUNE_RECENT").set({
      operationId: "OP_PRUNE_RECENT",
      projectionKey: "PROJECTION_OP_PRUNE_RECENT",
      status: "SUCCEEDED",
      payloadHash: computePayloadHash64({ t: 1 }),
      completedAt: Timestamp.fromMillis(nowMillis - 10 * 86400 * 1000),
      projectionSnapshot: { qty: 10 }
    });

    // 95 days old op: snapshot should be deleted
    await db.collection("projectionOperations").doc("OP_PRUNE_95D").set({
      operationId: "OP_PRUNE_95D",
      projectionKey: "PROJECTION_OP_PRUNE_95D",
      status: "SUCCEEDED",
      payloadHash: computePayloadHash64({ t: 2 }),
      completedAt: Timestamp.fromMillis(nowMillis - 95 * 86400 * 1000),
      projectionSnapshot: { qty: 20 },
      projectionSnapshotExpiresAt: Timestamp.fromMillis(nowMillis - 5 * 86400 * 1000)
    });

    // 405 days old op: should be tombstoned
    await db.collection("projectionOperations").doc("OP_PRUNE_405D").set({
      operationId: "OP_PRUNE_405D",
      projectionKey: "PROJECTION_OP_PRUNE_405D",
      status: "SUCCEEDED",
      payloadHash: computePayloadHash64({ t: 3 }),
      completedAt: Timestamp.fromMillis(nowMillis - 405 * 86400 * 1000),
      projectionSnapshot: { qty: 30 }
    });

    const pruneRes = await engine.runRetentionPruning();
    assert.strictEqual(pruneRes.purgedSnapshotCount, 1);
    assert.strictEqual(pruneRes.tombstonedCount, 1);

    const doc95 = (await db.collection("projectionOperations").doc("OP_PRUNE_95D").get()).data();
    assert.strictEqual(doc95.projectionSnapshot, undefined, "95d snapshot must be deleted");
    assert.strictEqual(doc95.status, "SUCCEEDED");

    const doc405 = (await db.collection("projectionOperations").doc("OP_PRUNE_405D").get()).data();
    assert.strictEqual(doc405.status, "TOMBSTONE");
    console.log("  PASS G6-S3-04: Retention pruning deletes 90d snapshots and tombstones 400d records");
  }
}

// ==========================================
// Test Runner
// ==========================================

async function runAll() {
  console.log("=== Starting Stage 42-G6 Packaging Simulation Suite ===");
  const db = getTestFirestore();

  try {
    await clearEmulatorData();
    await testSuite1_E2ELifecycle(db);
    await testSuite2_FailureAndFencing(db);
    await testSuite3_ReconcilerOrchestration(db);
    await clearEmulatorData();

    console.log("\n==================================================");
    console.log("Stage 42-G6 Packaging Simulation Summary:");
    console.log("Total Suites: 3 | All Suites Passed (14 assertions / 14 checks)");
    console.log("==================================================");
    process.exit(0);
  } catch (err) {
    console.error("\n[FAIL] Stage 42-G6 Packaging test failed:", err);
    try {
      await clearEmulatorData();
    } catch (_) {}
    process.exit(1);
  }
}

runAll();
