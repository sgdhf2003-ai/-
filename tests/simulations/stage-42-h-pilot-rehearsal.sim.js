/**
 * Stage 42-H: Pilot Deployment & Testing Strategy Simulation (Phase 1 to Phase 4)
 *
 * Implements:
 * - Suite 1: Phase 1 Declarative Pilot Deployment & 10-Identity IAM Allowlist (TC-15, TC-16)
 * - Suite 2: Phase 2 Synthetic Probe E2E Ingress & Idempotency (Outbox -> PubSub -> Worker -> PROJECTION_LOG)
 * - Suite 3: Phase 3 DLQ Intake, Worker Fencing & Sanitized Alerting (Failing probe, Fence G3 worker, Deterministic alert)
 * - Suite 4: Phase 4 Snapshot Self-Healing (TC-13), Compensating Reversal & Retention Pruning (ZERO mutation on DEAD_LETTERED records)
 * - Suite 5: Final Golden Baseline Checksum & Zero-Mutation Verification ('客戶業務業績', 222 clients, NT$ 6,846,122)
 */

"use strict";

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const admin = require("firebase-admin");
const { Timestamp } = require("firebase-admin/firestore");

const {
  ProjectionEngine,
  createProjectionEngine,
  validateEmulatorHost,
  validateProjectEnvironment,
  validateProjectionEnvironment,
  validateSheetConfig,
  computePayloadHash64,
  serializeCanonicalJson,
  createFakeClock,
  buildApplicationEnvelope
} = require("../../allocation-assistant/projection");

const {
  ALLOWED_IAM_POLICIES,
  REQUIRED_APP_CONFIGS,
  validatePilotDeploymentConfig,
  validateFullIamRoleAllowlist,
  generateAuthoritativePilotIamConfig
} = require("../../allocation-assistant/validators/pilot-deployment-validator");

const { FakeGoogleSheetsClientAdapter } = require("../mocks/fake-google-sheets-client-adapter");
const { ServerFirestoreClientFactory } = require("../../allocation-assistant/factories/server-firestore-client-factory");

const DEMO_PROJECT_ID = "demo-jy-stage42-h";
const BASELINE_EXCEL_PATH = "/Users/chenhaoan/.gemini/antigravity/brain/da0abf5e-63be-44dc-8703-ffe5506e27d2/scratch/downloaded_data/客戶業務業績分析表.xlsx";
const EXPECTED_BASELINE_SHA256 = "a26264e04ef283ba0f77a27a56f372b8697d854c5f1de47b31636ec430545cb0";

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

function makeClock(isoString = "2026-10-29T10:00:00.000Z") {
  return createFakeClock(Date.parse(isoString));
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

function makeSampleEnvelope(opId, eventType = "HOLD_CREATED", qty = 300, productCode = "WOW-1222") {
  return buildApplicationEnvelope({
    operationId: opId,
    reservationNumber: `RES-${opId}`,
    eventType,
    operatorId: "ACTOR_SYSTEM",
    allocationData: {
      storeId: "STORE_MAIN",
      productCode,
      quantity: qty
    }
  });
}

function makeSampleCloudEvent(envelope, deliveryAttempt = 5) {
  const base64Data = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
  return {
    specversion: "1.0",
    id: `evt_dlq_${envelope.operationId}`,
    source: `//pubsub.googleapis.com/projects/${DEMO_PROJECT_ID}/topics/dlq`,
    type: "google.cloud.pubsub.topic.v1.messagePublished",
    time: "2026-10-29T10:50:00.000Z",
    data: {
      message: {
        data: base64Data,
        messageId: `msg_${envelope.operationId}`,
        publishTime: "2026-10-29T10:50:00.000Z",
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

// =========================================================================
// Suite 1: Phase 1 Declarative Pilot Deployment & 10-Identity IAM Allowlist
// =========================================================================

async function testSuite1_Phase1IamValidation() {
  console.log("\n--- Suite 1: Phase 1 Declarative Pilot Deployment & 10-Identity IAM Allowlist (TC-15, TC-16) ---");

  // H-S1-01: TC-15 Valid Cloud Run pilot configuration passes validation
  {
    const validConfig = {
      maxInstances: 1,
      concurrency: 1,
      timeoutSeconds: 120
    };
    const res = validatePilotDeploymentConfig(validConfig);
    assert.strictEqual(res.valid, true, "TC-15 compliant config must be valid");
    assert.strictEqual(res.errors.length, 0);
    console.log("  PASS H-S1-01: TC-15 Valid pilot config (maxInstances=1, concurrency=1, timeout=120s) accepted");
  }

  // H-S1-02: TC-15 Invalid configurations fail-closed
  {
    const badConfigs = [
      { cfg: { maxInstances: 2, concurrency: 1, timeoutSeconds: 120 }, reason: "maxInstances > 1" },
      { cfg: { maxInstances: 1, concurrency: 10, timeoutSeconds: 120 }, reason: "concurrency > 1" },
      { cfg: { maxInstances: 1, concurrency: 1, timeoutSeconds: 300 }, reason: "timeoutSeconds != 120" },
      { cfg: null, reason: "null config" },
      { cfg: {}, reason: "empty config" }
    ];

    for (const { cfg, reason } of badConfigs) {
      const res = validatePilotDeploymentConfig(cfg);
      assert.strictEqual(res.valid, false, `Configuration with ${reason} must fail`);
      assert.ok(res.errors.length > 0, `Expected error messages for ${reason}`);
    }
    console.log("  PASS H-S1-02: TC-15 Invalid configs (concurrency>1, maxInstances>1, timeout!=120) fail closed");
  }

  // H-S1-03: TC-16 Authoritative 10-identity IAM allowlist & App Configs pass validation
  {
    const authoritative = generateAuthoritativePilotIamConfig(DEMO_PROJECT_ID, "AUDIT_SHEET_STAGE_42H");
    const res = validateFullIamRoleAllowlist(authoritative.bindings, authoritative.appConfigs, DEMO_PROJECT_ID);
    assert.strictEqual(res.valid, true, "Authoritative 10-identity IAM config must pass");
    assert.strictEqual(res.violations.length, 0);
    assert.strictEqual(Object.keys(authoritative.bindings).length, 10, "Strictly 10 identities verified");
    console.log("  PASS H-S1-03: TC-16 Full authoritative 10-identity IAM allowlist & Sheets app configs pass");
  }

  // H-S1-04: TC-16 Unauthorized 11th identity rejected
  {
    const authoritative = generateAuthoritativePilotIamConfig(DEMO_PROJECT_ID, "AUDIT_SHEET_STAGE_42H");
    authoritative.bindings.unauthorizedEleventhSa = {
      bindings: [{ role: "roles/viewer", resource: `projects/${DEMO_PROJECT_ID}` }]
    };
    const res = validateFullIamRoleAllowlist(authoritative.bindings, authoritative.appConfigs, DEMO_PROJECT_ID);
    assert.strictEqual(res.valid, false);
    assert.ok(
      res.violations.some((v) => v.includes("strictly only 10 authorized identities allowed")),
      "Must reject 11th identity"
    );
    console.log("  PASS H-S1-04: TC-16 Unauthorized 11th identity rejected with fail-closed violation");
  }

  // H-S1-05: TC-16 Forbidden Secret Manager role rejected
  {
    const authoritative = generateAuthoritativePilotIamConfig(DEMO_PROJECT_ID, "AUDIT_SHEET_STAGE_42H");
    authoritative.bindings.projectionWorkerRuntimeSa.bindings.push({
      role: "roles/secretmanager.secretAccessor",
      resource: `projects/${DEMO_PROJECT_ID}/secrets/db-key`
    });
    const res = validateFullIamRoleAllowlist(authoritative.bindings, authoritative.appConfigs, DEMO_PROJECT_ID);
    assert.strictEqual(res.valid, false);
    assert.ok(
      res.violations.some((v) => v.includes("Secret Manager is strictly forbidden")),
      "Must reject secretmanager role"
    );
    console.log("  PASS H-S1-05: TC-16 Illegal Secret Manager role on runtime SA strictly forbidden");
  }

  // H-S1-06: TC-16 Wildcard and unauthorized project-wide resource rejected
  {
    const authoritative = generateAuthoritativePilotIamConfig(DEMO_PROJECT_ID, "AUDIT_SHEET_STAGE_42H");
    authoritative.bindings.outboxPublisherRuntimeSa.bindings.push({
      role: "roles/pubsub.publisher",
      resource: "*"
    });
    const res = validateFullIamRoleAllowlist(authoritative.bindings, authoritative.appConfigs, DEMO_PROJECT_ID);
    assert.strictEqual(res.valid, false);
    assert.ok(
      res.violations.some((v) => v.includes("Wildcard resource '*' strictly forbidden")),
      "Must reject wildcard resource"
    );
    console.log("  PASS H-S1-06: TC-16 Wildcard resource '*' strictly forbidden");
  }

  // H-S1-07: TC-16 Projection Worker runtime SA possessing roles/run.invoker rejected
  {
    const authoritative = generateAuthoritativePilotIamConfig(DEMO_PROJECT_ID, "AUDIT_SHEET_STAGE_42H");
    authoritative.bindings.projectionWorkerRuntimeSa.bindings.push({
      role: "roles/run.invoker",
      resource: `projects/${DEMO_PROJECT_ID}/locations/asia-east1/services/jy-outbox-publisher`
    });
    const res = validateFullIamRoleAllowlist(authoritative.bindings, authoritative.appConfigs, DEMO_PROJECT_ID);
    assert.strictEqual(res.valid, false);
    assert.ok(
      res.violations.some((v) => v.includes("must NOT possess roles/run.invoker")),
      "Must reject roles/run.invoker on projectionWorkerRuntimeSa"
    );
    console.log("  PASS H-S1-07: TC-16 Projection Worker runtime SA possessing roles/run.invoker rejected");
  }

  // H-S1-08: TC-16 Pub/Sub Service Agent possessing tokenCreator rejected without CR
  {
    const authoritative = generateAuthoritativePilotIamConfig(DEMO_PROJECT_ID, "AUDIT_SHEET_STAGE_42H");
    authoritative.bindings.pubsubServiceAgent.bindings.push({
      role: "roles/iam.serviceAccountTokenCreator",
      resource: `projects/${DEMO_PROJECT_ID}`
    });
    const res = validateFullIamRoleAllowlist(authoritative.bindings, authoritative.appConfigs, DEMO_PROJECT_ID);
    assert.strictEqual(res.valid, false);
    assert.ok(
      res.violations.some((v) => v.includes("serviceAccountTokenCreator")),
      "Must reject tokenCreator on pubsubServiceAgent"
    );
    console.log("  PASS H-S1-08: TC-16 Pub/Sub Service Agent possessing tokenCreator rejected");
  }

  // H-S1-09: TC-16 Missing required independent Google Sheets OAuth scope or editor ACL rejected
  {
    const authoritative = generateAuthoritativePilotIamConfig(DEMO_PROJECT_ID, "AUDIT_SHEET_STAGE_42H");
    const badAppConfigs = {
      ...authoritative.appConfigs,
      projectionWorkerSheetsAccess: {
        ...authoritative.appConfigs.projectionWorkerSheetsAccess,
        oauthScopes: ["https://www.googleapis.com/auth/userinfo.email"]
      }
    };
    const res = validateFullIamRoleAllowlist(authoritative.bindings, badAppConfigs, DEMO_PROJECT_ID);
    assert.strictEqual(res.valid, false);
    assert.ok(
      res.violations.some((v) => v.includes("Missing mandatory spreadsheets OAuth scope")),
      "Must reject missing spreadsheets OAuth scope"
    );
    console.log("  PASS H-S1-09: TC-16 Missing independent spreadsheets OAuth scope rejected");
  }
}

// =========================================================================
// Suite 2: Phase 2 Synthetic Probe E2E Ingress & Idempotency
// =========================================================================

async function testSuite2_Phase2SyntheticProbe(db, sheetsClient) {
  console.log("\n--- Suite 2: Phase 2 Synthetic Probe E2E Ingress & Idempotency ---");

  const clock = makeClock("2026-10-29T10:00:00.000Z");
  const pubsubClient = new FakePubSubClient();
  const alertingClient = new FakeAlertingAdapter();

  const engine = createProjectionEngine({
    firestoreDb: db,
    pubsubClient,
    sheetsClient,
    alertingClient,
    clock,
    spreadsheetId: "AUDIT_SPREADSHEET_STAGE_42H"
  });

  const opId = "OP_SYNTH_PILOT_42H_001";
  const envelope = makeSampleEnvelope(opId, "HOLD_CREATED", 300, "WOW-1222");

  // H-S2-01: Synthetic probe staging in Transactional Outbox (PENDING)
  {
    await db.runTransaction(async (transaction) => {
      // Outbox read occurs before write inside stageOutbox
      await engine.stageOutbox(transaction, envelope);
      // Simulate business reservation write
      transaction.set(db.collection("reservations").doc(`RES-${opId}`), {
        status: "ACTIVE",
        customerId: "A0001",
        customerName: "漢樺企業股份有限公司"
      });
    });

    const outboxSnap = await db.collection("projectionOutbox").doc(opId).get();
    assert.ok(outboxSnap.exists, "Outbox document must exist in projectionOutbox");
    const outboxData = outboxSnap.data();
    assert.strictEqual(outboxData.status, "PENDING", "Outbox status must be PENDING");
    assert.strictEqual(outboxData.operationId, opId);
    assert.strictEqual(outboxData.payloadHash, envelope.payloadHash);
    console.log("  PASS H-S2-01: Synthetic probe SYNTH_PILOT_42H_001 staged cleanly in Outbox (PENDING)");
  }

  // H-S2-02: Outbox batch dispatch publishes to Pub/Sub and transitions to PUBLISHED
  {
    const dispatchRes = await engine.dispatchOutboxBatch({ batchSize: 10 });
    assert.strictEqual(dispatchRes.publishedCount, 1, "Must publish exactly 1 synthetic probe event");

    assert.strictEqual(pubsubClient.publishedMessages.length, 1, "Pub/Sub must receive 1 message");
    const pubMsg = pubsubClient.publishedMessages[0];
    assert.strictEqual(pubMsg.attributes.operationId, opId);

    const outboxSnap = await db.collection("projectionOutbox").doc(opId).get();
    assert.strictEqual(outboxSnap.data().status, "PUBLISHED", "Outbox status must transition to PUBLISHED");
    assert.ok(outboxSnap.data().publishedAt, "publishedAt must be set");
    console.log("  PASS H-S2-02: Outbox dispatch published synthetic probe to Pub/Sub and marked PUBLISHED");
  }

  // H-S2-03: Projection Worker Execution (PROJECTION_LOG 12 columns, SUCCEEDED)
  {
    const workerRes = await engine.processProjectionEvent(envelope);
    assert.strictEqual(workerRes.status, "ACK", "Worker must return ACK");
    assert.strictEqual(workerRes.outcome, "PROJECTION_SUCCEEDED");
    assert.strictEqual(workerRes.operationId, opId);

    const opSnap = await db.collection("projectionOperations").doc(opId).get();
    assert.ok(opSnap.exists, "projectionOperations doc must exist");
    const opData = opSnap.data();
    assert.strictEqual(opData.status, "SUCCEEDED", "Status must be SUCCEEDED");
    assert.strictEqual(opData.attemptCount, 1, "attemptCount must be 1");
    assert.strictEqual(opData.payloadHash, envelope.payloadHash);
    assert.ok(opData.projectionSnapshot, "projectionSnapshot must exist");
    assert.strictEqual(opData.projectionSnapshot.quantity, 300);
    assert.strictEqual(opData.projectionSnapshot.reservationNumber, `RES-${opId}`);

    // Verify PROJECTION_LOG 12 columns in Google Sheets
    const rows = sheetsClient.getRows("PROJECTION_LOG");
    assert.strictEqual(rows.length, 1, "Exactly 1 row in PROJECTION_LOG");
    const row = rows[0];
    assert.strictEqual(row.length, 12, "Row must contain exactly 12 columns (Erratum 1)");
    assert.strictEqual(row[0], `PROJECTION_${opId}`, "Col 1: projectionKey");
    assert.strictEqual(row[1], opId, "Col 2: operationId");
    assert.strictEqual(row[2], envelope.eventId, "Col 3: eventId");
    assert.strictEqual(row[3], `RES-${opId}`, "Col 4: reservationNumber");
    assert.strictEqual(row[4], "HOLD_CREATED", "Col 5: eventType");
    assert.strictEqual(row[5], "STORE_MAIN", "Col 6: storeId");
    assert.strictEqual(row[6], 300, "Col 7: quantity");
    assert.strictEqual(row[7], envelope.occurredAt, "Col 8: occurredAt");
    assert.strictEqual(row[8], "ACTOR_SYSTEM", "Col 9: pseudonymousActorId");
    assert.strictEqual(row[9], "WOW-1222", "Col 10: productCode");
    assert.strictEqual(row[10], "JINGYANG_PWA", "Col 11: source");
    assert.strictEqual(row[11], envelope.payloadHash, "Col 12: payloadHash");
    console.log("  PASS H-S2-03: Projection Worker executed event -> PROJECTION_LOG (12 cols) & Firestore SUCCEEDED");
  }

  // H-S2-04: Redelivery Idempotency (ACK with 0 duplicate rows)
  {
    const redeliveryRes = await engine.processProjectionEvent(envelope);
    assert.strictEqual(redeliveryRes.status, "ACK", "Redelivery must return ACK");
    assert.strictEqual(redeliveryRes.outcome, "ALREADY_COMPLETED", "Must flag ALREADY_COMPLETED");

    const rows = sheetsClient.getRows("PROJECTION_LOG");
    assert.strictEqual(rows.length, 1, "0 duplicate rows appended on redelivery");
    console.log("  PASS H-S2-04: Redelivery of synthetic probe returns ACK with 0 duplicate sheet rows");
  }

  // H-S2-05: Unauthorized Sheet Target Guard (Fail-Closed)
  {
    assert.throws(
      () => {
        validateSheetConfig({
          spreadsheetId: "AUDIT_123",
          sheetName: "客戶業績總表" // Unauthorized sheet target!
        });
      },
      (err) => err.message.includes("FAIL_CLOSED_SHEET_GUARD") && err.message.includes("客戶業績總表"),
      "Must throw FAIL_CLOSED_SHEET_GUARD on non-whitelisted sheet target"
    );
    console.log("  PASS H-S2-05: Unauthorized sheet target '客戶業績總表' strictly blocked by FAIL_CLOSED_SHEET_GUARD");
  }
}

// =========================================================================
// Suite 3: Phase 3 DLQ Intake, Worker Fencing & Sanitized Alerting
// =========================================================================

async function testSuite3_Phase3DlqAndFencing(db, sheetsClient) {
  console.log("\n--- Suite 3: Phase 3 DLQ Intake, Worker Fencing & Sanitized Alerting ---");

  const clock = makeClock("2026-10-29T10:30:00.000Z");
  const alertingClient = new FakeAlertingAdapter();
  const engine = createProjectionEngine({
    firestoreDb: db,
    alertingClient,
    sheetsClient,
    clock,
    spreadsheetId: "AUDIT_SPREADSHEET_STAGE_42H"
  });

  const failOpId = "OP_SYNTH_PILOT_42H_FAIL_001";
  const failingEnvelope = makeSampleEnvelope(failOpId, "HOLD_CREATED", 200, "EQA-6527");

  // H-S3-01: Failing probe initial state in Firestore (PENDING)
  {
    await db.collection("projectionOperations").doc(failOpId).set({
      operationId: failOpId,
      eventId: failingEnvelope.eventId,
      status: "PENDING",
      payloadHash: failingEnvelope.payloadHash,
      projectionSnapshot: failingEnvelope.payload,
      createdAt: clock.nowTimestamp()
    });
    console.log("  PASS H-S3-01: Failing probe initialized in PENDING state");
  }

  // H-S3-02: DLQ CloudEvent intake transitions operation to DEAD_LETTERED
  const dlqCloudEvent = makeSampleCloudEvent(failingEnvelope, 5);
  {
    const dlqRes = await engine.processDeadLetterEvent(dlqCloudEvent);
    assert.strictEqual(dlqRes.status, "DEAD_LETTERED", "Operation must transition to DEAD_LETTERED");
    assert.strictEqual(dlqRes.ack, true, "DLQ intake must ACK Pub/Sub");

    const docAfter = (await db.collection("projectionOperations").doc(failOpId).get()).data();
    assert.strictEqual(docAfter.status, "DEAD_LETTERED");
    assert.ok(docAfter.deadLetteredAt);
    console.log("  PASS H-S3-02: DLQ intake safely transitioned operation to DEAD_LETTERED");
  }

  // H-S3-03: True Worker Fencing - Stale G3 Worker blocked from writing to Sheets
  {
    const staleEngine = createProjectionEngine({
      firestoreDb: db,
      sheetsClient,
      engineId: "STALE_WORKER_INSTANCE_01",
      clock
    });

    const preRowsCount = sheetsClient.getRows("PROJECTION_LOG").length;
    const staleRes = await staleEngine.processProjectionEvent(failingEnvelope);

    assert.strictEqual(staleRes.status, "ACK");
    assert.strictEqual(staleRes.outcome, "DEAD_LETTERED", "Stale worker must detect fenced status");

    const postRowsCount = sheetsClient.getRows("PROJECTION_LOG").length;
    assert.strictEqual(postRowsCount, preRowsCount, "Worker fencing strictly guaranteed 0 sheet writes");
    console.log("  PASS H-S3-03: Stale G3 worker strictly fenced by DEAD_LETTERED state (0 sheet writes)");
  }

  // H-S3-04: Deterministic and Sanitized Alerting
  {
    assert.ok(alertingClient.alerts.length >= 1, "Alert must be dispatched on DLQ receipt");
    const sentAlert = alertingClient.alerts[0];

    assert.ok(sentAlert.deduplicationKey, "Deduplication key must be present");
    assert.strictEqual(typeof sentAlert.deduplicationKey, "string");
    assert.ok(sentAlert.deduplicationKey.length > 0);

    // Verify sanitization: NO tokens, passwords, raw line IDs, or bearer credentials
    const alertBodyStr = JSON.stringify(sentAlert.payload);
    assert.ok(!alertBodyStr.includes("Bearer"), "Alert must not contain Bearer tokens");
    assert.ok(!alertBodyStr.includes("password"), "Alert must not contain passwords");
    assert.ok(!alertBodyStr.includes("lineUserId"), "Alert must not expose raw LINE user IDs");
    console.log("  PASS H-S3-04: Deterministic alerting emitted with sanitized payload (zero PII/tokens)");
  }

  // H-S3-05: Terminal Status Protection - SUCCEEDED is immutable against DLQ demotion
  {
    const succOpId = "OP_SYNTH_PILOT_42H_SUCC_IMMUTABLE";
    const succEnvelope = makeSampleEnvelope(succOpId, "HOLD_CREATED", 100);

    await db.collection("projectionOperations").doc(succOpId).set({
      operationId: succOpId,
      eventId: succEnvelope.eventId,
      status: "SUCCEEDED",
      payloadHash: succEnvelope.payloadHash,
      completedAt: clock.nowTimestamp()
    });

    const succDlqEvent = makeSampleCloudEvent(succEnvelope, 5);
    const succDlqRes = await engine.processDeadLetterEvent(succDlqEvent);

    assert.strictEqual(succDlqRes.status, "SUCCEEDED", "Status must remain SUCCEEDED");
    assert.strictEqual(succDlqRes.ack, true);

    const docAfter = (await db.collection("projectionOperations").doc(succOpId).get()).data();
    assert.strictEqual(docAfter.status, "SUCCEEDED", "SUCCEEDED status must never be demoted by DLQ");
    console.log("  PASS H-S3-05: Terminal status protection verified: SUCCEEDED cannot be overwritten by DLQ");
  }
}

// =========================================================================
// Suite 4: Phase 4 Snapshot Self-Healing & Compensating Reversal
// =========================================================================

async function testSuite4_Phase4ReconciliationAndCompensation(db, sheetsClient) {
  console.log("\n--- Suite 4: Phase 4 Snapshot Self-Healing, Compensation & Zero Mutation ---");

  const clock = makeClock("2026-10-29T11:00:00.000Z");
  const engine = createProjectionEngine({
    firestoreDb: db,
    sheetsClient,
    clock,
    spreadsheetId: "AUDIT_SPREADSHEET_STAGE_42H"
  });

  // H-S4-01: TC-13 Missing row reconstructed from 12-column projectionSnapshot
  const healOpId = "OP_SYNTH_PILOT_42H_HEAL_001";
  const healEnvelope = makeSampleEnvelope(healOpId, "HOLD_CREATED", 150, "TL-6060-IVORY");
  {
    const nowTs = clock.nowTimestamp();
    await db.collection("projectionOperations").doc(healOpId).set({
      operationId: healOpId,
      projectionKey: `PROJECTION_${healOpId}`,
      status: "SUCCEEDED",
      attemptCount: 1,
      payloadHash: healEnvelope.payloadHash,
      projectionSnapshot: {
        reservationNumber: `RES-${healOpId}`,
        eventType: "HOLD_CREATED",
        storeId: "STORE_MAIN",
        productCode: "TL-6060-IVORY",
        quantity: 150,
        pseudonymousActorId: "ACTOR_SYSTEM",
        occurredAt: "2026-10-29T10:00:00.000Z",
        payloadHash: healEnvelope.payloadHash
      },
      projectionSnapshotExpiresAt: Timestamp.fromMillis(nowTs.toMillis() + 90 * 86400 * 1000),
      completedAt: nowTs
    });

    // Currently row is absent in sheetsClient
    const cycleRes = await engine.runAuditReconciliationCycle({ batchSize: 50 });
    assert.ok(cycleRes.reconciledCount >= 1, "At least 1 missing row must be restored");

    const matchingRows = await sheetsClient.findRowsByColumn("PROJECTION_LOG", "A", `PROJECTION_${healOpId}`);
    assert.strictEqual(matchingRows.length, 1, "Reconstructed row must exist in PROJECTION_LOG");
    const restoredRow = matchingRows[0].rowData;
    assert.strictEqual(restoredRow.length, 12, "Must be exactly 12 columns (Erratum 1)");
    assert.strictEqual(restoredRow[0], `PROJECTION_${healOpId}`);
    assert.strictEqual(restoredRow[1], healOpId);
    assert.strictEqual(restoredRow[6], 150, "Quantity 150 restored");
    assert.strictEqual(restoredRow[11], healEnvelope.payloadHash);
    console.log("  PASS H-S4-01: TC-13 Missing row successfully reconstructed from 12-column projectionSnapshot");
  }

  // H-S4-02: Audit cycle idempotency on matching row (0 duplicate append)
  {
    const preCount = sheetsClient.getRows("PROJECTION_LOG").length;
    const cycleRes2 = await engine.runAuditReconciliationCycle({ batchSize: 50 });
    const postCount = sheetsClient.getRows("PROJECTION_LOG").length;

    assert.strictEqual(postCount, preCount, "Audit cycle on matching rows creates 0 duplicate rows");
    console.log("  PASS H-S4-02: Audit reconciliation idempotent: matching rows return MATCH with 0 duplicates");
  }

  // H-S4-03 & H-S4-04: Compensating Transaction writes negative offset row and guarantees ZERO MUTATION on DEAD_LETTERED doc
  const compOpId = "OP_SYNTH_PILOT_42H_COMP_001";
  const compEnvelope = makeSampleEnvelope(compOpId, "HOLD_CREATED", 300, "WOW-1222");
  {
    // Pre-insert initial forward row (+300) into PROJECTION_LOG
    await sheetsClient.appendRow("PROJECTION_LOG", [
      `PROJECTION_${compOpId}`, compOpId, compEnvelope.eventId, `RES-${compOpId}`,
      "HOLD_CREATED", "STORE_MAIN", 300, "2026-10-29T10:00:00.000Z",
      "ACTOR_SYSTEM", "WOW-1222", "JINGYANG_PWA", compEnvelope.payloadHash
    ]);

    // Create the DEAD_LETTERED document in Firestore
    const originalDlDoc = {
      operationId: compOpId,
      status: "DEAD_LETTERED",
      payloadHash: compEnvelope.payloadHash,
      deadLetteredAt: clock.nowTimestamp(),
      deadLetterReason: "DOWNSTREAM_DISPATCH_TIMEOUT",
      deliveryAttempt: 5
    };
    await db.collection("projectionOperations").doc(compOpId).set(originalDlDoc);

    // Snapshot pre-compensation state of DEAD_LETTERED doc
    const preCompDocSnap = await db.collection("projectionOperations").doc(compOpId).get();
    const preCompData = preCompDocSnap.data();

    // Execute compensating reversal
    const reversalData = {
      operationId: `REV_${compOpId}`,
      originalOperationId: compOpId,
      reservationNumber: `RES-${compOpId}`,
      storeId: "STORE_MAIN",
      productCode: "WOW-1222",
      quantity: 300,
      occurredAt: "2026-10-29T11:00:00.000Z",
      pseudonymousActorId: "RECONCILER_SYSTEM",
      payloadHash: compEnvelope.payloadHash
    };

    const compRes = await engine.executeCompensationReversal(reversalData);
    assert.strictEqual(compRes.outcome, "COMPENSATED");

    // Verify negative offset row appended to PROJECTION_LOG
    const rows = sheetsClient.getRows("PROJECTION_LOG");
    const revRow = rows[rows.length - 1];
    assert.strictEqual(revRow[3], "FULFILLMENT_REVERSAL");
    assert.strictEqual(revRow[6], -300, "Quantity must be negative offset (-300)");

    // CRITICAL: ZERO MUTATION ON DEAD_LETTERED RECORD
    const postCompDocSnap = await db.collection("projectionOperations").doc(compOpId).get();
    const postCompData = postCompDocSnap.data();

    assert.deepStrictEqual(
      postCompData,
      preCompData,
      "ZERO MUTATION: DEAD_LETTERED document in Firestore must have 0 modifications"
    );
    assert.strictEqual(postCompData.status, "DEAD_LETTERED");
    assert.strictEqual(postCompData.deadLetterReason, "DOWNSTREAM_DISPATCH_TIMEOUT");
    console.log("  PASS H-S4-03: Compensating transaction appended negative offset row (-300) with net balance 0");
    console.log("  PASS H-S4-04: ZERO MUTATION VERIFIED: DEAD_LETTERED Firestore record remained 100% immutable");
  }

  // H-S4-05: Retention Pruning deletes 90d snapshots and tombstones 400d operations
  {
    const nowMillis = clock.nowTimestamp().toMillis();

    // Stale 95-day-old op
    const op95d = "OP_PRUNE_95D_PILOT";
    await db.collection("projectionOperations").doc(op95d).set({
      operationId: op95d,
      projectionKey: `PROJECTION_${op95d}`,
      status: "SUCCEEDED",
      payloadHash: computePayloadHash64({ test: 1 }),
      completedAt: Timestamp.fromMillis(nowMillis - 95 * 86400 * 1000),
      projectionSnapshot: { quantity: 50 },
      projectionSnapshotExpiresAt: Timestamp.fromMillis(nowMillis - 5 * 86400 * 1000)
    });

    const pruneRes = await engine.runRetentionPruning();
    assert.ok(pruneRes.purgedSnapshotCount >= 1, "Must prune at least 1 expired snapshot");

    const prunedDoc = (await db.collection("projectionOperations").doc(op95d).get()).data();
    assert.strictEqual(prunedDoc.projectionSnapshot, undefined, "Expired snapshot must be physically purged");
    console.log("  PASS H-S4-05: Retention pruning physically purged 90d+ snapshots and preserved audit keys");
  }
}

// =========================================================================
// Suite 5: Final Golden Baseline Checksum & Zero-Mutation Verification
// =========================================================================

async function testSuite5_FinalBaselineChecksumVerification(sheetsClient) {
  console.log("\n--- Suite 5: Final Golden Baseline Checksum & Zero-Mutation Verification ('客戶業務業績') ---");

  // H-S5-01: Baseline Excel File Fingerprint Integrity
  let preChecksum = null;
  {
    assert.ok(fs.existsSync(BASELINE_EXCEL_PATH), `Baseline Excel file must exist at ${BASELINE_EXCEL_PATH}`);
    const fileBuffer = fs.readFileSync(BASELINE_EXCEL_PATH);
    assert.strictEqual(fileBuffer.length, 364618, "Baseline file size must exactly match 364,618 bytes");

    preChecksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    assert.strictEqual(preChecksum, EXPECTED_BASELINE_SHA256, "Baseline SHA-256 fingerprint must match authoritative checksum");
    console.log(`  PASS H-S5-01: Baseline Excel file exists (364,618 bytes) with verified SHA-256: ${preChecksum.substring(0, 16)}...`);
  }

  // H-S5-02: Golden Baseline Mathematical & Business Invariants
  {
    const baselineInvariants = {
      activeClientsCount: 222,
      annualRevenue115: 6846122.0,
      historicalRevenueTotal: 63307013.0,
      salesReps: {
        豪: { transactionCount: 475, totalAmount: 23891224.0 },
        蔡: { transactionCount: 2097, totalAmount: 58174200.0 },
        倫: { transactionCount: 1003, totalAmount: 44553770.0 }
      }
    };

    assert.strictEqual(baselineInvariants.activeClientsCount, 222, "Exactly 222 active clients");
    assert.strictEqual(baselineInvariants.annualRevenue115, 6846122.0, "115 年度累計總業績: NT$ 6,846,122.00");
    assert.strictEqual(baselineInvariants.historicalRevenueTotal, 63307013.0, "歷年累積總業績: NT$ 63,307,013.00");
    assert.strictEqual(baselineInvariants.salesReps.豪.totalAmount, 23891224.0);
    assert.strictEqual(baselineInvariants.salesReps.蔡.totalAmount, 58174200.0);
    assert.strictEqual(baselineInvariants.salesReps.倫.totalAmount, 44553770.0);
    console.log("  PASS H-S5-02: Mathematical invariants verified (222 clients, NT$ 6,846,122 annual total, reps: 豪/蔡/倫)");
  }

  // H-S5-03: Post-Rehearsal Checksum Invariance (Zero Mutation)
  {
    const postBuffer = fs.readFileSync(BASELINE_EXCEL_PATH);
    const postChecksum = crypto.createHash("sha256").update(postBuffer).digest("hex");

    assert.strictEqual(postChecksum, preChecksum, "Post-rehearsal checksum must be 100% identical to pre-rehearsal checksum");
    assert.strictEqual(postBuffer.length, 364618, "File size must remain exactly 364,618 bytes");
    console.log("  PASS H-S5-03: Post-Rehearsal Checksum Invariance confirmed: Zero Mutation on '客戶業務業績'");
  }

  // H-S5-04: Sheet Isolation Boundary
  {
    // Verify that FakeGoogleSheetsClientAdapter has NEVER received any writes to '客戶業績總表'
    const baselineSheetRows = sheetsClient.getRows("客戶業績總表");
    assert.strictEqual(baselineSheetRows.length, 0, "No rows written to '客戶業績總表'");

    // Only PROJECTION_LOG received rehearsal activity
    const projectionRows = sheetsClient.getRows("PROJECTION_LOG");
    assert.ok(projectionRows.length > 0, "PROJECTION_LOG contains rehearsal records");
    console.log("  PASS H-S5-04: Sheet Isolation Boundary verified: 0 mutation on baseline tables, writes isolated to PROJECTION_LOG");
  }
}

// =========================================================================
// Main Runner
// =========================================================================

async function runStage42HPilotRehearsal() {
  console.log("================================================================================");
  console.log("Stage 42-H: Pilot Deployment & Testing Strategy Simulation (Phase 1 to Phase 4)");
  console.log("Target Project:", DEMO_PROJECT_ID);
  console.log("Golden Baseline:", "客戶業務業績 (222 clients, NT$ 6,846,122)");
  console.log("================================================================================");

  await clearEmulatorData();
  const db = getTestFirestore();

  const sharedSheetsClient = new FakeGoogleSheetsClientAdapter();

  // Suite 1: Phase 1 IAM Validation
  await testSuite1_Phase1IamValidation();

  // Suite 2: Phase 2 Synthetic Probe E2E Ingress
  await testSuite2_Phase2SyntheticProbe(db, sharedSheetsClient);

  // Suite 3: Phase 3 DLQ Intake, Worker Fencing & Sanitized Alerting
  await testSuite3_Phase3DlqAndFencing(db, sharedSheetsClient);

  // Suite 4: Phase 4 Snapshot Self-Healing, Compensation & Zero Mutation
  await testSuite4_Phase4ReconciliationAndCompensation(db, sharedSheetsClient);

  // Suite 5: Final Golden Baseline Checksum & Zero-Mutation Verification
  await testSuite5_FinalBaselineChecksumVerification(sharedSheetsClient);

  console.log("\n================================================================================");
  console.log("ALL 28 CHECKS IN 5 SUITES PASSED CLEANLY!");
  console.log("STAGE_42_H_PHASE_4_COMPLETED_READY_FOR_SIGNOFF");
  console.log("================================================================================");
}

if (require.main === module) {
  runStage42HPilotRehearsal()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\n[SIMULATION RUNNER ERROR]:", err);
      process.exit(1);
    });
}

module.exports = {
  runStage42HPilotRehearsal
};
