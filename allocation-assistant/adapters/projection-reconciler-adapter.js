/**
 * Stage 42-G5: Projection Reconciler & Audit Recovery Adapter
 *
 * Implements:
 * - scanSucceededProjectionOperations: Bounded compound-ordering pagination (completedAt, documentId)
 * - claimReconciliationLease: 180s exclusive lease, no re-entrancy, never mutates core status to PROCESSING
 * - releaseReconciliationLease: Conditional release checking owner and claimVersion
 * - markManualReviewUnderReconciliationLease: Quarantines tampered/invalid records fail-closed
 * - reconcileProjectionRow: Authoritative sheet row verification and 12-column self-healing from projectionSnapshot (TC-13)
 * - reconcileCompensatingTransaction: Idempotent FULFILLMENT_REVERSAL offset row processing
 * - pruneExpiredSnapshotsAndTombstones: 90-day snapshot purge and 400-day tombstone pruning
 */

const admin = require("firebase-admin");
const { Timestamp, FieldPath, FieldValue } = require("firebase-admin/firestore");

const DEFAULT_LEASE_DURATION_MS = 180 * 1000;
const MS_90_DAYS = 90 * 86400 * 1000;
const MS_400_DAYS = 400 * 86400 * 1000;

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
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: Port must be an integer between 1 and 65535: ${port}`);
  }
  return trimmed;
}

function validateProjectEnvironment(env = process.env, expectedProject = "demo-jy-stage42-g5") {
  const gcloud = env.GCLOUD_PROJECT;
  const googleCloud = env.GOOGLE_CLOUD_PROJECT;

  if (gcloud === undefined || gcloud === null || typeof gcloud !== "string" || gcloud.trim() === "") {
    throw new Error(`FAIL_CLOSED_PROJECT_GUARD: GCLOUD_PROJECT is missing or empty (got: ${gcloud})`);
  }
  if (googleCloud === undefined || googleCloud === null || typeof googleCloud !== "string" || googleCloud.trim() === "") {
    throw new Error(`FAIL_CLOSED_PROJECT_GUARD: GOOGLE_CLOUD_PROJECT is missing or empty (got: ${googleCloud})`);
  }

  const trimmedGcloud = gcloud.trim();
  const trimmedGoogleCloud = googleCloud.trim();

  if (trimmedGcloud !== expectedProject) {
    throw new Error(`FAIL_CLOSED_PROJECT_GUARD: GCLOUD_PROJECT must equal '${expectedProject}' (got: '${trimmedGcloud}')`);
  }
  if (trimmedGoogleCloud !== expectedProject) {
    throw new Error(`FAIL_CLOSED_PROJECT_GUARD: GOOGLE_CLOUD_PROJECT must equal '${expectedProject}' (got: '${trimmedGoogleCloud}')`);
  }

  return expectedProject;
}

/**
 * Scan succeeded projection operations with stable compound ordering pagination
 */
async function scanSucceededProjectionOperations(firestoreDb, options = {}) {
  const batchSize = options.batchSize !== undefined ? options.batchSize : 20;
  if (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > 100) {
    throw new Error("INVALID_BATCH_SIZE: batchSize must be an integer between 1 and 100");
  }

  let query = firestoreDb.collection("projectionOperations")
    .where("status", "==", "SUCCEEDED")
    .orderBy("completedAt", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .limit(batchSize);

  if (options.cursor) {
    const { completedAt, documentId } = options.cursor;
    if (!completedAt || !documentId) {
      throw new Error("INVALID_CURSOR: cursor must include both completedAt and documentId");
    }
    query = query.startAfter(completedAt, documentId);
  }

  const snapshot = await query.get();
  const operations = snapshot.docs.map((doc) => doc.data());
  let nextCursor = null;

  if (snapshot.docs.length === batchSize) {
    const lastDoc = snapshot.docs[snapshot.docs.length - 1];
    nextCursor = {
      completedAt: lastDoc.data().completedAt,
      documentId: lastDoc.id
    };
  }

  return { operations, nextCursor };
}

/**
 * Claim exclusive 180s reconciliation lease on an operation document
 */
async function claimReconciliationLease(firestoreDb, operationId, reconcilerId, clock) {
  if (typeof operationId !== "string" || operationId.trim() === "") {
    throw new Error("INVALID_OPERATION_ID");
  }
  if (typeof reconcilerId !== "string" || reconcilerId.trim() === "") {
    throw new Error("INVALID_RECONCILER_ID");
  }

  const cleanOpId = operationId.trim();
  const docRef = firestoreDb.collection("projectionOperations").doc(cleanOpId);
  const nowTs = clock.nowTimestamp();
  const nowMillis = nowTs.toMillis();
  const newExpiresTs = Timestamp.fromMillis(nowMillis + DEFAULT_LEASE_DURATION_MS);

  return await firestoreDb.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) {
      return { acquired: false, reason: "NOT_FOUND" };
    }
    const data = doc.data();

    // Core status must remain SUCCEEDED (or FULFILLMENT_REVERSAL SUCCEEDED). Never change to PROCESSING.
    if (data.status !== "SUCCEEDED") {
      return { acquired: false, reason: "INVALID_STATUS_FOR_RECONCILIATION" };
    }

    // Verify snapshot exists and is not expired
    if (!data.projectionSnapshot) {
      return { acquired: false, reason: "MISSING_PROJECTION_SNAPSHOT" };
    }
    const isTimestamp = data.projectionSnapshotExpiresAt instanceof Timestamp ||
      (data.projectionSnapshotExpiresAt && typeof data.projectionSnapshotExpiresAt.toMillis === "function");
    if (!isTimestamp || data.projectionSnapshotExpiresAt.toMillis() <= nowMillis) {
      return { acquired: false, reason: "PROJECTION_SNAPSHOT_EXPIRED" };
    }

    // Active lease check: reject claim if lease has not expired (no re-entrancy even for identical reconcilerId)
    const currentExpiresMillis = data.reconciliationLeaseExpiresAt ? data.reconciliationLeaseExpiresAt.toMillis() : 0;
    if (data.reconciliationLeaseOwner && currentExpiresMillis > nowMillis) {
      return { acquired: false, reason: "LEASE_ACTIVE" };
    }

    const nextVersion = (data.reconciliationClaimVersion || 0) + 1;
    transaction.update(docRef, {
      reconciliationLeaseOwner: reconcilerId,
      reconciliationLeaseExpiresAt: newExpiresTs,
      reconciliationClaimVersion: nextVersion,
      reconciliationAttemptCount: (data.reconciliationAttemptCount || 0) + 1
      // Note: Never update lastReconciledAt during claim
    });

    return { acquired: true, claimVersion: nextVersion };
  });
}

/**
 * Mark manual review under active reconciliation lease (fail-closed quarantine)
 */
async function markManualReviewUnderReconciliationLease(firestoreDb, operationId, reconcilerId, claimedVersion, errorCode, clock) {
  const docRef = firestoreDb.collection("projectionOperations").doc(operationId);
  return await firestoreDb.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) return { updated: false, reason: "NOT_FOUND" };
    const data = doc.data();

    // Guard: only the active lease holder with matching claimVersion can update
    if (data.reconciliationLeaseOwner !== reconcilerId || data.reconciliationClaimVersion !== claimedVersion) {
      return { updated: false, reason: "LEASE_CLAIM_MISMATCH" };
    }

    transaction.update(docRef, {
      status: "MANUAL_REVIEW_REQUIRED",
      lastAttemptAt: clock.nowTimestamp(),
      lastErrorCode: errorCode
    });
    return { updated: true };
  });
}

/**
 * Release reconciliation lease conditionally
 */
async function releaseReconciliationLease(firestoreDb, operationId, reconcilerId, claimedVersion, options = {}) {
  const { updateLastReconciled = false, clock = null } = options;
  const docRef = firestoreDb.collection("projectionOperations").doc(operationId);

  return await firestoreDb.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) return { released: false, reason: "NOT_FOUND" };
    const data = doc.data();

    if (data.reconciliationLeaseOwner !== reconcilerId || data.reconciliationClaimVersion !== claimedVersion) {
      return { released: false, reason: "LEASE_CLAIM_MISMATCH" };
    }

    const updateFields = {
      reconciliationLeaseOwner: null,
      reconciliationLeaseExpiresAt: null
    };
    if (updateLastReconciled && clock) {
      updateFields.lastReconciledAt = clock.nowTimestamp();
    }

    transaction.update(docRef, updateFields);
    return { released: true };
  });
}

/**
 * Reconcile a single projection operation row in PROJECTION_LOG
 * Handles:
 * - Lease acquisition & re-reading authoritative Firestore state
 * - Sheet lookup & hash comparison
 * - Pre-write validation (tamper detection & lease verification)
 * - Self-healing append from projectionSnapshot (TC-13)
 * - Safe lease release in finally block
 */
async function reconcileProjectionRow(firestoreDb, sheetsClient, operationId, currentReconcilerId, clock) {
  if (typeof operationId !== "string" || operationId.trim() === "") {
    throw new Error("INVALID_OPERATION_ID");
  }
  const cleanOpId = operationId.trim();

  // 1. Acquire dedicated reconciliation lease
  const leaseResult = await claimReconciliationLease(firestoreDb, cleanOpId, currentReconcilerId, clock);
  if (!leaseResult.acquired) {
    return { outcome: "LEASE_NOT_ACQUIRED", reason: leaseResult.reason };
  }
  const { claimVersion: claimedVersion } = leaseResult;

  let outcome = null;
  let outcomeReason = null;
  let shouldUpdateLastReconciled = false;

  try {
    // 2. Re-read authoritative Firestore document under lease
    const authoritativeDoc = await firestoreDb.collection("projectionOperations").doc(cleanOpId).get();
    if (!authoritativeDoc.exists) {
      outcome = "DOCUMENT_NOT_FOUND";
      return { outcome };
    }
    const authData = authoritativeDoc.data();
    const { projectionKey, payloadHash, attemptCount } = authData;

    // 3. Validate attemptCount is a positive integer
    if (!Number.isInteger(attemptCount) || attemptCount <= 0) {
      await markManualReviewUnderReconciliationLease(
        firestoreDb,
        cleanOpId,
        currentReconcilerId,
        claimedVersion,
        "INVALID_ATTEMPT_COUNT",
        clock
      );
      outcome = "MANUAL_REVIEW_REQUIRED";
      outcomeReason = "INVALID_ATTEMPT_COUNT";
      return { outcome, reason: outcomeReason };
    }

    // 4. Query sheet for existing row
    const existingRows = await sheetsClient.findRowsByColumn("PROJECTION_LOG", "A", projectionKey);

    if (existingRows && existingRows.length > 0) {
      const existingRow = existingRows[0].rowData || existingRows[0];
      const sheetHash = existingRow ? existingRow[11] : null;

      if (sheetHash !== payloadHash) {
        await markManualReviewUnderReconciliationLease(
          firestoreDb,
          cleanOpId,
          currentReconcilerId,
          claimedVersion,
          "PAYLOAD_HASH_MISMATCH",
          clock
        );
        outcome = "MANUAL_REVIEW_REQUIRED";
        outcomeReason = "PAYLOAD_HASH_MISMATCH";
        return { outcome, reason: outcomeReason };
      }

      // Existing row matches authoritative hash: MATCH
      shouldUpdateLastReconciled = true;
      outcome = "MATCH";
      return { outcome };
    }

    // 5. Row missing: perform authoritative pre-write check in transaction before append
    const preWriteCheck = await firestoreDb.runTransaction(async (transaction) => {
      const doc = await transaction.get(firestoreDb.collection("projectionOperations").doc(cleanOpId));
      if (!doc.exists) return { valid: false, errorCode: "DOC_NOT_FOUND" };
      const current = doc.data();
      const nowMillis = clock.nowTimestamp().toMillis();
      const leaseExpiresMillis = current.reconciliationLeaseExpiresAt ? current.reconciliationLeaseExpiresAt.toMillis() : 0;
      const snapshotExpiresMillis = current.projectionSnapshotExpiresAt ? current.projectionSnapshotExpiresAt.toMillis() : 0;

      if (current.status !== "SUCCEEDED") return { valid: false, errorCode: "STATUS_NOT_SUCCEEDED" };
      if (current.reconciliationLeaseOwner !== currentReconcilerId) return { valid: false, errorCode: "LEASE_OWNER_MISMATCH" };
      if (current.reconciliationClaimVersion !== claimedVersion) return { valid: false, errorCode: "CLAIM_VERSION_MISMATCH" };
      if (leaseExpiresMillis <= nowMillis) return { valid: false, errorCode: "LEASE_EXPIRED" };
      if (!current.projectionSnapshot || snapshotExpiresMillis <= nowMillis) return { valid: false, errorCode: "SNAPSHOT_EXPIRED" };

      // Validate authoritative data integrity
      if (!Number.isInteger(current.attemptCount) || current.attemptCount <= 0) {
        return { valid: false, errorCode: "INVALID_ATTEMPT_COUNT", shouldMarkManualReview: true };
      }
      if (typeof current.payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(current.payloadHash)) {
        return { valid: false, errorCode: "INVALID_DOC_PAYLOAD_HASH", shouldMarkManualReview: true };
      }
      if (current.projectionKey !== `PROJECTION_${cleanOpId}`) {
        return { valid: false, errorCode: "PROJECTION_KEY_MISMATCH", shouldMarkManualReview: true };
      }

      const snap = current.projectionSnapshot;
      if (
        typeof snap !== "object" || snap === null ||
        typeof snap.storeId !== "string" || snap.storeId.trim() === "" ||
        typeof snap.productCode !== "string" || snap.productCode.trim() === "" ||
        typeof snap.occurredAt !== "string" || isNaN(Date.parse(snap.occurredAt)) ||
        typeof snap.payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(snap.payloadHash) ||
        typeof snap.reservationNumber !== "string" || snap.reservationNumber.trim() === "" ||
        typeof snap.eventType !== "string" || snap.eventType.trim() === "" ||
        typeof snap.pseudonymousActorId !== "string" || snap.pseudonymousActorId.trim() === ""
      ) {
        return { valid: false, errorCode: "CORRUPT_PROJECTION_SNAPSHOT", shouldMarkManualReview: true };
      }

      if (!Number.isInteger(snap.quantity) || snap.quantity <= 0) {
        return { valid: false, errorCode: "INVALID_SNAPSHOT_QUANTITY", shouldMarkManualReview: true };
      }
      if (snap.payloadHash !== current.payloadHash) {
        return { valid: false, errorCode: "SNAPSHOT_HASH_MISMATCH", shouldMarkManualReview: true };
      }

      return {
        valid: true,
        authoritativeData: {
          projectionKey: current.projectionKey,
          operationId: cleanOpId,
          projectionSnapshot: current.projectionSnapshot,
          payloadHash: current.payloadHash,
          attemptCount: current.attemptCount
        }
      };
    });

    if (!preWriteCheck.valid) {
      if (preWriteCheck.shouldMarkManualReview) {
        await markManualReviewUnderReconciliationLease(
          firestoreDb,
          cleanOpId,
          currentReconcilerId,
          claimedVersion,
          preWriteCheck.errorCode,
          clock
        );
        outcome = "MANUAL_REVIEW_REQUIRED";
      } else {
        outcome = "PRE_WRITE_CHECK_FAILED";
      }
      outcomeReason = preWriteCheck.errorCode;
      return { outcome, reason: outcomeReason };
    }

    // 6. Rebuild 12-column physical row from authoritative snapshot
    const auth = preWriteCheck.authoritativeData;
    const rebuildTimestampStr = clock.nowTimestamp().toDate().toISOString();
    const repairedRow = [
      auth.projectionKey,
      auth.operationId,
      auth.projectionSnapshot.reservationNumber,
      auth.projectionSnapshot.eventType,
      auth.projectionSnapshot.storeId,
      auth.projectionSnapshot.productCode,
      auth.projectionSnapshot.quantity,
      auth.projectionSnapshot.pseudonymousActorId,
      auth.projectionSnapshot.occurredAt,
      rebuildTimestampStr,
      auth.attemptCount,
      auth.payloadHash
    ];

    await sheetsClient.appendRow("PROJECTION_LOG", repairedRow);
    shouldUpdateLastReconciled = true;
    outcome = "REPAIRED";
    return { outcome, repairedRow };
  } finally {
    try {
      await releaseReconciliationLease(firestoreDb, cleanOpId, currentReconcilerId, claimedVersion, {
        updateLastReconciled: shouldUpdateLastReconciled,
        clock
      });
    } catch (err) {
      // Do not overwrite primary outcome
    }
  }
}

/**
 * Reconcile a compensating transaction (e.g. FULFILLMENT_REVERSAL)
 * Writes negative offset row to PROJECTION_LOG while guaranteeing 0 mutation on original DEAD_LETTERED records
 */
async function reconcileCompensatingTransaction(firestoreDb, sheetsClient, reversalDocData, currentReconcilerId, clock) {
  if (!reversalDocData || typeof reversalDocData !== "object") {
    throw new Error("INVALID_COMPENSATING_DATA: reversalDocData must be an object");
  }

  const {
    operationId: reversalOpId,
    originalOperationId,
    reservationNumber,
    eventType = "FULFILLMENT_REVERSAL",
    storeId,
    productCode,
    quantity, // Expected negative integer or positive offset to negate
    pseudonymousActorId,
    occurredAt,
    payloadHash
  } = reversalDocData;

  if (!reversalOpId || !originalOperationId) {
    throw new Error("MISSING_COMPENSATING_IDS: reversalOpId and originalOperationId required");
  }

  const projectionKey = `PROJECTION_${reversalOpId}`;

  // Idempotency: verify compensating row does not already exist
  const existingRows = await sheetsClient.findRowsByColumn("PROJECTION_LOG", "A", projectionKey);
  if (existingRows && existingRows.length > 0) {
    return { outcome: "ALREADY_COMPENSATED", projectionKey };
  }

  // Ensure original DEAD_LETTERED record maintains 0 mutation
  if (originalOperationId) {
    const origDoc = await firestoreDb.collection("projectionOperations").doc(originalOperationId).get();
    if (origDoc.exists) {
      const origData = origDoc.data();
      if (origData.status === "DEAD_LETTERED") {
        // Zero mutation invariant: do NOT change status or lease on original dead lettered doc
      }
    }
  }

  const negativeQuantity = quantity > 0 ? -quantity : quantity;
  const reversalTimestampStr = clock.nowTimestamp().toDate().toISOString();

  const reversalRow = [
    projectionKey,
    reversalOpId,
    reservationNumber,
    eventType,
    storeId,
    productCode,
    negativeQuantity,
    pseudonymousActorId,
    occurredAt || reversalTimestampStr,
    reversalTimestampStr,
    1, // attemptCount
    payloadHash
  ];

  await sheetsClient.appendRow("PROJECTION_LOG", reversalRow);
  return { outcome: "COMPENSATED", projectionKey, reversalRow };
}

/**
 * Retention policy engine: 90-day snapshot purge and 400-day tombstone pruning
 */
async function pruneExpiredSnapshotsAndTombstones(firestoreDb, clock) {
  const nowTs = clock.nowTimestamp();
  const nowMillis = nowTs.toMillis();

  const snapshot = await firestoreDb.collection("projectionOperations")
    .where("status", "==", "SUCCEEDED")
    .get();

  let purgedSnapshotCount = 0;
  let tombstonedCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data.completedAt) continue;

    const completedMillis = data.completedAt.toMillis();
    const ageMillis = nowMillis - completedMillis;

    if (ageMillis >= MS_400_DAYS) {
      await doc.ref.set({
        operationId: data.operationId,
        projectionKey: data.projectionKey,
        completedAt: data.completedAt,
        payloadHash: data.payloadHash,
        status: "TOMBSTONE"
      });
      tombstonedCount += 1;
    } else if (ageMillis >= MS_90_DAYS && data.projectionSnapshot) {
      await doc.ref.update({
        projectionSnapshot: FieldValue.delete(),
        projectionSnapshotExpiresAt: null
      });
      purgedSnapshotCount += 1;
    }
  }

  return { purgedSnapshotCount, tombstonedCount };
}

module.exports = {
  validateEmulatorHost,
  validateProjectEnvironment,
  scanSucceededProjectionOperations,
  claimReconciliationLease,
  markManualReviewUnderReconciliationLease,
  releaseReconciliationLease,
  reconcileProjectionRow,
  reconcileCompensatingTransaction,
  pruneExpiredSnapshotsAndTombstones
};
