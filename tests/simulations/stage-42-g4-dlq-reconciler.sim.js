/**
 * Stage 42-G4: DLQ Reconciler & Dead-Letter Handling Simulation Tests
 *
 * Covers:
 * - TC-10: Pub/Sub approximate 5 delivery attempts routes message to DLQ subscription
 * - TC-11: DLQ Reconciler updates projectionOperations to DEAD_LETTERED on actual receipt
 * - G4-U01 ~ G4-U16: Comprehensive unit & integration simulation tests
 */

const assert = require("assert");
const admin = require("firebase-admin");
const http = require("http");
const {
  validateDeadLetterPolicy,
  parseDlqCloudEvent,
  generateAlertIdempotencyKey,
  reconcileDeadLetterDelivery,
  dispatchPendingDeadLetterAlert,
  handleDeadLetterCloudEvent
} = require("../../allocation-assistant/adapters/dlq-reconciler-adapter");
const { FakeAlertingAdapter } = require("../mocks/fake-alerting-adapter");
const {
  createProductionClock,
  createFakeClock,
  computePayloadHash64,
  serializeCanonicalJson
} = require("../../allocation-assistant/contracts/projection-contract");
const { ServerFirestoreClientFactory } = require("../../allocation-assistant/factories/server-firestore-client-factory");

// Firestore Emulator configuration & Fail-Closed Guard
const DEMO_PROJECT_ID = "demo-jy-stage42-g4";

function validateEmulatorHost(rawHost) {
  if (rawHost === undefined || rawHost === null || typeof rawHost !== "string" || rawHost.trim() === "") {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: FIRESTORE_EMULATOR_HOST is missing, empty, or whitespace-only (got: ${rawHost})`);
  }
  const trimmed = rawHost.trim();
  if (/^[a-zA-Z]+:\/\//.test(trimmed)) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: FIRESTORE_EMULATOR_HOST must not contain a URL scheme: ${trimmed}`);
  }
  const match = trimmed.match(/^([^:]+):(\d+)$/);
  if (!match) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: FIRESTORE_EMULATOR_HOST must match <host>:<port>: ${trimmed}`);
  }
  const host = match[1];
  const port = Number(match[2]);
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: Host must be local (127.0.0.1 or localhost), got: ${host}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: Port must be an integer between 1 and 65535, got: ${match[2]}`);
  }
  return trimmed;
}

function validateProjectId(projectId, customEnv = process.env) {
  if (projectId !== DEMO_PROJECT_ID) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: Project ID must be exactly ${DEMO_PROJECT_ID}, got: ${projectId}`);
  }

  function checkProjectEnvVar(varName, val) {
    if (val !== undefined && val !== null) {
      if (typeof val !== "string" || val.trim() === "") {
        throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: ${varName} is set but empty or whitespace-only`);
      }
      if (val.trim() !== DEMO_PROJECT_ID) {
        throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: ${varName} must be ${DEMO_PROJECT_ID}, got: ${val}`);
      }
    }
  }

  checkProjectEnvVar("GCLOUD_PROJECT", customEnv.GCLOUD_PROJECT);
  checkProjectEnvVar("GOOGLE_CLOUD_PROJECT", customEnv.GOOGLE_CLOUD_PROJECT);

  const gcloud = customEnv.GCLOUD_PROJECT !== undefined && customEnv.GCLOUD_PROJECT !== null ? customEnv.GCLOUD_PROJECT.trim() : null;
  const googleCloud = customEnv.GOOGLE_CLOUD_PROJECT !== undefined && customEnv.GOOGLE_CLOUD_PROJECT !== null ? customEnv.GOOGLE_CLOUD_PROJECT.trim() : null;

  if (gcloud && googleCloud && gcloud !== googleCloud) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: Conflicting project environment variables: GCLOUD_PROJECT=${gcloud} vs GOOGLE_CLOUD_PROJECT=${googleCloud}`);
  }

  return projectId;
}

// Module load time validation
validateEmulatorHost(process.env.FIRESTORE_EMULATOR_HOST);
validateProjectId(DEMO_PROJECT_ID);

let testDb = null;

function getTestDb() {
  if (!testDb) {
    testDb = ServerFirestoreClientFactory.createEmulatorAdminClient({
      emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
      projectId: DEMO_PROJECT_ID
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
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Failed to clear emulator data: HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function buildValidTestCloudEvent(options = {}) {
  const operationId = options.operationId || "OP_G4_TEST_001";
  const eventId = options.eventId || "evt_550e8400-e29b-41d4-a716-446655440000";
  const reservationNumber = options.reservationNumber || "RES-20260930-G401";
  const payload = options.payload || { storeId: "STORE_A", productCode: "PROD_B", quantity: 10 };
  const payloadHash = options.payloadHash || computePayloadHash64(payload);

  const envelope = {
    schemaVersion: "1.0.0",
    eventId,
    eventType: options.eventType || "HOLD_CREATED",
    source: "urn:jingyang:sales:allocation-assistant",
    occurredAt: "2026-09-30T08:00:00.000Z",
    traceId: "TRC-G4-9999",
    operationId,
    reservationNumber,
    projectionKey: `PROJECTION_${operationId}`,
    payload,
    payloadHash,
    operator: { pseudonymousActorId: "ACTOR_G4_TEST" }
  };

  const rawBytes = Buffer.from(JSON.stringify(envelope), "utf8");
  const base64Data = rawBytes.toString("base64");

  return {
    specversion: "1.0",
    id: "evt-dlq-cloudevent-001",
    source: "//pubsub.googleapis.com/projects/demo-jy-stage42-g4/topics/jy-reservation-events-dlq",
    type: "google.cloud.pubsub.topic.v1.messagePublished",
    time: "2026-09-30T08:05:00.000Z",
    data: {
      message: {
        messageId: options.messageId || "dlq-msg-123456",
        publishTime: "2026-09-30T08:05:00.000Z",
        attributes: {
          schemaVersion: "1.0.0",
          eventType: envelope.eventType,
          operationId,
          eventId
        },
        data: base64Data
      },
      subscription: "projects/demo-jy-stage42-g4/subscriptions/jy-reservation-events-dlq-sub",
      deliveryAttempt: options.deliveryAttempt !== undefined ? options.deliveryAttempt : 5
    }
  };
}

// ----------------------------------------------------
// Acceptance Tests
// ----------------------------------------------------

async function testDeclarativeDeadLetterPolicyAndParser() {
  // TC-10: maxDeliveryAttempts 5 policy validation and approximate semantic verification
  const validPolicy = { maxDeliveryAttempts: 5 };
  const result = validateDeadLetterPolicy(validPolicy);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.maxAttempts, 5);
  assert.strictEqual(result.approximate, true);

  // Invalid attempts
  assert.throws(() => validateDeadLetterPolicy({ maxDeliveryAttempts: 10 }), /INVALID_DEAD_LETTER_POLICY/);
  assert.throws(() => validateDeadLetterPolicy({ maxDeliveryAttempts: 0 }), /INVALID_DEAD_LETTER_POLICY/);
  assert.throws(() => validateDeadLetterPolicy(null), /INVALID_DEAD_LETTER_POLICY/);

  // Parser test with missing deliveryAttempt -> strictly null, NOT defaulted to 5
  const cloudEventNoAttempt = buildValidTestCloudEvent({ deliveryAttempt: null });
  delete cloudEventNoAttempt.data.deliveryAttempt;
  const parsed = parseDlqCloudEvent(cloudEventNoAttempt);
  assert.strictEqual(parsed.deliveryAttempt, null, "Missing deliveryAttempt must be null");

  // Parser with positive integer -> retained
  const cloudEventWithAttempt = buildValidTestCloudEvent({ deliveryAttempt: 5 });
  const parsedWithAttempt = parseDlqCloudEvent(cloudEventWithAttempt);
  assert.strictEqual(parsedWithAttempt.deliveryAttempt, 5);
}

async function testDlqReconcilerUpdatesDeadLetteredOnActualReceipt() {
  // TC-11: actual valid DLQ receipt transitions RETRYABLE_FAILED to DEAD_LETTERED and dispatches alert
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T09:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_TC11_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440011";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  // Seed initial RETRYABLE_FAILED doc
  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "RETRYABLE_FAILED",
    lastAttemptAt: clock.nowTimestamp(),
    lastErrorCode: "SHEET_UNAVAILABLE_503"
  });

  // Handle dead-letter event
  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);

  assert.strictEqual(outcome.ack, true);
  assert.strictEqual(outcome.action, "DEAD_LETTERED");
  assert.strictEqual(outcome.alertAction, "SENT");

  // Verify Firestore document state
  const updatedDoc = await docRef.get();
  assert.strictEqual(updatedDoc.exists, true);
  const data = updatedDoc.data();
  assert.strictEqual(data.status, "DEAD_LETTERED");
  assert.strictEqual(data.deadLetterReason, "MAX_DELIVERY_ATTEMPTS_EXCEEDED");
  assert.strictEqual(data.deadLetterAlertStatus, "SENT");
  assert.ok(data.deadLetteredAt);
  assert.ok(data.deadLetterAlertSentAt);

  // Verify Alert dispatched
  const alerts = alertingAdapter.getAllAlerts();
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].operationId, operationId);
  assert.strictEqual(alerts[0].severity, "P1");
}

// ----------------------------------------------------
// Unit & Integration Tests (G4-U01 ~ G4-U16)
// ----------------------------------------------------

async function testG4U01_StrictTransportUnpack() {
  // G4-U01: Strict Eventarc CloudEvent validation
  const cloudEvent = buildValidTestCloudEvent({ operationId: "OP_U01" });
  const parsed = parseDlqCloudEvent(cloudEvent);
  assert.strictEqual(parsed.operationId, "OP_U01");
  assert.strictEqual(parsed.schemaVersion, "1.0.0");
  assert.strictEqual(parsed.eventType, "HOLD_CREATED");

  // Invalid CloudEvent type fails closed
  const badTypeEvent = buildValidTestCloudEvent();
  badTypeEvent.type = "com.google.custom.event";
  assert.throws(() => parseDlqCloudEvent(badTypeEvent), /REJECT_POISON_MESSAGE/);
}

async function testG4U02_MalformedBase64FailClosed() {
  // G4-U02: Malformed Base64 payload fails closed with REJECT_POISON_MESSAGE
  const badBase64Event = buildValidTestCloudEvent();
  badBase64Event.data.message.data = "%%%NotBase64%%%";
  assert.throws(() => parseDlqCloudEvent(badBase64Event), /REJECT_POISON_MESSAGE/);
}

async function testG4U03_FatalUtf8Rejection() {
  // G4-U03: Fatal UTF-8 rejects invalid byte sequences like [0xC3, 0x28]
  const badUtf8Bytes = Buffer.from([0xC3, 0x28]);
  const badUtf8Base64 = badUtf8Bytes.toString("base64");
  const badUtf8Event = buildValidTestCloudEvent();
  badUtf8Event.data.message.data = badUtf8Base64;
  assert.throws(() => parseDlqCloudEvent(badUtf8Event), /REJECT_POISON_MESSAGE/);
}

async function testG4U04_MissingDeliveryAttemptPreservesNull() {
  // G4-U04: deliveryAttempt missing preserved as null
  const event = buildValidTestCloudEvent();
  delete event.data.deliveryAttempt;
  const parsed = parseDlqCloudEvent(event);
  assert.strictEqual(parsed.deliveryAttempt, null);
}

async function testG4U05_PendingToDeadLettered() {
  // G4-U05: PENDING -> DEAD_LETTERED
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T10:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_PENDING_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440055";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "PENDING",
    createdAt: clock.nowTimestamp()
  });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "DEAD_LETTERED");
  assert.strictEqual(outcome.ack, true);

  const doc = await docRef.get();
  assert.strictEqual(doc.data().status, "DEAD_LETTERED");
}

async function testG4U06_ProcessingToDeadLetteredFencesWorker() {
  // G4-U06: PROCESSING -> DEAD_LETTERED clears lease, causing active worker to be fenced
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T10:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_PROCESSING_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440066";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "PROCESSING",
    leaseOwner: "worker-stale-instance-1",
    leaseExpiresAt: clock.fromMillis(clock.nowMillis() + 180000),
    claimVersion: 1
  });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "DEAD_LETTERED");

  const doc = await docRef.get();
  const data = doc.data();
  assert.strictEqual(data.status, "DEAD_LETTERED");
  assert.strictEqual(data.leaseOwner, null, "leaseOwner must be cleared");
  assert.strictEqual(data.leaseExpiresAt, null, "leaseExpiresAt must be cleared");
  assert.strictEqual(data.claimVersion, 1, "claimVersion audit value must be preserved");
}

async function testG4U07_SucceededCannotBeDemoted() {
  // G4-U07: SUCCEEDED must NOT be demoted, 0 mutation
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T11:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_SUCCEEDED_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440077";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  const initialSnapshot = { reservationNumber: "RES-TEST-SUCCEEDED", completedAt: clock.nowTimestamp() };
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "SUCCEEDED",
    projectionSnapshot: initialSnapshot,
    completedAt: clock.nowTimestamp()
  });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "IGNORE_SUCCEEDED");
  assert.strictEqual(outcome.ack, true);

  // Confirm document state is untouched
  const doc = await docRef.get();
  assert.strictEqual(doc.data().status, "SUCCEEDED");
  assert.deepStrictEqual(doc.data().projectionSnapshot, initialSnapshot);
}

async function testG4U08_ManualReviewRequiredCannotBeOverwritten() {
  // G4-U08: MANUAL_REVIEW_REQUIRED must NOT be overwritten, 0 mutation
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T11:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_MANUAL_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440088";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "MANUAL_REVIEW_REQUIRED",
    lastErrorCode: "PAYLOAD_HASH_MISMATCH"
  });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "IGNORE_MANUAL_REVIEW");
  assert.strictEqual(outcome.ack, true);

  const doc = await docRef.get();
  assert.strictEqual(doc.data().status, "MANUAL_REVIEW_REQUIRED");
}

async function testG4U09_DuplicateDeadLetterDeliveryIdempotent() {
  // G4-U09: duplicate DEAD_LETTERED delivery: 0 timestamp modification, 0 extra alert
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T12:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_DUP_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440099";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "RETRYABLE_FAILED"
  });

  // First delivery
  const outcome1 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome1.action, "DEAD_LETTERED");
  assert.strictEqual(outcome1.alertAction, "SENT");

  const firstDoc = await docRef.get();
  const firstDeadLetteredAt = firstDoc.data().deadLetteredAt;

  // Advance time
  clock.advanceMillis(60000);

  // Second delivery
  const outcome2 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome2.action, "ALREADY_DEAD_LETTERED");
  assert.strictEqual(outcome2.ack, true);
  assert.strictEqual(outcome2.alertAction, "SKIPPED");

  // Verify deadLetteredAt did NOT change
  const secondDoc = await docRef.get();
  assert.deepStrictEqual(secondDoc.data().deadLetteredAt, firstDeadLetteredAt);
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1, "Only 1 alert should exist");
}

async function testG4U10_OperationNotFoundCreatesNoDocument() {
  // G4-U10: operation not found -> ORPHAN_DLQ_MESSAGE, does NOT create projectionOperations doc
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T12:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_NONEXISTENT_999";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440010";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "ORPHAN_DLQ_MESSAGE");
  assert.strictEqual(outcome.ack, true);

  // Verify doc was NOT created
  const doc = await db.collection("projectionOperations").doc(operationId).get();
  assert.strictEqual(doc.exists, false, "Orphan message must not create doc");
}

async function testG4U11_HashAndEventIdMismatchHandledSafely() {
  // G4-U11: active-state hash mismatch moves to MANUAL_REVIEW_REQUIRED, clears lease
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T13:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_MISMATCH_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440011";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const differentPayload = { storeId: "STORE_DIFF", productCode: "PROD_DIFF", quantity: 50 };
  const differentHash = computePayloadHash64(differentPayload);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: differentHash,
    status: "PROCESSING",
    leaseOwner: "worker-active",
    leaseExpiresAt: clock.fromMillis(clock.nowMillis() + 60000)
  });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(outcome.ack, true);

  const doc = await docRef.get();
  assert.strictEqual(doc.data().status, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(doc.data().leaseOwner, null);
  assert.strictEqual(doc.data().payloadHash, differentHash, "Must not overwrite existing hash");
}

async function testG4U12_ConcurrentDuplicateDeliveriesSingleWinner() {
  // G4-U12: Two concurrent duplicate deliveries have only 1 transaction winner
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T13:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_CONCURRENT_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440012";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: computePayloadHash64({ storeId: "STORE_A", productCode: "PROD_B", quantity: 10 }),
    status: "RETRYABLE_FAILED"
  });

  // Launch two concurrent reconcile deliveries
  const [res1, res2] = await Promise.all([
    handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock),
    handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock)
  ]);

  assert.strictEqual(res1.ack, true);
  assert.strictEqual(res2.ack, true);

  // One must be DEAD_LETTERED, the other must be ALREADY_DEAD_LETTERED
  const actions = [res1.action, res2.action].sort();
  assert.deepStrictEqual(actions, ["ALREADY_DEAD_LETTERED", "DEAD_LETTERED"]);
}

async function testG4U13_AlertSanitizerRemovesPiiAndTokens() {
  // G4-U13: Alert adapter enforces PII removal; throws if forbidden patterns detected
  const alertingAdapter = new FakeAlertingAdapter();

  // Attempting to send alert with email must throw
  await assert.rejects(
    async () => {
      await alertingAdapter.sendAlert({
        idempotencyKey: "1".repeat(64),
        severity: "P1",
        reasonCode: "TEST",
        message: "Error for user test@example.com"
      });
    },
    /SECURITY_ALERT_PII_VIOLATION/
  );

  // Attempting to send alert with Bearer token must throw
  await assert.rejects(
    async () => {
      await alertingAdapter.sendAlert({
        idempotencyKey: "2".repeat(64),
        severity: "P1",
        reasonCode: "TEST",
        message: "Failed with Bearer ya29.12345"
      });
    },
    /SECURITY_ALERT_PII_VIOLATION/
  );
}

async function testG4U14_AlertTransientFailureAllowsRetry() {
  // G4-U14: Transient alert failure keeps alertStatus PENDING, handler returns ack=false
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T14:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_ALERT_FAIL_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440014";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "RETRYABLE_FAILED"
  });

  // Inject failure into alerting adapter
  alertingAdapter.setFailNext(true);

  const outcome1 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome1.ack, false, "Transient alert failure must signal NACK/retry");
  assert.strictEqual(outcome1.alertAction, "RETRY_ALERT");

  // Verify status in Firestore is DEAD_LETTERED with alertStatus PENDING
  const doc1 = await docRef.get();
  assert.strictEqual(doc1.data().status, "DEAD_LETTERED");
  assert.strictEqual(doc1.data().deadLetterAlertStatus, "PENDING");

  // Retry delivery (now adapter succeeds)
  const outcome2 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome2.ack, true);
  assert.strictEqual(outcome2.alertAction, "SENT");

  const doc2 = await docRef.get();
  assert.strictEqual(doc2.data().deadLetterAlertStatus, "SENT");
}

async function testG4U15_FakeAlertingAdapterDeduplicatesByIdempotencyKey() {
  // G4-U15: Fake Alerting Adapter deduplicates by identical idempotencyKey
  const alertingAdapter = new FakeAlertingAdapter();
  const key = "a".repeat(64);

  const res1 = await alertingAdapter.sendAlert({
    idempotencyKey: key,
    severity: "P1",
    reasonCode: "TEST",
    message: "Clean alert 1"
  });
  assert.strictEqual(res1.sent, true);
  assert.strictEqual(res1.dedup, false);

  const res2 = await alertingAdapter.sendAlert({
    idempotencyKey: key,
    severity: "P1",
    reasonCode: "TEST",
    message: "Clean alert 1 duplicate"
  });
  assert.strictEqual(res2.sent, false);
  assert.strictEqual(res2.dedup, true);

  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getCallCount(key), 2);
}

async function testG4U16_EmulatorHostAndProjectEnvFailClosed() {
  // G4-U16: Missing host, non-local host, conflicting project IDs fail closed
  assert.throws(() => validateEmulatorHost(undefined), /FAIL_CLOSED_EMULATOR_GUARD/);
  assert.throws(() => validateEmulatorHost(""), /FAIL_CLOSED_EMULATOR_GUARD/);
  assert.throws(() => validateEmulatorHost("10.0.0.1:8080"), /FAIL_CLOSED_EMULATOR_GUARD/);
  assert.throws(() => validateEmulatorHost("http://127.0.0.1:8080"), /FAIL_CLOSED_EMULATOR_GUARD/);

  // Project env validation
  assert.throws(
    () => validateProjectId(DEMO_PROJECT_ID, { GCLOUD_PROJECT: "prod-project" }),
    /FAIL_CLOSED_EMULATOR_GUARD/
  );
  assert.throws(
    () => validateProjectId(DEMO_PROJECT_ID, { GOOGLE_CLOUD_PROJECT: "prod-project" }),
    /FAIL_CLOSED_EMULATOR_GUARD/
  );
    assert.throws(
    () => validateProjectId(DEMO_PROJECT_ID, { GCLOUD_PROJECT: DEMO_PROJECT_ID, GOOGLE_CLOUD_PROJECT: "conflict" }),
    /FAIL_CLOSED_EMULATOR_GUARD/
  );
}

async function testG4U17_AuthoritativeEventIdMissingMovesToManualReview() {
  // authoritative eventId missing in active state moves to MANUAL_REVIEW_REQUIRED, clears lease
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T14:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_AUTH_NO_EVENT_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440017";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    // eventId missing!
    payloadHash: parsed.payloadHash,
    status: "PROCESSING",
    leaseOwner: "worker-active",
    leaseExpiresAt: clock.fromMillis(clock.nowMillis() + 60000),
    projectionSnapshot: { reservationNumber: "RES-TEST" }
  });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(outcome.ack, true);

  const doc = await docRef.get();
  assert.strictEqual(doc.data().status, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(doc.data().lastErrorCode, "EVENT_ID_MISMATCH");
  assert.strictEqual(doc.data().leaseOwner, null);
  assert.strictEqual(doc.data().leaseExpiresAt, null);
  assert.ok(doc.data().projectionSnapshot, "Must preserve existing snapshot");
}

async function testG4U18_AuthoritativePayloadHashMissingMovesToManualReview() {
  // authoritative payloadHash missing in active state moves to MANUAL_REVIEW_REQUIRED, clears lease
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T15:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_AUTH_NO_HASH_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440018";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    // payloadHash missing!
    status: "PROCESSING",
    leaseOwner: "worker-active",
    leaseExpiresAt: clock.fromMillis(clock.nowMillis() + 60000),
    projectionSnapshot: { reservationNumber: "RES-TEST" }
  });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(outcome.ack, true);

  const doc = await docRef.get();
  assert.strictEqual(doc.data().status, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(doc.data().lastErrorCode, "PAYLOAD_HASH_MISMATCH");
  assert.strictEqual(doc.data().leaseOwner, null);
  assert.strictEqual(doc.data().leaseExpiresAt, null);
}

async function testG4U19_AuthoritativeOperationIdMissingOrMismatchMovesToManualReview() {
  // authoritative operationId missing or mismatch moves to MANUAL_REVIEW_REQUIRED
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T15:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_AUTH_OP_MISMATCH_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440019";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId: "OP_DIFFERENT_INSIDE_DOC",
    eventId,
    payloadHash: parsed.payloadHash,
    status: "PENDING"
  });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(outcome.ack, true);

  const doc = await docRef.get();
  assert.strictEqual(doc.data().status, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(doc.data().lastErrorCode, "OPERATION_ID_MISMATCH");
}

async function testG4U20_UnknownStatusDoesNotBecomeDeadLettered() {
  // unknown status does not become DEAD_LETTERED; 0 business mutation
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T16:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_CORRUPT_STATUS_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440020";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "CORRUPTED_CUSTOM_STATUS",
    customField: "important_data"
  });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "CORRUPT_OR_UNKNOWN_STATUS_REJECTED");
  assert.strictEqual(outcome.status, "CORRUPTED_CUSTOM_STATUS");

  const doc = await docRef.get();
  assert.strictEqual(doc.data().status, "CORRUPTED_CUSTOM_STATUS", "Status must NOT be mutated");
  assert.strictEqual(doc.data().customField, "important_data");
  assert.strictEqual(doc.data().deadLetteredAt, undefined);
}

async function testG4U21_DeadLetteredPayloadHashMismatchIsNotDuplicate() {
  // DEAD_LETTERED with payloadHash mismatch is NOT treated as duplicate; preserves terminal state with 0 mutation
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T16:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_DLQ_HASH_MISMATCH_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440021";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const differentHash = computePayloadHash64({ storeId: "S_DIFF", productCode: "P_DIFF", quantity: 99 });
  const initialDeadLetteredAt = clock.nowTimestamp();

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: differentHash,
    status: "DEAD_LETTERED",
    deadLetteredAt: initialDeadLetteredAt,
    deadLetterAlertStatus: "SENT"
  });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "PRESERVE_TERMINAL_STATE");
  assert.notStrictEqual(outcome.action, "ALREADY_DEAD_LETTERED");
  assert.strictEqual(outcome.ack, true);

  const doc = await docRef.get();
  assert.deepStrictEqual(doc.data().deadLetteredAt, initialDeadLetteredAt, "0 mutation on terminal state");
  assert.strictEqual(doc.data().payloadHash, differentHash);
}

async function testG4U22_NeedAlertWithMissingAlertingClientReturnsNack() {
  // needAlert=true but alertingClient is missing returns NACK (ack: false)
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T17:00:00.000Z"));

  const operationId = "OP_NO_CLIENT_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440022";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "PENDING"
  });

  // Call with alertingClient = null
  const outcome = await handleDeadLetterCloudEvent(db, null, cloudEvent, clock);
  assert.strictEqual(outcome.ack, false, "Must NACK when alertingClient is missing");
  assert.strictEqual(outcome.alertAction, "RETRY_ALERT");
  assert.ok(outcome.error && outcome.error.includes("MISSING_ALERTING_CLIENT"));
}

async function testG4U23_OrphanAlertFailureReturnsNack() {
  // Orphan DLQ message alert failure or missing alertingClient returns NACK
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T17:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_ORPHAN_FAIL_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440023";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  // 1. Missing client -> NACK
  const outcomeNoClient = await handleDeadLetterCloudEvent(db, null, cloudEvent, clock);
  assert.strictEqual(outcomeNoClient.action, "ORPHAN_DLQ_MESSAGE");
  assert.strictEqual(outcomeNoClient.ack, false, "Must NACK orphan when client missing");

  // 2. Client sendAlert throws -> NACK
  alertingAdapter.setFailNext(true);
  const outcomeFailSend = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcomeFailSend.action, "ORPHAN_DLQ_MESSAGE");
  assert.strictEqual(outcomeFailSend.ack, false, "Must NACK orphan when alert send fails");
}

async function testG4U24_AlertErrorTextIsSanitized() {
  // Alert error message does not expose sensitive tokens, email, or secrets
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T18:00:00.000Z"));

  const operationId = "OP_SANITIZE_ERR_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440024";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "PENDING"
  });

  const throwingAdapter = {
    async sendAlert() {
      throw new Error("HTTP 401: Unauthorized access with sk-1234567890abcdef and user john@example.com");
    }
  };

  const outcome = await handleDeadLetterCloudEvent(db, throwingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.ack, false);
  assert.ok(outcome.error, "Error message must exist");
  assert.strictEqual(outcome.error.includes("sk-1234567890abcdef"), false, "Secret token must be sanitized");
  assert.strictEqual(outcome.error.includes("john@example.com"), false, "Email must be sanitized");
}

async function testG4U25_AlertSentButFinalizationTransactionFails() {
  // Alert sent successfully, but SENT-finalization transaction fails:
  // First delivery returns NACK (ack: false);
  // Redelivery deduplicates alert via idempotencyKey and successfully finalizes to SENT.
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T18:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_FINALIZATION_FAIL_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440025";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "RETRYABLE_FAILED"
  });

  // Reconcile delivery directly to obtain claimContext
  const claimContext = await reconcileDeadLetterDelivery(db, parsed, clock);
  assert.strictEqual(claimContext.action, "DEAD_LETTERED");
  assert.strictEqual(claimContext.needAlert, true);

  // Create a mocking DB whose runTransaction fails on finalization
  let runTransactionCount = 0;
  const failingDb = {
    collection: db.collection.bind(db),
    runTransaction: async (cb) => {
      runTransactionCount++;
      throw new Error("FIRESTORE_CONTENTION_ERROR: Transaction aborted on finalization");
    }
  };

  const firstDispatch = await dispatchPendingDeadLetterAlert(failingDb, alertingAdapter, claimContext, clock);
  assert.strictEqual(firstDispatch.sent, true, "Alert was actually sent to adapter");
  assert.strictEqual(firstDispatch.ack, false, "Must NACK when finalization fails");
  assert.strictEqual(firstDispatch.alertAction, "FINALIZATION_FAILED");

  // Verify status in DB is still PENDING because finalization transaction failed
  const docAfterFail = await docRef.get();
  assert.strictEqual(docAfterFail.data().deadLetterAlertStatus, "PENDING");

  // Second delivery (redelivery using normal db)
  const redeliveryOutcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(redeliveryOutcome.ack, true);
  assert.strictEqual(redeliveryOutcome.alertAction, "SENT");

  // Verify doc is now finalized to SENT
  const finalizedDoc = await docRef.get();
  assert.strictEqual(finalizedDoc.data().deadLetterAlertStatus, "SENT");
  assert.ok(finalizedDoc.data().deadLetterAlertSentAt);

  // Verify alert adapter was deduplicated (sent=1, total calls=2)
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getCallCount(claimContext.idempotencyKey), 2);
}

async function testG4U26_TrueWorkerFencingRejectsStaleG3Finalize() {
  // True worker fencing:
  // 1. Create a PROCESSING claim for a worker
  // 2. DLQ Reconciler processes dead-letter delivery -> transitions to DEAD_LETTERED and clears lease
  // 3. Stale worker tries to invoke G3 finalizeProjectionSuccess -> rejected!
  // 4. DEAD_LETTERED status remains completely unchanged!
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T19:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const { finalizeProjectionSuccess } = require("../../allocation-assistant/services/projection-worker-service");

  const operationId = "OP_TRUE_FENCING_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440026";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const staleWorkerId = "worker-slow-node-01";
  const docRef = db.collection("projectionOperations").doc(operationId);

  // Step 1: Initial claim in PROCESSING state
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "PROCESSING",
    claimVersion: 1,
    leaseOwner: staleWorkerId,
    leaseExpiresAt: clock.fromMillis(clock.nowMillis() + 180000), // unexpired
    projectionSnapshot: { reservationNumber: "RES-TEST-FENCING" }
  });

  // Step 2: DLQ arrives and reconciles to DEAD_LETTERED
  const dlqOutcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(dlqOutcome.action, "DEAD_LETTERED");
  assert.strictEqual(dlqOutcome.ack, true);

  const docDeadLettered = await docRef.get();
  assert.strictEqual(docDeadLettered.data().status, "DEAD_LETTERED");
  assert.strictEqual(docDeadLettered.data().leaseOwner, null);
  assert.strictEqual(docDeadLettered.data().leaseExpiresAt, null);

  // Step 3: Stale worker attempts to finalize using G3 finalizeProjectionSuccess
  await assert.rejects(
    async () => {
      await finalizeProjectionSuccess(db, operationId, 1, staleWorkerId, clock);
    },
    /STATUS_NOT_PROCESSING/
  );

  // Step 4: Confirm DEAD_LETTERED remains untouched
  const finalDoc = await docRef.get();
  assert.strictEqual(finalDoc.data().status, "DEAD_LETTERED");
  assert.strictEqual(finalDoc.data().completedAt, undefined);
}

async function testG4U27_SucceededIdentityMismatchPreservesDocAndSendsAlert() {
  // SUCCEEDED identity mismatch:
  // - returns PRESERVE_TERMINAL_STATE
  // - original document remains byte-for-byte equivalent (0 mutation)
  // - one sanitized alert is sent
  // - repeated delivery is externally deduplicated
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T19:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_SUCC_MISMATCH_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440027";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const differentHash = computePayloadHash64({ storeId: "S_DIFF", productCode: "P_DIFF", quantity: 88 });
  const completedAt = clock.nowTimestamp();
  const initialSnapshot = { reservationNumber: "RES-TEST-SUCC", storeId: "S_DIFF", quantity: 88 };

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId: "evt_different_original_event_001",
    payloadHash: differentHash,
    status: "SUCCEEDED",
    completedAt,
    projectionSnapshot: initialSnapshot
  });

  const docBefore = await docRef.get();
  const rawBefore = JSON.stringify(docBefore.data());

  // First delivery
  const outcome1 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome1.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome1.ack, true);
  assert.strictEqual(outcome1.alertAction, "SENT");

  const docAfter1 = await docRef.get();
  const rawAfter1 = JSON.stringify(docAfter1.data());
  assert.strictEqual(rawAfter1, rawBefore, "Document must remain byte-for-byte identical (0 mutation)");

  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getAllAlerts()[0].reasonCode, "TERMINAL_STATE_IDENTITY_MISMATCH");

  // Second delivery (redelivery)
  const outcome2 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome2.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome2.ack, true);
  assert.strictEqual(outcome2.alertAction, "SENT");

  const docAfter2 = await docRef.get();
  assert.strictEqual(JSON.stringify(docAfter2.data()), rawBefore);
  // Verify deduplication: adapter still has exactly 1 alert, but 2 calls recorded
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
}

async function testG4U28_ManualReviewIdentityMismatchPreservesDocAndSendsAlert() {
  // MANUAL_REVIEW_REQUIRED identity mismatch:
  // - returns PRESERVE_TERMINAL_STATE
  // - 0 mutation
  // - alert sent and deduplicated
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T20:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_MANUAL_MISMATCH_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440028";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId: "evt_original_event_man_001",
    payloadHash: "0".repeat(64),
    status: "MANUAL_REVIEW_REQUIRED",
    lastErrorCode: "ORIGINAL_ERROR"
  });

  const docBefore = await docRef.get();
  const rawBefore = JSON.stringify(docBefore.data());

  const outcome1 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome1.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome1.ack, true);
  assert.strictEqual(outcome1.alertAction, "SENT");

  const docAfter1 = await docRef.get();
  assert.strictEqual(JSON.stringify(docAfter1.data()), rawBefore, "0 mutation on MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getAllAlerts()[0].reasonCode, "TERMINAL_STATE_IDENTITY_MISMATCH");

  // Redelivery
  const outcome2 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome2.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome2.ack, true);
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
}

async function testG4U29_ActiveIdentityMismatchSendsAlertWithDeterministicKey() {
  // Active identity mismatch transitions to MANUAL_REVIEW_REQUIRED and sends alert with deterministic key
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T20:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_ACTIVE_MISMATCH_ALERT_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440029";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const differentHash = computePayloadHash64({ storeId: "S_DIFF", productCode: "P_DIFF", quantity: 99 });

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: differentHash,
    status: "PROCESSING",
    leaseOwner: "worker-active"
  });

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(outcome.ack, true);
  assert.strictEqual(outcome.alertAction, "SENT");

  const doc = await docRef.get();
  assert.strictEqual(doc.data().status, "MANUAL_REVIEW_REQUIRED");

  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  const sentAlert = alertingAdapter.getAllAlerts()[0];
  assert.strictEqual(sentAlert.reasonCode, "PAYLOAD_HASH_MISMATCH");
  const expectedKey = generateAlertIdempotencyKey(operationId, eventId, "PAYLOAD_HASH_MISMATCH");
  assert.strictEqual(sentAlert.idempotencyKey, expectedKey);
}

async function testG4U30_UnknownStatusSendsAlertAndNacksOnAlertFailure() {
  // Unknown status has 0 mutation, alert is sent, and alert failure returns NACK
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T21:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_UNKNOWN_STATUS_ALERT_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440030";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "WEIRD_CORRUPT_STATUS"
  });

  const rawBefore = JSON.stringify((await docRef.get()).data());

  // 1. Alert failure -> NACK
  alertingAdapter.setFailNext(true);
  const outcomeFail = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcomeFail.ack, false);
  assert.strictEqual(outcomeFail.alertAction, "RETRY_ALERT");
  assert.strictEqual(JSON.stringify((await docRef.get()).data()), rawBefore, "0 mutation on corrupt doc");

  // 2. Alert success -> ACK
  const outcomeSuccess = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcomeSuccess.ack, true);
  assert.strictEqual(outcomeSuccess.alertAction, "SENT");
  assert.strictEqual(JSON.stringify((await docRef.get()).data()), rawBefore, "0 mutation on corrupt doc");
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getAllAlerts()[0].reasonCode, "UNKNOWN_OR_CORRUPT_STATUS");
}

async function testG4U31_DeadLetteredIdentityMismatchSendsAlertAndNeverAlreadyDeadLettered() {
  // DEAD_LETTERED identity mismatch: 0 mutation, alert is sent, never classified as ALREADY_DEAD_LETTERED
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T21:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_DLQ_MISMATCH_ALERT_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440031";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const differentHash = computePayloadHash64({ storeId: "S_DIFF", productCode: "P_DIFF", quantity: 77 });
  const initialDeadLetteredAt = clock.nowTimestamp();

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId: "evt_original_dlq_001",
    payloadHash: differentHash,
    status: "DEAD_LETTERED",
    deadLetteredAt: initialDeadLetteredAt,
    deadLetterAlertStatus: "SENT"
  });

  const rawBefore = JSON.stringify((await docRef.get()).data());

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "PRESERVE_TERMINAL_STATE");
  assert.notStrictEqual(outcome.action, "ALREADY_DEAD_LETTERED");
  assert.strictEqual(outcome.ack, true);
  assert.strictEqual(outcome.alertAction, "SENT");

  assert.strictEqual(JSON.stringify((await docRef.get()).data()), rawBefore, "0 mutation on DEAD_LETTERED doc");
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getAllAlerts()[0].reasonCode, "TERMINAL_STATE_IDENTITY_MISMATCH");
}

async function testG4U32_SyntheticClaimWithMissingIdempotencyKeyFailsClosed() {
  // Synthetic claim with needAlert=true but missing idempotencyKey:
  // no alert is silently skipped, returns ack=false and alertAction=RETRY_ALERT
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T22:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const badClaimContext = {
    action: "SYNTHETIC_ANOMALY",
    ack: true,
    operationId: "OP_BAD_CLAIM_001",
    eventId: "evt_550e8400-e29b-41d4-a716-446655440032",
    needAlert: true
    // idempotencyKey omitted!
  };

  const dispatchResult = await dispatchPendingDeadLetterAlert(db, alertingAdapter, badClaimContext, clock);
  assert.strictEqual(dispatchResult.sent, false);
  assert.strictEqual(dispatchResult.ack, false, "Must return ack: false fail-closed");
  assert.strictEqual(dispatchResult.alertAction, "RETRY_ALERT");
  assert.ok(dispatchResult.error && dispatchResult.error.includes("MISSING_ALERT_IDEMPOTENCY_KEY"));
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 0);
}

async function testG4U33_DeadLetteredIdentityMismatchWithSameKeyDoesNotRunFinalizationTransaction() {
  // Doc is DEAD_LETTERED, identity mismatch, deadLetterAlertStatus="PENDING".
  // Doc's existing key deliberately equals the anomaly alert key.
  // After alert is dispatched, doc must remain completely untouched (0 mutation)
  // and no finalization transaction executed.
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T22:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_DLQ_NO_FINALIZE_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440033";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const anomalyKey = generateAlertIdempotencyKey(operationId, eventId, "TERMINAL_STATE_IDENTITY_MISMATCH");
  const differentHash = computePayloadHash64({ storeId: "S_DIFF", productCode: "P_DIFF", quantity: 123 });
  const initialDeadLetteredAt = clock.nowTimestamp();

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId: "evt_original_event_001",
    payloadHash: differentHash,
    status: "DEAD_LETTERED",
    deadLetteredAt: initialDeadLetteredAt,
    deadLetterAlertStatus: "PENDING",
    deadLetterAlertIdempotencyKey: anomalyKey
  });

  const rawBefore = JSON.stringify((await docRef.get()).data());

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome.ack, true);
  assert.strictEqual(outcome.alertAction, "SENT");

  // Document must remain byte-for-byte identical (deadLetterAlertStatus must still be PENDING!)
  const docAfter = await docRef.get();
  assert.strictEqual(docAfter.data().deadLetterAlertStatus, "PENDING", "Must NOT execute finalization transaction on anomaly alert!");
  assert.strictEqual(docAfter.data().deadLetterAlertSentAt, undefined);
  assert.strictEqual(JSON.stringify(docAfter.data()), rawBefore, "0 mutation on protected doc");

  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getAllAlerts()[0].idempotencyKey, anomalyKey);
}

async function testG4U34_DeadLetteredPendingMissingOrInvalidStoredKeyFailsClosed() {
  // Doc in DEAD_LETTERED with deadLetterAlertStatus="PENDING" but missing or invalid stored key:
  // fails closed, ack=false, 0 mutation, does not claim SENT, does not send alert.
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T23:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_CORRUPT_KEY_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440034";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });
  const parsed = parseDlqCloudEvent(cloudEvent);

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: parsed.payloadHash,
    status: "DEAD_LETTERED",
    deadLetteredAt: clock.nowTimestamp(),
    deadLetterAlertStatus: "PENDING"
    // deadLetterAlertIdempotencyKey intentionally MISSING!
  });

  const rawBefore = JSON.stringify((await docRef.get()).data());

  const outcome = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome.ack, false, "Must fail closed with ack=false");
  assert.strictEqual(outcome.action, "RETRY_ALERT_PENDING_CORRUPTED");
  assert.strictEqual(outcome.reasonCode, "CORRUPTED_ALERT_IDEMPOTENCY_KEY");
  assert.strictEqual(outcome.alertAction, "SKIPPED");
  assert.ok(outcome.error && outcome.error.includes("CORRUPTED_ALERT_IDEMPOTENCY_KEY"));

  // Doc remains untouched
  const docAfter = await docRef.get();
  assert.strictEqual(JSON.stringify(docAfter.data()), rawBefore);
  assert.strictEqual(docAfter.data().deadLetterAlertStatus, "PENDING");
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 0, "No alert sent when stored key corrupted");
}

async function testG4U35_ActiveMismatchRedeliveryReusesAlertKeyAndDedups() {
  // Active identity mismatch transitions to MANUAL_REVIEW_REQUIRED.
  // Subsequent redelivery reuses the same reasonCode and idempotencyKey.
  // External alert adapter deduplicates; doc is not mutated on redelivery.
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-09-30T23:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_ACTIVE_REDELIVERY_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440035";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const differentHash = computePayloadHash64({ storeId: "S_DIFF", productCode: "P_DIFF", quantity: 55 });

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: differentHash,
    status: "PROCESSING",
    leaseOwner: "worker-active-1"
  });

  // Delivery 1
  const outcome1 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome1.action, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(outcome1.ack, true);
  assert.strictEqual(outcome1.alertAction, "SENT");
  assert.strictEqual(outcome1.reasonCode, "PAYLOAD_HASH_MISMATCH");

  const docAfterFirst = await docRef.get();
  const rawAfterFirst = JSON.stringify(docAfterFirst.data());
  assert.strictEqual(docAfterFirst.data().status, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(docAfterFirst.data().anomalyAlertReasonCode, "PAYLOAD_HASH_MISMATCH");
  assert.strictEqual(docAfterFirst.data().anomalyAlertPayloadHash, parseDlqCloudEvent(cloudEvent).payloadHash);
  assert.strictEqual(docAfterFirst.data().payloadHash, differentHash, "Authoritative payloadHash must NOT be overwritten");
  assert.ok(docAfterFirst.data().anomalyAlertIdempotencyKey);

  const expectedKey = generateAlertIdempotencyKey(operationId, eventId, "PAYLOAD_HASH_MISMATCH");
  assert.strictEqual(docAfterFirst.data().anomalyAlertIdempotencyKey, expectedKey);

  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getAllAlerts()[0].idempotencyKey, expectedKey);

  // Delivery 2 (redelivery of same DLQ message)
  clock.advanceMillis(60000);
  const outcome2 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome2.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome2.ack, true);
  assert.strictEqual(outcome2.alertAction, "SENT");
  assert.strictEqual(outcome2.reasonCode, "PAYLOAD_HASH_MISMATCH");

  // Verify external alert adapter deduplicated: still 1 alert recorded, 2 calls
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getCallCount(expectedKey), 2);

  // Verify doc was NOT mutated again during redelivery
  const docAfterSecond = await docRef.get();
  assert.strictEqual(JSON.stringify(docAfterSecond.data()), rawAfterFirst, "0 mutation on redelivery to terminal doc");
}

async function testG4U36_ActiveMismatchFirstAlertFailsRedeliveryReusesKeyAndSucceeds() {
  // First delivery: active mismatch transitions to MANUAL_REVIEW_REQUIRED, but alert fails transiently (NACK).
  // Redelivery: reuses same key and succeeds (ACK).
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-10-01T00:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_ACTIVE_RETRY_ALERT_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440036";
  const cloudEvent = buildValidTestCloudEvent({ operationId, eventId });

  const differentHash = computePayloadHash64({ storeId: "S_DIFF", productCode: "P_DIFF", quantity: 66 });

  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: differentHash,
    status: "PROCESSING",
    leaseOwner: "worker-active-2"
  });

  // Inject failure on first alert
  alertingAdapter.setFailNext(true);

  // Delivery 1 (fails alert)
  const outcome1 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome1.ack, false, "Must NACK when alert dispatch fails");
  assert.strictEqual(outcome1.alertAction, "RETRY_ALERT");

  const docAfterFirst = await docRef.get();
  const rawAfterFirst = JSON.stringify(docAfterFirst.data());
  assert.strictEqual(docAfterFirst.data().status, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 0);

  const expectedKey = generateAlertIdempotencyKey(operationId, eventId, "PAYLOAD_HASH_MISMATCH");
  assert.strictEqual(docAfterFirst.data().anomalyAlertIdempotencyKey, expectedKey);

  // Delivery 2 (redelivery succeeds)
  clock.advanceMillis(30000);
  const outcome2 = await handleDeadLetterCloudEvent(db, alertingAdapter, cloudEvent, clock);
  assert.strictEqual(outcome2.ack, true);
  assert.strictEqual(outcome2.alertAction, "SENT");
  assert.strictEqual(outcome2.reasonCode, "PAYLOAD_HASH_MISMATCH");

  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getAllAlerts()[0].idempotencyKey, expectedKey);

  // Verify doc was NOT mutated again on redelivery
  const docAfterSecond = await docRef.get();
  assert.strictEqual(JSON.stringify(docAfterSecond.data()), rawAfterFirst);
}

async function testG4U37_AlertMessageAccuratelyReflectsRealState() {
  // Alert message accurately reflects real state:
  // - DEAD_LETTERED -> "[DLQ_P1_ALERT] Operation ... reached DEAD_LETTERED state"
  // - SUCCEEDED mismatch -> "[DLQ_ANOMALY_ALERT] Operation ... terminal state identity mismatch preserved (SUCCEEDED)"
  // - Active mismatch -> "[DLQ_ANOMALY_ALERT] Operation ... identity mismatch transitioned to MANUAL_REVIEW_REQUIRED (...)"
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-10-01T00:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  // Case 1: Normal transition to DEAD_LETTERED
  const op1 = "OP_MSG_NORMAL_001";
  const evt1 = "evt_550e8400-e29b-41d4-a716-446655440091";
  const ce1 = buildValidTestCloudEvent({ operationId: op1, eventId: evt1 });
  const doc1 = db.collection("projectionOperations").doc(op1);
  await doc1.set({
    operationId: op1,
    eventId: evt1,
    payloadHash: parseDlqCloudEvent(ce1).payloadHash,
    status: "RETRYABLE_FAILED"
  });
  await handleDeadLetterCloudEvent(db, alertingAdapter, ce1, clock);

  const alert1 = alertingAdapter.getAllAlerts().find((a) => a.operationId === op1);
  assert.ok(alert1.message.includes("reached DEAD_LETTERED state"), "Normal DLQ alert must mention DEAD_LETTERED state");

  // Case 2: SUCCEEDED mismatch anomaly
  const op2 = "OP_MSG_SUCC_001";
  const evt2 = "evt_550e8400-e29b-41d4-a716-446655440092";
  const ce2 = buildValidTestCloudEvent({ operationId: op2, eventId: evt2 });
  const doc2 = db.collection("projectionOperations").doc(op2);
  await doc2.set({
    operationId: op2,
    eventId: "evt_550e8400-e29b-41d4-a716-446655440090",
    payloadHash: "f".repeat(64),
    status: "SUCCEEDED"
  });
  await handleDeadLetterCloudEvent(db, alertingAdapter, ce2, clock);

  const alert2 = alertingAdapter.getAllAlerts().find((a) => a.operationId === op2);
  assert.ok(!alert2.message.includes("reached DEAD_LETTERED state"), "SUCCEEDED anomaly alert must NOT claim reached DEAD_LETTERED");
  assert.ok(alert2.message.includes("terminal state identity mismatch preserved (SUCCEEDED)"));

  // Case 3: Active mismatch
  const op3 = "OP_MSG_ACTIVE_001";
  const evt3 = "evt_550e8400-e29b-41d4-a716-446655440093";
  const ce3 = buildValidTestCloudEvent({ operationId: op3, eventId: evt3 });
  const doc3 = db.collection("projectionOperations").doc(op3);
  await doc3.set({
    operationId: op3,
    eventId: evt3,
    payloadHash: "e".repeat(64),
    status: "PROCESSING"
  });
  await handleDeadLetterCloudEvent(db, alertingAdapter, ce3, clock);

  const alert3 = alertingAdapter.getAllAlerts().find((a) => a.operationId === op3);
  assert.ok(!alert3.message.includes("reached DEAD_LETTERED state"), "Active mismatch alert must NOT claim reached DEAD_LETTERED");
  assert.ok(alert3.message.includes("MANUAL_REVIEW_REQUIRED"));
}

async function testG4U38_FinalizationTransactionExplicitBranchesAndNoPendingWithSent() {
  // Verifies the finalization transaction explicit branches:
  // 1. Success transition: PENDING -> SENT with matching key. Document is SENT, never PENDING.
  // 2. Idempotent success: Already SENT with same key returns ack: true, alertAction: "SENT".
  // 3. Document does not exist: fails closed with ack: false, alertAction: "FINALIZATION_FAILED".
  // 4. Stored key mismatch: fails closed with ack: false, alertAction: "FINALIZATION_FAILED", doc untouched.
  // 5. Invalid/corrupted alert status: fails closed with ack: false, alertAction: "FINALIZATION_FAILED".
  // 6. Explicit check: ack=true / SENT is NEVER paired with a document remaining PENDING.
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-10-01T01:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  // Branch 1: Normal PENDING -> SENT transition
  const op1 = "OP_FINALIZE_NORMAL_001";
  const evt1 = "evt_550e8400-e29b-41d4-a716-446655440081";
  const key1 = generateAlertIdempotencyKey(op1, evt1, "MAX_DELIVERY_ATTEMPTS_EXCEEDED");
  const docRef1 = db.collection("projectionOperations").doc(op1);
  await docRef1.set({
    operationId: op1,
    eventId: evt1,
    payloadHash: "a".repeat(64),
    status: "DEAD_LETTERED",
    deadLetterAlertStatus: "PENDING",
    deadLetterAlertIdempotencyKey: key1
  });

  const claim1 = {
    action: "DEAD_LETTERED",
    ack: true,
    operationId: op1,
    eventId: evt1,
    status: "DEAD_LETTERED",
    needAlert: true,
    idempotencyKey: key1
  };
  const res1 = await dispatchPendingDeadLetterAlert(db, alertingAdapter, claim1, clock);
  assert.strictEqual(res1.ack, true);
  assert.strictEqual(res1.alertAction, "SENT");
  const docAfter1 = await docRef1.get();
  assert.strictEqual(docAfter1.data().deadLetterAlertStatus, "SENT", "Doc must be updated to SENT, NEVER remain PENDING on ack=true/SENT");
  assert.ok(docAfter1.data().deadLetterAlertSentAt);

  // Branch 2: Idempotent success when already SENT with same key
  const res2 = await dispatchPendingDeadLetterAlert(db, alertingAdapter, claim1, clock);
  assert.strictEqual(res2.ack, true);
  assert.strictEqual(res2.alertAction, "SENT");
  const docAfter2 = await docRef1.get();
  assert.strictEqual(docAfter2.data().deadLetterAlertStatus, "SENT");

  // Branch 3: Document does not exist fails closed
  const claimNonexistent = {
    action: "DEAD_LETTERED",
    ack: true,
    operationId: "OP_NONEXISTENT_FINALIZE",
    eventId: "evt_550e8400-e29b-41d4-a716-446655440082",
    needAlert: true,
    idempotencyKey: "c".repeat(64)
  };
  const res3 = await dispatchPendingDeadLetterAlert(db, alertingAdapter, claimNonexistent, clock);
  assert.strictEqual(res3.ack, false, "Must NACK when doc does not exist");
  assert.strictEqual(res3.alertAction, "FINALIZATION_FAILED");
  assert.ok(res3.error && res3.error.includes("OPERATION_NOT_FOUND"));

  // Branch 4: Key mismatch fails closed and does not touch doc
  const op4 = "OP_FINALIZE_KEY_MISMATCH_001";
  const evt4 = "evt_550e8400-e29b-41d4-a716-446655440083";
  const docRef4 = db.collection("projectionOperations").doc(op4);
  const storedKey4 = "d".repeat(64);
  const incomingKey4 = "e".repeat(64);
  await docRef4.set({
    operationId: op4,
    eventId: evt4,
    payloadHash: "a".repeat(64),
    status: "DEAD_LETTERED",
    deadLetterAlertStatus: "PENDING",
    deadLetterAlertIdempotencyKey: storedKey4
  });

  const claim4 = {
    action: "DEAD_LETTERED",
    ack: true,
    operationId: op4,
    eventId: evt4,
    status: "DEAD_LETTERED",
    needAlert: true,
    idempotencyKey: incomingKey4
  };
  const res4 = await dispatchPendingDeadLetterAlert(db, alertingAdapter, claim4, clock);
  assert.strictEqual(res4.ack, false, "Must NACK on key mismatch");
  assert.strictEqual(res4.alertAction, "FINALIZATION_FAILED");
  assert.ok(res4.error && res4.error.includes("ALERT_IDEMPOTENCY_KEY_MISMATCH"));
  const docAfter4 = await docRef4.get();
  assert.strictEqual(docAfter4.data().deadLetterAlertStatus, "PENDING", "Must NOT mutate doc on key mismatch");

  // Branch 5: Corrupt alert status in doc fails closed
  const op5 = "OP_FINALIZE_CORRUPT_STATUS_001";
  const evt5 = "evt_550e8400-e29b-41d4-a716-446655440084";
  const key5 = "f".repeat(64);
  const docRef5 = db.collection("projectionOperations").doc(op5);
  await docRef5.set({
    operationId: op5,
    eventId: evt5,
    payloadHash: "a".repeat(64),
    status: "DEAD_LETTERED",
    deadLetterAlertStatus: "CORRUPTED_STATUS_VALUE",
    deadLetterAlertIdempotencyKey: key5
  });

  const claim5 = {
    action: "DEAD_LETTERED",
    ack: true,
    operationId: op5,
    eventId: evt5,
    status: "DEAD_LETTERED",
    needAlert: true,
    idempotencyKey: key5
  };
  const res5 = await dispatchPendingDeadLetterAlert(db, alertingAdapter, claim5, clock);
  assert.strictEqual(res5.ack, false, "Must NACK on invalid alert status in doc");
  assert.strictEqual(res5.alertAction, "FINALIZATION_FAILED");
  assert.ok(res5.error && res5.error.includes("INVALID_ALERT_STATUS_FOR_FINALIZATION"));
}

async function testG4U39_DifferentAnomalyOnManualReviewDoesNotMisidentifyAsDuplicate() {
  // If a document was transitioned to MANUAL_REVIEW_REQUIRED due to active mismatch A,
  // and subsequently a DIFFERENT message / event arrives for that document:
  // - It must NOT misidentify as duplicate or reuse mismatch A's key.
  // - It must generate a new alert key with TERMINAL_STATE_IDENTITY_MISMATCH.
  // - Document remains 0 mutation.
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-10-01T01:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_DIFF_ANOMALY_001";
  const event1 = "evt_550e8400-e29b-41d4-a716-446655440095";
  const event2 = "evt_550e8400-e29b-41d4-a716-446655440096";

  const initialKey1 = generateAlertIdempotencyKey(operationId, event1, "PAYLOAD_HASH_MISMATCH");
  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId: "evt_original_base_001",
    payloadHash: "1".repeat(64),
    status: "MANUAL_REVIEW_REQUIRED",
    lastErrorCode: "PAYLOAD_HASH_MISMATCH",
    anomalyAlertEventId: event1,
    anomalyAlertReasonCode: "PAYLOAD_HASH_MISMATCH",
    anomalyAlertIdempotencyKey: initialKey1
  });

  const rawBefore = JSON.stringify((await docRef.get()).data());

  // A different event (event2) arrives with mismatch
  const ce2 = buildValidTestCloudEvent({
    operationId,
    eventId: event2,
    payload: { storeId: "STORE_DIFF2", productCode: "PROD_DIFF2", quantity: 77 }
  });
  const outcome2 = await handleDeadLetterCloudEvent(db, alertingAdapter, ce2, clock);

  assert.strictEqual(outcome2.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome2.ack, true);
  assert.strictEqual(outcome2.alertAction, "SENT");
  assert.strictEqual(outcome2.reasonCode, "TERMINAL_STATE_IDENTITY_MISMATCH", "Must NOT reuse event1's PAYLOAD_HASH_MISMATCH");

  const expectedKey2 = generateAlertIdempotencyKey(operationId, event2, "TERMINAL_STATE_IDENTITY_MISMATCH");
  assert.notStrictEqual(outcome2.idempotencyKey, initialKey1, "Must NOT reuse original event1 key");
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getAllAlerts()[0].idempotencyKey, expectedKey2);

  // Document remains untouched (0 mutation)
  const docAfter = await docRef.get();
  assert.strictEqual(JSON.stringify(docAfter.data()), rawBefore, "0 mutation on terminal doc");
}

async function testG4U40_AnomalyPayloadIdentityDeduplicationAndConflictSeparation() {
  // Verifies the complete payload identity contract on MANUAL_REVIEW_REQUIRED:
  // 1. Initial delivery (msg1 with payload1): Active mismatch moves doc to MANUAL_REVIEW_REQUIRED,
  //    persisting anomalyAlertPayloadHash alongside eventId, reasonCode, and alert key. Alert count: 1.
  // 2. Redelivery of msg1 (same eventId, same payloadHash): confirmed as same anomaly redelivery,
  //    reuses original alert key. External alert adapter deduplicates; alert count remains 1. Doc 0 mutation.
  // 3. msg2 (same eventId, different payload2): detected as content conflict (not confirmed same anomaly),
  //    dispatches independent conflict alert with deterministic key incorporating payload2's hash. Alert count: 2. Doc 0 mutation.
  // 4. Redelivery of msg2 (same eventId, same payload2): reuses msg2's conflict key,
  //    external alert adapter deduplicates; alert count remains 2 (no 3rd alert). Doc 0 mutation.
  // 5. msg3 (different eventId): correctly distinguished, dispatches terminal mismatch alert. Alert count: 3. Doc 0 mutation.
  // 6. Terminal document remains byte-for-byte identical across deliveries 2 through 5.
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-10-01T02:00:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_PAYLOAD_IDENTITY_001";
  const eventId1 = "evt_550e8400-e29b-41d4-a716-446655440040";
  const eventId2 = "evt_550e8400-e29b-41d4-a716-446655440041";

  const authoritativeHash = computePayloadHash64({ storeId: "S_AUTH", productCode: "P_AUTH", quantity: 10 });
  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId: eventId1,
    payloadHash: authoritativeHash,
    status: "PROCESSING",
    leaseOwner: "worker-active-40"
  });

  // --- Step 1: Initial delivery of msg1 (payload1) ---
  const payload1 = { storeId: "S_VAR1", productCode: "P_VAR1", quantity: 20 };
  const ce1 = buildValidTestCloudEvent({ operationId, eventId: eventId1, payload: payload1 });
  const hash1 = parseDlqCloudEvent(ce1).payloadHash;
  assert.notStrictEqual(hash1, authoritativeHash);

  const outcome1 = await handleDeadLetterCloudEvent(db, alertingAdapter, ce1, clock);
  assert.strictEqual(outcome1.action, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(outcome1.ack, true);
  assert.strictEqual(outcome1.alertAction, "SENT");
  assert.strictEqual(outcome1.reasonCode, "PAYLOAD_HASH_MISMATCH");

  const docAfterStep1 = await docRef.get();
  const rawTerminalSnapshot = JSON.stringify(docAfterStep1.data());
  assert.strictEqual(docAfterStep1.data().status, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(docAfterStep1.data().anomalyAlertPayloadHash, hash1, "Must persist anomalyAlertPayloadHash");
  assert.strictEqual(docAfterStep1.data().anomalyAlertEventId, eventId1);
  assert.strictEqual(docAfterStep1.data().payloadHash, authoritativeHash, "Authoritative payloadHash must NOT be overwritten");

  const expectedKey1 = generateAlertIdempotencyKey(operationId, eventId1, "PAYLOAD_HASH_MISMATCH");
  assert.strictEqual(docAfterStep1.data().anomalyAlertIdempotencyKey, expectedKey1);
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getAllAlerts()[0].idempotencyKey, expectedKey1);

  // --- Step 2: Redelivery of msg1 (same eventId, same payload1) ---
  clock.advanceMillis(30000);
  const outcome2 = await handleDeadLetterCloudEvent(db, alertingAdapter, ce1, clock);
  assert.strictEqual(outcome2.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome2.ack, true);
  assert.strictEqual(outcome2.alertAction, "SENT");
  assert.strictEqual(outcome2.reasonCode, "PAYLOAD_HASH_MISMATCH");
  assert.strictEqual(outcome2.idempotencyKey, expectedKey1);

  // External alert adapter deduplicates: still exactly 1 alert recorded
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getCallCount(expectedKey1), 2);
  assert.strictEqual(JSON.stringify((await docRef.get()).data()), rawTerminalSnapshot, "0 mutation on msg1 redelivery");

  // --- Step 3: Delivery of msg2 (same eventId, different payload2) ---
  clock.advanceMillis(30000);
  const payload2 = { storeId: "S_VAR2", productCode: "P_VAR2", quantity: 30 };
  const ce2 = buildValidTestCloudEvent({ operationId, eventId: eventId1, payload: payload2 });
  const hash2 = parseDlqCloudEvent(ce2).payloadHash;
  assert.notStrictEqual(hash2, hash1);

  const outcome3 = await handleDeadLetterCloudEvent(db, alertingAdapter, ce2, clock);
  assert.strictEqual(outcome3.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome3.ack, true);
  assert.strictEqual(outcome3.alertAction, "SENT");
  assert.strictEqual(outcome3.reasonCode, "PAYLOAD_CONTENT_CONFLICT");

  const expectedKey2 = generateAlertIdempotencyKey(operationId, eventId1, "PAYLOAD_CONTENT_CONFLICT", hash2);
  assert.strictEqual(outcome3.idempotencyKey, expectedKey2);
  assert.notStrictEqual(expectedKey2, expectedKey1, "Conflict key must NOT share key with original anomaly");

  // Independent alert dispatched: now exactly 2 alerts recorded
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 2);
  assert.strictEqual(alertingAdapter.getAllAlerts()[1].idempotencyKey, expectedKey2);
  assert.strictEqual(JSON.stringify((await docRef.get()).data()), rawTerminalSnapshot, "0 mutation on msg2 content conflict");

  // --- Step 4: Redelivery of msg2 (same eventId, same payload2) ---
  clock.advanceMillis(30000);
  const outcome4 = await handleDeadLetterCloudEvent(db, alertingAdapter, ce2, clock);
  assert.strictEqual(outcome4.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome4.ack, true);
  assert.strictEqual(outcome4.alertAction, "SENT");
  assert.strictEqual(outcome4.reasonCode, "PAYLOAD_CONTENT_CONFLICT");
  assert.strictEqual(outcome4.idempotencyKey, expectedKey2);

  // External alert adapter deduplicates msg2: still exactly 2 alerts recorded (no 3rd alert)
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 2);
  assert.strictEqual(alertingAdapter.getCallCount(expectedKey2), 2);
  assert.strictEqual(JSON.stringify((await docRef.get()).data()), rawTerminalSnapshot, "0 mutation on msg2 redelivery");

  // --- Step 5: Delivery of msg3 (different eventId2) ---
  clock.advanceMillis(30000);
  const payload3 = { storeId: "S_VAR3", productCode: "P_VAR3", quantity: 40 };
  const ce3 = buildValidTestCloudEvent({ operationId, eventId: eventId2, payload: payload3 });

  const outcome5 = await handleDeadLetterCloudEvent(db, alertingAdapter, ce3, clock);
  assert.strictEqual(outcome5.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome5.ack, true);
  assert.strictEqual(outcome5.alertAction, "SENT");
  assert.strictEqual(outcome5.reasonCode, "TERMINAL_STATE_IDENTITY_MISMATCH");

  const expectedKey3 = generateAlertIdempotencyKey(operationId, eventId2, "TERMINAL_STATE_IDENTITY_MISMATCH");
  assert.strictEqual(outcome5.idempotencyKey, expectedKey3);
  assert.notStrictEqual(expectedKey3, expectedKey1);
  assert.notStrictEqual(expectedKey3, expectedKey2);

  // New alert dispatched for distinct eventId: now 3 alerts recorded
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 3);
  assert.strictEqual(alertingAdapter.getAllAlerts()[2].idempotencyKey, expectedKey3);

  // --- Step 6: Verify doc remained byte-for-byte identical throughout ---
  assert.strictEqual(JSON.stringify((await docRef.get()).data()), rawTerminalSnapshot, "0 mutation on terminal doc across all steps");
}

async function testG4U41_LegacyDocMissingAnomalyPayloadHashAndTransientFailureRetry() {
  // Verifies:
  // 1. Legacy doc lacking anomalyAlertPayloadHash does NOT claim confirmed same anomaly.
  //    Dispatches independent content conflict alert with payloadHash in key; doc is 0 mutation.
  // 2. Redelivery of same message to legacy doc deduplicates with same key; doc is 0 mutation.
  // 3. Transient failure retry: when alert dispatch fails transiently, redelivery generates
  //    the exact same stable key and succeeds on retry.
  const db = getTestDb();
  await clearEmulatorData();
  const clock = createFakeClock(Date.parse("2026-10-01T02:30:00.000Z"));
  const alertingAdapter = new FakeAlertingAdapter();

  const operationId = "OP_LEGACY_DOC_001";
  const eventId = "evt_550e8400-e29b-41d4-a716-446655440042";
  const authoritativeHash = computePayloadHash64({ storeId: "S_LEGACY", productCode: "P_LEGACY", quantity: 100 });

  const legacyKey = generateAlertIdempotencyKey(operationId, eventId, "PAYLOAD_HASH_MISMATCH");
  const docRef = db.collection("projectionOperations").doc(operationId);
  await docRef.set({
    operationId,
    eventId,
    payloadHash: authoritativeHash,
    status: "MANUAL_REVIEW_REQUIRED",
    lastErrorCode: "PAYLOAD_HASH_MISMATCH",
    anomalyAlertEventId: eventId,
    anomalyAlertReasonCode: "PAYLOAD_HASH_MISMATCH",
    anomalyAlertIdempotencyKey: legacyKey
    // anomalyAlertPayloadHash intentionally MISSING (legacy document)
  });

  const rawBefore = JSON.stringify((await docRef.get()).data());

  const ce = buildValidTestCloudEvent({
    operationId,
    eventId,
    payload: { storeId: "S_INCOMING", productCode: "P_INCOMING", quantity: 200 }
  });
  const incomingHash = parseDlqCloudEvent(ce).payloadHash;

  // 1. First delivery to legacy doc: unconfirmed anomaly -> dispatches independent conflict alert
  const outcome1 = await handleDeadLetterCloudEvent(db, alertingAdapter, ce, clock);
  assert.strictEqual(outcome1.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome1.ack, true);
  assert.strictEqual(outcome1.alertAction, "SENT");
  assert.strictEqual(outcome1.reasonCode, "PAYLOAD_CONTENT_CONFLICT");

  const expectedConflictKey = generateAlertIdempotencyKey(operationId, eventId, "PAYLOAD_CONTENT_CONFLICT", incomingHash);
  assert.strictEqual(outcome1.idempotencyKey, expectedConflictKey);
  assert.notStrictEqual(expectedConflictKey, legacyKey, "Must NOT reuse legacy key without verified payloadHash");

  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1);
  assert.strictEqual(alertingAdapter.getAllAlerts()[0].idempotencyKey, expectedConflictKey);
  assert.strictEqual(JSON.stringify((await docRef.get()).data()), rawBefore, "0 mutation on legacy doc");

  // 2. Redelivery of same message to legacy doc: deduplicated by alert adapter
  clock.advanceMillis(15000);
  const outcome2 = await handleDeadLetterCloudEvent(db, alertingAdapter, ce, clock);
  assert.strictEqual(outcome2.action, "PRESERVE_TERMINAL_STATE");
  assert.strictEqual(outcome2.ack, true);
  assert.strictEqual(outcome2.alertAction, "SENT");
  assert.strictEqual(outcome2.idempotencyKey, expectedConflictKey);
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 1, "Alert count remains 1 (deduped)");
  assert.strictEqual(alertingAdapter.getCallCount(expectedConflictKey), 2);
  assert.strictEqual(JSON.stringify((await docRef.get()).data()), rawBefore, "0 mutation on legacy doc redelivery");

  // 3. Transient failure retry: alert fails on first try, re-attempt reuses exact same key and succeeds
  const ceRetry = buildValidTestCloudEvent({
    operationId,
    eventId,
    payload: { storeId: "S_RETRY", productCode: "P_RETRY", quantity: 300 }
  });
  const retryHash = parseDlqCloudEvent(ceRetry).payloadHash;
  const expectedRetryKey = generateAlertIdempotencyKey(operationId, eventId, "PAYLOAD_CONTENT_CONFLICT", retryHash);

  alertingAdapter.setFailNext(true);
  const outcomeFail = await handleDeadLetterCloudEvent(db, alertingAdapter, ceRetry, clock);
  assert.strictEqual(outcomeFail.ack, false, "Must NACK on transient alert failure");
  assert.strictEqual(outcomeFail.alertAction, "RETRY_ALERT");
  assert.strictEqual(JSON.stringify((await docRef.get()).data()), rawBefore, "0 mutation on alert failure");

  clock.advanceMillis(15000);
  const outcomeSuccess = await handleDeadLetterCloudEvent(db, alertingAdapter, ceRetry, clock);
  assert.strictEqual(outcomeSuccess.ack, true);
  assert.strictEqual(outcomeSuccess.alertAction, "SENT");
  assert.strictEqual(outcomeSuccess.idempotencyKey, expectedRetryKey);
  assert.strictEqual(alertingAdapter.getAllAlerts().length, 2, "Second independent alert recorded");
  assert.strictEqual(alertingAdapter.getAllAlerts()[1].idempotencyKey, expectedRetryKey);
  assert.strictEqual(JSON.stringify((await docRef.get()).data()), rawBefore, "0 mutation after retry success");
}

// ----------------------------------------------------
// Test Registry Export
// ----------------------------------------------------

module.exports = {
  validateEmulatorHost,
  validateProjectId,
  tests: [
    {
      id: "TC-10",
      name: "Pub/Sub approximate 5 delivery attempts routes message to DLQ subscription",
      run: testDeclarativeDeadLetterPolicyAndParser
    },
    {
      id: "TC-11",
      name: "DLQ Reconciler updates projectionOperations to DEAD_LETTERED on actual receipt",
      run: testDlqReconcilerUpdatesDeadLetteredOnActualReceipt
    }
  ]
};

// ----------------------------------------------------
// Standalone Runner
// ----------------------------------------------------

async function runAll() {
  console.log("=== Starting Stage 42-G4 DLQ Reconciler Simulation Suite ===");
  const testCases = [
    { name: "TC-10: Declarative dead-letter policy & parser", fn: testDeclarativeDeadLetterPolicyAndParser },
    { name: "TC-11: Actual DLQ receipt updates DEAD_LETTERED", fn: testDlqReconcilerUpdatesDeadLetteredOnActualReceipt },
    { name: "G4-U01: Strict Eventarc CloudEvent unpack", fn: testG4U01_StrictTransportUnpack },
    { name: "G4-U02: Malformed Base64 fails closed", fn: testG4U02_MalformedBase64FailClosed },
    { name: "G4-U03: Fatal UTF-8 rejection", fn: testG4U03_FatalUtf8Rejection },
    { name: "G4-U04: Missing deliveryAttempt preserved as null", fn: testG4U04_MissingDeliveryAttemptPreservesNull },
    { name: "G4-U05: PENDING -> DEAD_LETTERED transition", fn: testG4U05_PendingToDeadLettered },
    { name: "G4-U06: PROCESSING -> DEAD_LETTERED fences stale worker", fn: testG4U06_ProcessingToDeadLetteredFencesWorker },
    { name: "G4-U07: SUCCEEDED cannot be demoted", fn: testG4U07_SucceededCannotBeDemoted },
    { name: "G4-U08: MANUAL_REVIEW_REQUIRED cannot be overwritten", fn: testG4U08_ManualReviewRequiredCannotBeOverwritten },
    { name: "G4-U09: Duplicate delivery idempotent", fn: testG4U09_DuplicateDeadLetterDeliveryIdempotent },
    { name: "G4-U10: Operation not found creates no doc", fn: testG4U10_OperationNotFoundCreatesNoDocument },
    { name: "G4-U11: Hash & EventId mismatch safe handling", fn: testG4U11_HashAndEventIdMismatchHandledSafely },
    { name: "G4-U12: Concurrent duplicate deliveries single winner", fn: testG4U12_ConcurrentDuplicateDeliveriesSingleWinner },
    { name: "G4-U13: Alert sanitizer removes PII & tokens", fn: testG4U13_AlertSanitizerRemovesPiiAndTokens },
    { name: "G4-U14: Alert transient failure retry", fn: testG4U14_AlertTransientFailureAllowsRetry },
    { name: "G4-U15: Fake Alerting Adapter deduplication", fn: testG4U15_FakeAlertingAdapterDeduplicatesByIdempotencyKey },
    { name: "G4-U16: Emulator host & project env fail-closed guards", fn: testG4U16_EmulatorHostAndProjectEnvFailClosed },
    { name: "G4-U17: Authoritative eventId missing moves to MANUAL_REVIEW_REQUIRED", fn: testG4U17_AuthoritativeEventIdMissingMovesToManualReview },
    { name: "G4-U18: Authoritative payloadHash missing moves to MANUAL_REVIEW_REQUIRED", fn: testG4U18_AuthoritativePayloadHashMissingMovesToManualReview },
    { name: "G4-U19: Authoritative operationId missing/mismatch moves to MANUAL_REVIEW_REQUIRED", fn: testG4U19_AuthoritativeOperationIdMissingOrMismatchMovesToManualReview },
    { name: "G4-U20: Unknown status does not become DEAD_LETTERED", fn: testG4U20_UnknownStatusDoesNotBecomeDeadLettered },
    { name: "G4-U21: DEAD_LETTERED payloadHash mismatch is not treated as duplicate", fn: testG4U21_DeadLetteredPayloadHashMismatchIsNotDuplicate },
    { name: "G4-U22: needAlert with missing alertingClient returns NACK", fn: testG4U22_NeedAlertWithMissingAlertingClientReturnsNack },
    { name: "G4-U23: Orphan alert failure returns NACK", fn: testG4U23_OrphanAlertFailureReturnsNack },
    { name: "G4-U24: Alert error text is sanitized", fn: testG4U24_AlertErrorTextIsSanitized },
    { name: "G4-U25: Alert sent but finalization transaction fails: NACK then idempotent recovery to SENT", fn: testG4U25_AlertSentButFinalizationTransactionFails },
    { name: "G4-U26: True worker fencing: stale G3 finalizeProjectionSuccess is rejected", fn: testG4U26_TrueWorkerFencingRejectsStaleG3Finalize },
    { name: "G4-U27: SUCCEEDED identity mismatch preserves doc and sends alert", fn: testG4U27_SucceededIdentityMismatchPreservesDocAndSendsAlert },
    { name: "G4-U28: MANUAL_REVIEW_REQUIRED identity mismatch preserves doc and sends alert", fn: testG4U28_ManualReviewIdentityMismatchPreservesDocAndSendsAlert },
    { name: "G4-U29: Active identity mismatch sends alert with deterministic key", fn: testG4U29_ActiveIdentityMismatchSendsAlertWithDeterministicKey },
    { name: "G4-U30: Unknown status sends alert and NACKs on alert failure", fn: testG4U30_UnknownStatusSendsAlertAndNacksOnAlertFailure },
    { name: "G4-U31: DEAD_LETTERED identity mismatch sends alert and never ALREADY_DEAD_LETTERED", fn: testG4U31_DeadLetteredIdentityMismatchSendsAlertAndNeverAlreadyDeadLettered },
    { name: "G4-U32: Synthetic claim with missing idempotencyKey fails closed", fn: testG4U32_SyntheticClaimWithMissingIdempotencyKeyFailsClosed },
    { name: "G4-U33: DEAD_LETTERED mismatch with matching key does not run finalization transaction", fn: testG4U33_DeadLetteredIdentityMismatchWithSameKeyDoesNotRunFinalizationTransaction },
    { name: "G4-U34: DEAD_LETTERED pending with missing/invalid stored key fails closed", fn: testG4U34_DeadLetteredPendingMissingOrInvalidStoredKeyFailsClosed },
    { name: "G4-U35: Active mismatch redelivery reuses alert key and dedups", fn: testG4U35_ActiveMismatchRedeliveryReusesAlertKeyAndDedups },
    { name: "G4-U36: Active mismatch first alert fails, redelivery reuses key and succeeds", fn: testG4U36_ActiveMismatchFirstAlertFailsRedeliveryReusesKeyAndSucceeds },
    { name: "G4-U37: Alert message accurately reflects real state", fn: testG4U37_AlertMessageAccuratelyReflectsRealState },
    { name: "G4-U38: Finalization transaction explicit branches fail-closed and no PENDING doc with SENT outcome", fn: testG4U38_FinalizationTransactionExplicitBranchesAndNoPendingWithSent },
    { name: "G4-U39: Different anomaly on MANUAL_REVIEW_REQUIRED does not misidentify as duplicate", fn: testG4U39_DifferentAnomalyOnManualReviewDoesNotMisidentifyAsDuplicate },
    { name: "G4-U40: Anomaly payload identity deduplication and conflict separation", fn: testG4U40_AnomalyPayloadIdentityDeduplicationAndConflictSeparation },
    { name: "G4-U41: Legacy doc missing anomaly payloadHash and transient failure retry", fn: testG4U41_LegacyDocMissingAnomalyPayloadHashAndTransientFailureRetry }
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    try {
      await testCase.fn();
      console.log(`PASS stage-42-g4-dlq-reconciler: ${testCase.name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL stage-42-g4-dlq-reconciler: ${testCase.name}`);
      console.error(err);
      failed++;
    }
  }

  console.log("\n==================================================");
  console.log(`Stage 42-G4 DLQ Reconciler Simulation Summary:`);
  console.log(`Total: ${testCases.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log("==================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAll().catch((err) => {
    console.error("Unhandled rejection in G4 test suite:", err);
    process.exit(1);
  });
}
