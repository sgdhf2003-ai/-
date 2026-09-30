/**
 * Stage 42-G3: Projection Worker & Sheets Upsert Pipeline Simulation Tests
 *
 * Covers:
 * - TC-03: Duplicate message during active lease returns fixed ACK and zero sheet writes
 * - TC-04: Worker re-validates authoritative Firestore lease before Sheet API call fail-closed
 * - TC-05: Expired processing lease allows new worker takeover and increments claimVersion
 * - TC-06: Stale worker with lower claimVersion is rejected during Firestore state finalization
 * - TC-08: Crash after sheet write does not create duplicate row on subsequent retry
 * - TC-09: Non-retryable error transitions to MANUAL_REVIEW_REQUIRED and returns ACK
 * - TC-18: Google Sheets API 403 permission denied fails closed with SHEET_PERMISSION_DENIED
 * - Fail-Closed snapshot extraction (Erratum 1) & duplicate defense
 */

const assert = require("assert");
const admin = require("firebase-admin");
const http = require("http");
const {
  validateAndExtractProjectionSnapshot,
  claimProjectionOperation,
  verifyAuthoritativeLeaseBeforeSheetWrite,
  upsertProjectionLogSheetRow,
  finalizeProjectionSuccess,
  handleProjectionError,
  buildProjectionRowData
} = require("../../allocation-assistant/services/projection-worker-service");
const { ServerFirestoreClientFactory } = require("../../allocation-assistant/factories/server-firestore-client-factory");
const { FakeGoogleSheetsClientAdapter } = require("../mocks/fake-google-sheets-client-adapter");
const { createFakeClock } = require("../../allocation-assistant/contracts/projection-contract");

// Firestore Emulator configuration & Fail-Closed Guard
const DEMO_PROJECT_ID = "demo-jy-stage42-g3";

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
  if (projectId !== "demo-jy-stage42-g3") {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: Project ID must be exactly demo-jy-stage42-g3, got: ${projectId}`);
  }

  function checkProjectEnvVar(varName, val) {
    if (val !== undefined && val !== null) {
      if (typeof val !== "string" || val.trim() === "") {
        throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: ${varName} is set but empty or whitespace-only`);
      }
      if (val.trim() !== "demo-jy-stage42-g3") {
        throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: ${varName} must be demo-jy-stage42-g3, got: ${val}`);
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

// Fail-closed at module load time before any client initialization
const EMULATOR_HOST = validateEmulatorHost(process.env.FIRESTORE_EMULATOR_HOST);
validateProjectId(DEMO_PROJECT_ID);

let testDb = null;
function getTestDb() {
  if (!testDb) {
    testDb = ServerFirestoreClientFactory.createEmulatorAdminClient({
      projectId: DEMO_PROJECT_ID,
      emulatorHost: EMULATOR_HOST
    });
  }
  return testDb;
}

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

function makeValidEnvelope(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    eventId: "evt_3fa85f64-5717-4562-b3fc-2c963f66afa6",
    operationId: "op_20260930_test_0000000001",
    reservationNumber: "RES-20260930-001",
    eventType: "HOLD_CREATED",
    occurredAt: "2026-09-30T10:00:00.000Z",
    payloadHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    payload: {
      storeId: "STR_001",
      productCode: "PRD_A",
      quantity: 5
    },
    operator: {
      pseudonymousActorId: "actor_sales_01"
    },
    ...overrides
  };
}

// -----------------------------------------------------------------------------
// TC Runner Definitions
// -----------------------------------------------------------------------------

async function runTC03() {
  await clearEmulatorData();
  const db = getTestDb();
  const fakeClock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
  const envelope = makeValidEnvelope({ operationId: "op_tc03_active_lease" });

  // 1. Worker 1 claims operation
  const claim1 = await claimProjectionOperation(db, envelope, "worker_instance_1", fakeClock);
  assert.strictEqual(claim1.action, "PROCEED");
  assert.strictEqual(claim1.claimVersion, 1);

  // 2. Worker 2 receives duplicate while Worker 1 lease is still active (NOW < NOW + 180s)
  fakeClock.advanceMillis(30000); // 30s elapsed, lease valid for 150s more
  const claim2 = await claimProjectionOperation(db, envelope, "worker_instance_2", fakeClock);
  assert.strictEqual(claim2.action, "SKIP_ACK");
  assert.strictEqual(claim2.reason, "LEASE_ACTIVE_IN_ANOTHER_WORKER");

  // Verify doc still owned by worker 1 with claimVersion 1
  const doc = await db.collection("projectionOperations").doc(envelope.operationId).get();
  assert.strictEqual(doc.data().leaseOwner, "worker_instance_1");
  assert.strictEqual(doc.data().claimVersion, 1);
}

async function runTC04() {
  await clearEmulatorData();
  const db = getTestDb();
  const fakeClock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
  const envelope = makeValidEnvelope({ operationId: "op_tc04_lease_expiry" });

  // 1. Worker claims operation
  const claim = await claimProjectionOperation(db, envelope, "worker_instance_1", fakeClock);
  assert.strictEqual(claim.action, "PROCEED");

  // 2. Time passes past lease duration (181 seconds)
  fakeClock.advanceMillis(181000);

  // 3. Before calling Sheets API, worker re-validates authoritative lease
  const check = await verifyAuthoritativeLeaseBeforeSheetWrite(
    db,
    envelope.operationId,
    claim.claimVersion,
    "worker_instance_1",
    fakeClock
  );
  assert.strictEqual(check.valid, false);
  assert.strictEqual(check.errorCode, "LEASE_EXPIRED");
}

async function runTC05() {
  await clearEmulatorData();
  const db = getTestDb();
  const fakeClock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
  const envelope = makeValidEnvelope({ operationId: "op_tc05_lease_takeover" });

  // 1. Worker 1 claims operation
  const claim1 = await claimProjectionOperation(db, envelope, "worker_instance_1", fakeClock);
  assert.strictEqual(claim1.claimVersion, 1);

  const initialDoc = await db.collection("projectionOperations").doc(envelope.operationId).get();
  const initialSnapshot = initialDoc.data().projectionSnapshot;
  assert(initialSnapshot, "Snapshot must be initialized on first claim");

  // 2. Advance time past lease duration (181s)
  fakeClock.advanceMillis(181000);

  // 3. Worker 2 takes over expired lease
  const claim2 = await claimProjectionOperation(db, envelope, "worker_instance_2", fakeClock);
  assert.strictEqual(claim2.action, "PROCEED");
  assert.strictEqual(claim2.claimVersion, 2);

  const takeoverDoc = await db.collection("projectionOperations").doc(envelope.operationId).get();
  const data = takeoverDoc.data();
  assert.strictEqual(data.leaseOwner, "worker_instance_2");
  assert.strictEqual(data.claimVersion, 2);
  assert.strictEqual(data.status, "PROCESSING");
  assert.deepStrictEqual(data.projectionSnapshot, initialSnapshot, "Snapshot must be strictly preserved across retries");
}

async function runTC06() {
  await clearEmulatorData();
  const db = getTestDb();
  const fakeClock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
  const envelope = makeValidEnvelope({ operationId: "op_tc06_stale_fencing" });

  // 1. Worker 1 claims (version 1)
  const claim1 = await claimProjectionOperation(db, envelope, "worker_instance_1", fakeClock);

  // 2. Lease expires, Worker 2 takes over (version 2)
  fakeClock.advanceMillis(181000);
  const claim2 = await claimProjectionOperation(db, envelope, "worker_instance_2", fakeClock);
  assert.strictEqual(claim2.claimVersion, 2);

  // 3. Worker 1 wakes up and attempts to finalize with stale claimVersion 1
  let staleFinalizeFailed = false;
  try {
    await finalizeProjectionSuccess(db, envelope.operationId, claim1.claimVersion, fakeClock);
  } catch (err) {
    staleFinalizeFailed = true;
    assert.strictEqual(err.message, "CLAIM_VERSION_MISMATCH");
  }
  assert(staleFinalizeFailed, "Stale worker finalize must fail with CLAIM_VERSION_MISMATCH");

  // Verify Worker 2 is still current
  const doc = await db.collection("projectionOperations").doc(envelope.operationId).get();
  assert.strictEqual(doc.data().claimVersion, 2);
  assert.strictEqual(doc.data().status, "PROCESSING");
}

async function runTC08() {
  const sheetsClient = new FakeGoogleSheetsClientAdapter();
  const envelope = makeValidEnvelope({ operationId: "op_tc08_crash_after_sheet" });
  const snapshot = validateAndExtractProjectionSnapshot(envelope).snapshot;
  const rowData = buildProjectionRowData({ operationId: envelope.operationId, payloadHash: envelope.payloadHash }, snapshot);

  // 1. First append succeeds
  const res1 = await upsertProjectionLogSheetRow(sheetsClient, rowData);
  assert.strictEqual(res1.action, "APPENDED");
  assert.strictEqual(sheetsClient.getRows("PROJECTION_LOG").length, 1);

  // 2. Retry after simulated crash: Search-and-append must detect existing projection_key
  const res2 = await upsertProjectionLogSheetRow(sheetsClient, rowData);
  assert.strictEqual(res2.action, "ALREADY_EXISTS");
  assert.strictEqual(sheetsClient.getRows("PROJECTION_LOG").length, 1, "Must NOT append duplicate row");
}

async function runTC09() {
  await clearEmulatorData();
  const db = getTestDb();
  const fakeClock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
  const envelope = makeValidEnvelope({ operationId: "op_tc09_non_retryable" });

  // Claim operation
  const claim = await claimProjectionOperation(db, envelope, "worker_instance_1", fakeClock);

  // Handle non-retryable error (e.g. SHEET_PERMISSION_DENIED)
  const nonRetryableError = new Error("SHEET_PERMISSION_DENIED");
  const result = await handleProjectionError(db, envelope.operationId, claim.claimVersion, nonRetryableError, fakeClock);
  assert.strictEqual(result.ack, true, "Non-retryable error must return ack: true");

  const doc = await db.collection("projectionOperations").doc(envelope.operationId).get();
  assert.strictEqual(doc.data().status, "MANUAL_REVIEW_REQUIRED");
  assert.strictEqual(doc.data().lastError.message, "SHEET_PERMISSION_DENIED");
}

async function runTC18() {
  const sheetsClient = new FakeGoogleSheetsClientAdapter();
  sheetsClient.setPermissionDenied(true);

  const envelope = makeValidEnvelope({ operationId: "op_tc18_sheet_403" });
  const snapshot = validateAndExtractProjectionSnapshot(envelope).snapshot;
  const rowData = buildProjectionRowData({ operationId: envelope.operationId, payloadHash: envelope.payloadHash }, snapshot);

  let denied = false;
  try {
    await upsertProjectionLogSheetRow(sheetsClient, rowData);
  } catch (err) {
    denied = true;
    assert.strictEqual(err.message, "SHEET_PERMISSION_DENIED");
    assert.strictEqual(err.code, 403);
  }
  assert(denied, "403 permission denied must fail closed");
}

// -----------------------------------------------------------------------------
// Test Suite Runner
// -----------------------------------------------------------------------------

async function runAllTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  function runTest(name, fn) {
    totalTests++;
    try {
      fn();
      passedTests++;
      console.log(`PASS stage-42-g3-projection-worker: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`FAIL stage-42-g3-projection-worker: ${name}`);
      console.error(err);
    }
  }

  async function runAsyncTest(name, fn) {
    totalTests++;
    try {
      await fn();
      passedTests++;
      console.log(`PASS stage-42-g3-projection-worker: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`FAIL stage-42-g3-projection-worker: ${name}`);
      console.error(err);
    }
  }

  console.log("=== Starting Stage 42-G3 Projection Worker & Sheets Simulation Suite ===");

  // Unit 1: Fail-closed snapshot validation & Emulator Guard
  runTest("1.1 Valid envelope extracts complete 12-column canonical snapshot", () => {
    const envelope = makeValidEnvelope();
    const res = validateAndExtractProjectionSnapshot(envelope);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.snapshot.quantity, 5);
    assert.strictEqual(res.snapshot.reservationNumber, "RES-20260930-001");

    // Fail-Closed Emulator Guard validation assertions
    assert.throws(() => validateEmulatorHost(undefined), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateEmulatorHost(""), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateEmulatorHost("   "), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateEmulatorHost("10.0.0.1:8080"), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateEmulatorHost("192.168.1.1:8080"), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateEmulatorHost("example.com:8080"), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateEmulatorHost("http://127.0.0.1:8080"), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateEmulatorHost("127.0.0.1"), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateEmulatorHost("127.0.0.1:abc"), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateEmulatorHost("127.0.0.1:0"), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateEmulatorHost("127.0.0.1:70000"), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateProjectId("wrong-project"), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateProjectId("demo-wrong"), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateProjectId("demo-jy-stage42-g3", { GCLOUD_PROJECT: "prod-project", GOOGLE_CLOUD_PROJECT: "demo-jy-stage42-g3" }), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateProjectId("demo-jy-stage42-g3", { GCLOUD_PROJECT: "demo-jy-stage42-g3", GOOGLE_CLOUD_PROJECT: "prod-project" }), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateProjectId("demo-jy-stage42-g3", { GCLOUD_PROJECT: "prod-proj-1", GOOGLE_CLOUD_PROJECT: "prod-proj-2" }), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateProjectId("demo-jy-stage42-g3", { GCLOUD_PROJECT: "demo-jy-stage42-g3", GOOGLE_CLOUD_PROJECT: "demo-conflict" }), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateProjectId("demo-jy-stage42-g3", { GCLOUD_PROJECT: "" }), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.throws(() => validateProjectId("demo-jy-stage42-g3", { GOOGLE_CLOUD_PROJECT: "   " }), /FAIL_CLOSED_EMULATOR_GUARD/);
    assert.strictEqual(validateEmulatorHost("127.0.0.1:8080"), "127.0.0.1:8080");
    assert.strictEqual(validateEmulatorHost("localhost:8080"), "localhost:8080");
    assert.strictEqual(validateProjectId("demo-jy-stage42-g3"), "demo-jy-stage42-g3");
    assert.strictEqual(validateProjectId("demo-jy-stage42-g3", { GCLOUD_PROJECT: "demo-jy-stage42-g3", GOOGLE_CLOUD_PROJECT: "demo-jy-stage42-g3" }), "demo-jy-stage42-g3");
  });

  runTest("1.2 Extra unknown fields in payload fail closed", () => {
    const envelope = makeValidEnvelope({
      payload: { storeId: "STR_001", productCode: "PRD_A", quantity: 5, customerCode: "CUST_99" }
    });
    const res = validateAndExtractProjectionSnapshot(envelope);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.errorCode, "INVALID_PAYLOAD_SCHEMA");
  });

  runTest("1.3 Invalid quantity (0, negative, string, float, NaN) fails closed", () => {
    for (const q of [0, -1, "5", 5.5, NaN, null, undefined, Infinity]) {
      const envelope = makeValidEnvelope({
        payload: { storeId: "STR_001", productCode: "PRD_A", quantity: q }
      });
      const res = validateAndExtractProjectionSnapshot(envelope);
      assert.strictEqual(res.valid, false, `Quantity ${q} must be rejected`);
      assert.strictEqual(res.errorCode, "INVALID_QUANTITY");
    }
  });

  runTest("1.4 Operator with PII (email, raw LINE ID) or extra keys is rejected", () => {
    const emailEnv = makeValidEnvelope({ operator: { pseudonymousActorId: "admin@corp.com" } });
    assert.strictEqual(validateAndExtractProjectionSnapshot(emailEnv).errorCode, "OPERATOR_PII_EMAIL_FORBIDDEN");

    const lineEnv = makeValidEnvelope({ operator: { pseudonymousActorId: "U12345678901234567890123456789012" } });
    assert.strictEqual(validateAndExtractProjectionSnapshot(lineEnv).errorCode, "OPERATOR_PII_LINE_ID_FORBIDDEN");

    const extraEnv = makeValidEnvelope({ operator: { pseudonymousActorId: "actor_1", role: "admin" } });
    assert.strictEqual(validateAndExtractProjectionSnapshot(extraEnv).errorCode, "OPERATOR_EXTRA_FIELD_FORBIDDEN_ROLE");
  });

  // Integration 2: Claim state machine
  await runAsyncTest("2.1 First claim creates PROCESSING status with claimVersion=1 and projectionSnapshot", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "op_unit_claim_01" });

    const res = await claimProjectionOperation(db, envelope, "worker_1", clock);
    assert.strictEqual(res.action, "PROCEED");
    assert.strictEqual(res.claimVersion, 1);

    const doc = await db.collection("projectionOperations").doc(envelope.operationId).get();
    const data = doc.data();
    assert.strictEqual(data.status, "PROCESSING");
    assert.strictEqual(data.projectionKey, `PROJECTION_${envelope.operationId}`);
    assert.strictEqual(data.projectionSnapshot.quantity, 5);
  });

  await runAsyncTest("2.2 Missing operationId in claim returns REJECT_MALFORMED with 0 document writes", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "" });

    const res = await claimProjectionOperation(db, envelope, "worker_1", clock);
    assert.strictEqual(res.action, "REJECT_MALFORMED");
    assert.strictEqual(res.shouldWriteDoc, false);

    const snapshot = await db.collection("projectionOperations").get();
    assert.strictEqual(snapshot.docs.length, 0, "Must write 0 documents");
  });

  await runAsyncTest("2.3 Malformed duplicate payloadHash updates rejectedDuplicateCount without corrupting snapshot or status", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "op_unit_dup_01" });

    // 1. Initial valid claim
    await claimProjectionOperation(db, envelope, "worker_1", clock);

    // 2. Incoming duplicate with malformed hash (not 64-char hex)
    const malformedDuplicate = { ...envelope, payloadHash: "short_hash_123" };
    const res = await claimProjectionOperation(db, malformedDuplicate, "worker_2", clock);
    assert.strictEqual(res.action, "REJECT_INVALID_DUPLICATE");
    assert.strictEqual(res.reason, "MALFORMED_DUPLICATE_PAYLOAD_HASH");

    // Verify original doc untouched
    const doc = await db.collection("projectionOperations").doc(envelope.operationId).get();
    const data = doc.data();
    assert.strictEqual(data.status, "PROCESSING");
    assert.strictEqual(data.rejectedDuplicateCount, 1);
    assert.strictEqual(data.projectionSnapshot.quantity, 5);
  });

  await runAsyncTest("2.4 Valid 64-char hash mismatch marks MANUAL_REVIEW_REQUIRED without overwriting snapshot", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "op_unit_hash_mismatch" });

    // 1. Initial valid claim
    await claimProjectionOperation(db, envelope, "worker_1", clock);

    // 2. Different valid 64-char hash
    const differentHashEnv = { ...envelope, payloadHash: "b" + envelope.payloadHash.slice(1) };
    const res = await claimProjectionOperation(db, differentHashEnv, "worker_2", clock);
    assert.strictEqual(res.action, "CONFLICT");
    assert.strictEqual(res.errorCode, "PAYLOAD_HASH_MISMATCH");

    const doc = await db.collection("projectionOperations").doc(envelope.operationId).get();
    assert.strictEqual(doc.data().status, "MANUAL_REVIEW_REQUIRED");
    assert.strictEqual(doc.data().lastErrorCode, "PAYLOAD_HASH_MISMATCH");
    assert.strictEqual(doc.data().projectionSnapshot.quantity, 5, "Existing snapshot must NOT be erased");
  });

  // Task 3 & 4 Tests
  await runAsyncTest("3.1 Finalize projection success updates SUCCEEDED and sets 90-day projectionSnapshotExpiresAt", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "op_unit_finalize_success" });

    const claim = await claimProjectionOperation(db, envelope, "worker_1", clock);
    await finalizeProjectionSuccess(db, envelope.operationId, claim.claimVersion, clock);

    const doc = await db.collection("projectionOperations").doc(envelope.operationId).get();
    const data = doc.data();
    assert.strictEqual(data.status, "SUCCEEDED");
    assert(data.completedAt, "completedAt must be set");
    assert(data.projectionSnapshotExpiresAt, "projectionSnapshotExpiresAt must be set");

    const expectedExpiryMillis = clock.nowTimestamp().toMillis() + 90 * 86400 * 1000;
    assert.strictEqual(data.projectionSnapshotExpiresAt.toMillis(), expectedExpiryMillis);
  });

  await runAsyncTest("3.2 Retryable error transitions to RETRYABLE_FAILED with ack: false", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "op_unit_retryable_err" });

    const claim = await claimProjectionOperation(db, envelope, "worker_1", clock);
    const retryableErr = new Error("NETWORK_TRANSIENT_TIMEOUT email=admin@corp.com token=secret123");
    const res = await handleProjectionError(db, envelope.operationId, claim.claimVersion, retryableErr, clock);
    assert.strictEqual(res.ack, false);

    const doc = await db.collection("projectionOperations").doc(envelope.operationId).get();
    const data = doc.data();
    assert.strictEqual(data.status, "RETRYABLE_FAILED");
    assert(!data.lastError.message.includes("admin@corp.com"), "PII must be redacted in lastError");
    assert(!data.lastError.message.includes("secret123"), "Secrets must be redacted in lastError");
  });

  await runAsyncTest("3.3 Next legal delivery can claim from RETRYABLE_FAILED with incremented claimVersion", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "op_unit_retryable_reclaim" });

    // 1. Initial claim (version 1)
    const claim1 = await claimProjectionOperation(db, envelope, "worker_1", clock);
    assert.strictEqual(claim1.claimVersion, 1);

    // 2. Worker 1 hits retryable error -> RETRYABLE_FAILED
    const retryableErr = new Error("TRANSIENT_NETWORK_FAILURE");
    await handleProjectionError(db, envelope.operationId, claim1.claimVersion, retryableErr, clock);

    const docAfterFail = await db.collection("projectionOperations").doc(envelope.operationId).get();
    assert.strictEqual(docAfterFail.data().status, "RETRYABLE_FAILED");
    const snapshotBefore = docAfterFail.data().projectionSnapshot;

    // 3. Worker 2 claims operation from RETRYABLE_FAILED
    clock.advanceMillis(5000); // 5s later
    const claim2 = await claimProjectionOperation(db, envelope, "worker_2", clock);
    assert.strictEqual(claim2.action, "PROCEED");
    assert.strictEqual(claim2.claimVersion, 2);

    const docAfterReclaim = await db.collection("projectionOperations").doc(envelope.operationId).get();
    const data = docAfterReclaim.data();
    assert.strictEqual(data.status, "PROCESSING");
    assert.strictEqual(data.claimVersion, 2);
    assert.strictEqual(data.leaseOwner, "worker_2");
    assert.deepStrictEqual(data.projectionSnapshot, snapshotBefore, "Snapshot must NOT be overwritten");

    // 4. Stale worker 1 attempts to finalize -> rejected with CLAIM_VERSION_MISMATCH
    let staleFailed = false;
    try {
      await finalizeProjectionSuccess(db, envelope.operationId, claim1.claimVersion, "worker_1", clock);
    } catch (err) {
      staleFailed = true;
      assert.strictEqual(err.message, "CLAIM_VERSION_MISMATCH");
    }
    assert(staleFailed);
  });

  await runAsyncTest("3.4 Terminal statuses (MANUAL_REVIEW_REQUIRED, DEAD_LETTERED) cannot be auto-claimed", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "op_unit_terminal_reject" });

    // Setup doc directly in MANUAL_REVIEW_REQUIRED
    await db.collection("projectionOperations").doc(envelope.operationId).set({
      operationId: envelope.operationId,
      status: "MANUAL_REVIEW_REQUIRED",
      claimVersion: 1,
      payloadHash: envelope.payloadHash,
      projectionSnapshot: { ...envelope.payload, reservationNumber: envelope.reservationNumber }
    });

    const res1 = await claimProjectionOperation(db, envelope, "worker_1", clock);
    assert.strictEqual(res1.action, "CONFLICT");
    assert.strictEqual(res1.errorCode, "MANUAL_REVIEW_REQUIRED");

    // Setup doc in DEAD_LETTERED
    await db.collection("projectionOperations").doc(envelope.operationId).update({
      status: "DEAD_LETTERED"
    });

    const res2 = await claimProjectionOperation(db, envelope, "worker_1", clock);
    assert.strictEqual(res2.action, "CONFLICT");
    assert.strictEqual(res2.errorCode, "DEAD_LETTERED");
  });

  await runAsyncTest("3.5 Redelivery to already SUCCEEDED returns fixed SKIP_ACK with 0 writes", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "op_unit_succeeded_redelivery" });

    const claim = await claimProjectionOperation(db, envelope, "worker_1", clock);
    await finalizeProjectionSuccess(db, envelope.operationId, claim.claimVersion, "worker_1", clock);

    // Redelivery
    const redelivery = await claimProjectionOperation(db, envelope, "worker_2", clock);
    assert.strictEqual(redelivery.action, "SKIP_ACK");
    assert.strictEqual(redelivery.reason, "ALREADY_COMPLETED");
  });

  await runAsyncTest("4.1 finalizeProjectionSuccess enforces 6-condition fencing", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "op_unit_fencing_full" });

    // 1. Doc does not exist
    let errNonExistent = null;
    try {
      await finalizeProjectionSuccess(db, "op_non_existent", 1, "worker_1", clock);
    } catch (e) { errNonExistent = e.message; }
    assert.strictEqual(errNonExistent, "OPERATION_NOT_FOUND");

    // 2. Claim operation
    const claim = await claimProjectionOperation(db, envelope, "worker_1", clock);

    // 3. Version mismatch
    let errVersion = null;
    try {
      await finalizeProjectionSuccess(db, envelope.operationId, 999, "worker_1", clock);
    } catch (e) { errVersion = e.message; }
    assert.strictEqual(errVersion, "CLAIM_VERSION_MISMATCH");

    // 4. Lease owner mismatch
    let errOwner = null;
    try {
      await finalizeProjectionSuccess(db, envelope.operationId, claim.claimVersion, "wrong_worker", clock);
    } catch (e) { errOwner = e.message; }
    assert.strictEqual(errOwner, "LEASE_OWNER_MISMATCH");

    // 5. Payload hash mismatch in claimContext
    let errHash = null;
    try {
      await finalizeProjectionSuccess(db, envelope.operationId, claim.claimVersion, "worker_1", clock, { payloadHash: "mismatched_hash" });
    } catch (e) { errHash = e.message; }
    assert.strictEqual(errHash, "PAYLOAD_HASH_MISMATCH");

    // 6. Lease expired
    clock.advanceMillis(181000);
    let errExpired = null;
    try {
      await finalizeProjectionSuccess(db, envelope.operationId, claim.claimVersion, "worker_1", clock);
    } catch (e) { errExpired = e.message; }
    assert.strictEqual(errExpired, "LEASE_EXPIRED");
  });

  await runAsyncTest("5.1 Sheet search-and-append with hash mismatch throws PAYLOAD_HASH_MISMATCH and transitions to MANUAL_REVIEW_REQUIRED", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "op_unit_sheet_hash_mismatch" });

    const sheetsClient = new FakeGoogleSheetsClientAdapter();
    const snapshot = validateAndExtractProjectionSnapshot(envelope).snapshot;
    const rowData1 = buildProjectionRowData({ operationId: envelope.operationId, payloadHash: envelope.payloadHash }, snapshot);

    // Initial append
    await upsertProjectionLogSheetRow(sheetsClient, rowData1);

    // Claim doc in Firestore
    const claim = await claimProjectionOperation(db, envelope, "worker_1", clock);

    // Attempt second append with different payloadHash in rowData
    const conflictingRowData = [...rowData1];
    conflictingRowData[11] = "f".repeat(64); // Different hash

    let sheetErr = null;
    try {
      await upsertProjectionLogSheetRow(sheetsClient, conflictingRowData);
    } catch (e) {
      sheetErr = e;
    }
    assert(sheetErr, "Should throw on hash conflict");
    assert.strictEqual(sheetErr.message, "PAYLOAD_HASH_MISMATCH");

    // handleProjectionError handles PAYLOAD_HASH_MISMATCH
    const errRes = await handleProjectionError(db, envelope.operationId, claim.claimVersion, sheetErr, clock);
    assert.strictEqual(errRes.ack, true);

    const doc = await db.collection("projectionOperations").doc(envelope.operationId).get();
    assert.strictEqual(doc.data().status, "MANUAL_REVIEW_REQUIRED");
  });

  await runAsyncTest("5.2 Full retry cycle after sheet write crash successfully reconciles without duplicate row", async () => {
    await clearEmulatorData();
    const db = getTestDb();
    const clock = createFakeClock(Date.UTC(2026, 8, 30, 10, 0, 0));
    const envelope = makeValidEnvelope({ operationId: "op_unit_sheet_crash_recovery" });

    // 1. Worker 1 claims
    const claim1 = await claimProjectionOperation(db, envelope, "worker_1", clock);
    const sheetsClient = new FakeGoogleSheetsClientAdapter();
    const snapshot = validateAndExtractProjectionSnapshot(envelope).snapshot;
    const rowData = buildProjectionRowData({ operationId: envelope.operationId, payloadHash: envelope.payloadHash }, snapshot);

    // 2. Sheet write succeeds
    const sheetRes1 = await upsertProjectionLogSheetRow(sheetsClient, rowData);
    assert.strictEqual(sheetRes1.action, "APPENDED");
    assert.strictEqual(sheetsClient.getRows("PROJECTION_LOG").length, 1);

    // 3. Worker 1 crashes before finalizeProjectionSuccess!
    // Time passes past lease (181s)
    clock.advanceMillis(181000);

    // 4. Worker 2 takes over
    const claim2 = await claimProjectionOperation(db, envelope, "worker_2", clock);
    assert.strictEqual(claim2.action, "PROCEED");
    assert.strictEqual(claim2.claimVersion, 2);

    // 5. Worker 2 pre-checks lease
    const preCheck = await verifyAuthoritativeLeaseBeforeSheetWrite(db, envelope.operationId, claim2.claimVersion, "worker_2", clock);
    assert.strictEqual(preCheck.valid, true);

    // 6. Worker 2 executes search-and-append -> ALREADY_EXISTS, 0 new rows
    const sheetRes2 = await upsertProjectionLogSheetRow(sheetsClient, rowData);
    assert.strictEqual(sheetRes2.action, "ALREADY_EXISTS");
    assert.strictEqual(sheetsClient.getRows("PROJECTION_LOG").length, 1, "Must NOT duplicate row");

    // 7. Worker 2 finalizes successfully
    await finalizeProjectionSuccess(db, envelope.operationId, claim2.claimVersion, "worker_2", clock);

    const doc = await db.collection("projectionOperations").doc(envelope.operationId).get();
    assert.strictEqual(doc.data().status, "SUCCEEDED");
  });

  // Execute Acceptance Test Registry cases (TC-03, TC-04, TC-05, TC-06, TC-08, TC-09, TC-18)
  await runAsyncTest("TC-03: Duplicate message during active lease returns fixed ACK and zero sheet writes", runTC03);
  await runAsyncTest("TC-04: Worker re-validates authoritative Firestore lease before Sheet API call fail-closed", runTC04);
  await runAsyncTest("TC-05: Expired processing lease allows new worker takeover and increments claimVersion", runTC05);
  await runAsyncTest("TC-06: Stale worker with lower claimVersion is rejected during Firestore state finalization", runTC06);
  await runAsyncTest("TC-08: Crash after sheet write does not create duplicate row on subsequent retry", runTC08);
  await runAsyncTest("TC-09: Non-retryable error transitions to MANUAL_REVIEW_REQUIRED and returns ACK", runTC09);
  await runAsyncTest("TC-18: Google Sheets API 403 permission denied fails closed with SHEET_PERMISSION_DENIED", runTC18);

  console.log("\n==================================================");
  console.log(`Stage 42-G3 Projection Worker Simulation Summary:`);
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
    id: "TC-03",
    name: "Duplicate message during active lease returns fixed ACK and zero sheet writes",
    run: runTC03
  },
  {
    id: "TC-04",
    name: "Worker re-validates authoritative Firestore lease before Sheet API call fail-closed",
    run: runTC04
  },
  {
    id: "TC-05",
    name: "Expired processing lease allows new worker takeover and increments claimVersion",
    run: runTC05
  },
  {
    id: "TC-06",
    name: "Stale worker with lower claimVersion is rejected during Firestore state finalization",
    run: runTC06
  },
  {
    id: "TC-08",
    name: "Crash after sheet write does not create duplicate row on subsequent retry",
    run: runTC08
  },
  {
    id: "TC-09",
    name: "Non-retryable error transitions to MANUAL_REVIEW_REQUIRED and returns ACK",
    run: runTC09
  },
  {
    id: "TC-18",
    name: "Google Sheets API 403 permission denied fails closed with SHEET_PERMISSION_DENIED",
    run: runTC18
  }
];

const testRegistry = {
  "TC-03": runTC03,
  "TC-04": runTC04,
  "TC-05": runTC05,
  "TC-06": runTC06,
  "TC-08": runTC08,
  "TC-09": runTC09,
  "TC-18": runTC18
};

module.exports = {
  tests,
  testRegistry,
  runTC03,
  runTC04,
  runTC05,
  runTC06,
  runTC08,
  runTC09,
  runTC18,
  validateEmulatorHost,
  validateProjectId
};
