/**
 * Stage 42-G3: Projection Worker Service
 *
 * Implements:
 * 1. validateAndExtractProjectionSnapshot: Fail-Closed validation of Application Envelope & Snapshot extraction (Erratum 1)
 * 2. claimProjectionOperation: Distributed lease claim with Fencing Token (claimVersion) & snapshot persistence
 * 3. verifyAuthoritativeLeaseBeforeSheetWrite: 4-condition authoritative read before Sheets API call
 * 4. upsertProjectionLogSheetRow: Search-and-append for 12-column PROJECTION_LOG
 * 5. finalizeProjectionSuccess: Atomic transition to SUCCEEDED with 90-day snapshot expiration
 * 6. handleProjectionError: Error taxonomy classification (MANUAL_REVIEW_REQUIRED vs RETRYABLE_FAILED)
 * 7. buildProjectionRowData: 12-column row construction
 */

const { Timestamp } = require("firebase-admin/firestore");
const { sanitizeLogEntry } = require("../contracts/projection-contract");

const ALLOWED_EVENT_TYPES = Object.freeze([
  "HOLD_CREATED",
  "HOLD_FULFILLED",
  "HOLD_CANCELLED",
  "HOLD_RECONCILED"
]);

const FORBIDDEN_OPERATOR_KEYS = Object.freeze([
  "name",
  "email",
  "phone",
  "lineUserId",
  "role",
  "token",
  "password"
]);

const NON_RETRYABLE_ERROR_CODES = Object.freeze([
  "PAYLOAD_HASH_MISMATCH",
  "UNSUPPORTED_SCHEMA_VERSION",
  "SHEET_PERMISSION_DENIED",
  "FAIL_CLOSED_SNAPSHOT_VALIDATION",
  "INVALID_QUANTITY",
  "MALFORMED_ENVELOPE",
  "INVALID_PAYLOAD_SCHEMA"
]);

/**
 * Validate Application Envelope and extract canonical Projection Snapshot (Erratum 1)
 */
function validateAndExtractProjectionSnapshot(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { valid: false, errorCode: "MALFORMED_ENVELOPE", isMalformedOperationId: true };
  }

  const {
    operationId,
    eventId,
    reservationNumber,
    eventType,
    occurredAt,
    payloadHash,
    payload,
    operator
  } = envelope;

  if (typeof operationId !== "string" || operationId.trim() === "") {
    return { valid: false, isMalformedOperationId: true, errorCode: "INVALID_OPERATION_ID" };
  }

  if (typeof eventId !== "string" || eventId.trim() === "") {
    return { valid: false, errorCode: "INVALID_EVENT_ID" };
  }

  if (typeof reservationNumber !== "string" || reservationNumber.trim() === "") {
    return { valid: false, errorCode: "INVALID_RESERVATION_NUMBER" };
  }

  if (typeof eventType !== "string" || !ALLOWED_EVENT_TYPES.includes(eventType.trim())) {
    return { valid: false, errorCode: "INVALID_EVENT_TYPE" };
  }

  if (typeof occurredAt !== "string" || occurredAt.trim() === "") {
    return { valid: false, errorCode: "INVALID_OCCURRED_AT" };
  }

  if (typeof payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(payloadHash)) {
    return { valid: false, errorCode: "INVALID_PAYLOAD_HASH" };
  }

  // Operator validation (PII check & extra fields)
  if (!operator || typeof operator !== "object" || Array.isArray(operator)) {
    return { valid: false, errorCode: "INVALID_OPERATOR" };
  }

  const pseudonymousActorId = operator.pseudonymousActorId;
  if (typeof pseudonymousActorId !== "string" || pseudonymousActorId.trim() === "") {
    return { valid: false, errorCode: "INVALID_OPERATOR_ACTOR_ID" };
  }

  if (/@/.test(pseudonymousActorId)) {
    return { valid: false, errorCode: "OPERATOR_PII_EMAIL_FORBIDDEN" };
  }

  if (/^U[0-9a-fA-F]{32}$/.test(pseudonymousActorId)) {
    return { valid: false, errorCode: "OPERATOR_PII_LINE_ID_FORBIDDEN" };
  }

  for (const forbiddenKey of FORBIDDEN_OPERATOR_KEYS) {
    if (Object.prototype.hasOwnProperty.call(operator, forbiddenKey)) {
      return { valid: false, errorCode: `OPERATOR_EXTRA_FIELD_FORBIDDEN_${forbiddenKey.toUpperCase()}` };
    }
  }

  // Payload validation: Only { storeId, productCode, quantity } allowed. Strict fail-closed against extra/fallback keys.
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, errorCode: "INVALID_PAYLOAD_SCHEMA" };
  }

  const allowedPayloadKeys = new Set(["storeId", "productCode", "quantity"]);
  for (const key of Object.keys(payload)) {
    if (!allowedPayloadKeys.has(key)) {
      return { valid: false, errorCode: "INVALID_PAYLOAD_SCHEMA" };
    }
  }

  const { storeId, productCode, quantity } = payload;
  if (typeof storeId !== "string" || storeId.trim() === "") {
    return { valid: false, errorCode: "INVALID_STORE_ID" };
  }

  if (typeof productCode !== "string" || productCode.trim() === "") {
    return { valid: false, errorCode: "INVALID_PRODUCT_CODE" };
  }

  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    return { valid: false, errorCode: "INVALID_QUANTITY" };
  }

  return {
    valid: true,
    snapshot: {
      reservationNumber: reservationNumber.trim(),
      eventType: eventType.trim(),
      storeId: storeId.trim(),
      productCode: productCode.trim(),
      quantity,
      pseudonymousActorId: pseudonymousActorId.trim(),
      occurredAt,
      payloadHash
    }
  };
}

/**
 * Claim projection operation with distributed 180s lease & snapshot storage
 */
async function claimProjectionOperation(db, envelope, workerInstanceId, clock) {
  const validation = validateAndExtractProjectionSnapshot(envelope);

  // If operationId itself is missing or malformed: 0 doc writes, return REJECT_MALFORMED
  if (!validation.valid && validation.isMalformedOperationId) {
    return { action: "REJECT_MALFORMED", errorCode: validation.errorCode, shouldWriteDoc: false };
  }

  const operationId = envelope.operationId.trim();
  const docRef = db.collection("projectionOperations").doc(operationId);

  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    const nowTs = clock.nowTimestamp();
    const nowMillis = nowTs.toMillis();
    const leaseDurationMs = 180 * 1000;
    const newExpiresTs = Timestamp.fromMillis(nowMillis + leaseDurationMs);

    // If document does NOT exist
    if (!doc.exists) {
      if (!validation.valid) {
        // operationId valid but snapshot invalid: write minimal MANUAL_REVIEW_REQUIRED, projectionSnapshot: null
        transaction.set(docRef, {
          operationId,
          eventId: envelope.eventId || null,
          projectionKey: `PROJECTION_${operationId}`,
          status: "MANUAL_REVIEW_REQUIRED",
          claimVersion: 1,
          leaseOwner: null,
          leaseExpiresAt: null,
          payloadHash: envelope.payloadHash || null,
          attemptCount: 1,
          firstAttemptAt: nowTs,
          lastAttemptAt: nowTs,
          completedAt: null,
          projectionSnapshot: null,
          projectionSnapshotExpiresAt: null,
          lastErrorCode: validation.errorCode
        });
        return { action: "CONFLICT", errorCode: validation.errorCode };
      }

      // First creation with valid snapshot: initialize PROCESSING and projectionSnapshot
      const { snapshot: projectionSnapshot } = validation;
      const { payloadHash, eventId } = envelope;
      const newRecord = {
        operationId,
        eventId,
        projectionKey: `PROJECTION_${operationId}`,
        status: "PROCESSING",
        claimVersion: 1,
        leaseOwner: workerInstanceId,
        leaseExpiresAt: newExpiresTs,
        payloadHash,
        attemptCount: 1,
        firstAttemptAt: nowTs,
        lastAttemptAt: nowTs,
        completedAt: null,
        projectionSnapshot,
        projectionSnapshotExpiresAt: null
      };

      transaction.set(docRef, newRecord);
      return { action: "PROCEED", claimVersion: 1, record: newRecord };
    }

    // Existing document exists
    const data = doc.data();

    // Helper: calculate rejectedDuplicateCount strictly without (v||0)+1
    function getNextRejectedDuplicateCount(currentDocData) {
      if (currentDocData.rejectedDuplicateCount === undefined || currentDocData.rejectedDuplicateCount === null) {
        return 1;
      }
      const count = currentDocData.rejectedDuplicateCount;
      if (!Number.isInteger(count) || count < 0) {
        throw new Error("CORRUPT_DOCUMENT_STATE: rejectedDuplicateCount is corrupt");
      }
      return count + 1;
    }

    const incomingHash = envelope.payloadHash;
    const isValidIncomingHashFormat = typeof incomingHash === "string" && /^[0-9a-f]{64}$/.test(incomingHash);

    // 1 & 2. Malformed duplicate payloadHash: do NOT corrupt existing status or snapshot
    if (!isValidIncomingHashFormat) {
      const nextDupCount = getNextRejectedDuplicateCount(data);
      transaction.update(docRef, {
        lastAttemptAt: nowTs,
        rejectedDuplicateCount: nextDupCount
      });
      return { action: "REJECT_INVALID_DUPLICATE", errorCode: "INVALID_PAYLOAD_HASH", reason: "MALFORMED_DUPLICATE_PAYLOAD_HASH" };
    }

    // 3. Different valid 64-char payloadHash: trigger MANUAL_REVIEW_REQUIRED without overwriting snapshot
    if (data.payloadHash !== incomingHash) {
      transaction.update(docRef, {
        status: "MANUAL_REVIEW_REQUIRED",
        lastAttemptAt: nowTs,
        lastErrorCode: "PAYLOAD_HASH_MISMATCH"
      });
      return { action: "CONFLICT", errorCode: "PAYLOAD_HASH_MISMATCH" };
    }

    // 4. Same payloadHash but other fields malformed in duplicate: do not corrupt status or snapshot
    if (!validation.valid) {
      const nextDupCount = getNextRejectedDuplicateCount(data);
      transaction.update(docRef, {
        lastAttemptAt: nowTs,
        rejectedDuplicateCount: nextDupCount
      });
      return { action: "REJECT_INVALID_DUPLICATE", errorCode: validation.errorCode, reason: "MALFORMED_DUPLICATE_ENVELOPE" };
    }

    // 5. Normal duplicate delivery: already SUCCEEDED
    if (data.status === "SUCCEEDED") {
      return { action: "SKIP_ACK", reason: "ALREADY_COMPLETED" };
    }

    // 6. TC-03: Active processing lease in another worker
    const activeExpiresMillis = data.leaseExpiresAt ? data.leaseExpiresAt.toMillis() : 0;
    if (data.status === "PROCESSING" && activeExpiresMillis > nowMillis) {
      return { action: "SKIP_ACK", reason: "LEASE_ACTIVE_IN_ANOTHER_WORKER" };
    }

    // 6.1 Terminal / Non-retryable statuses: never auto-retry
    if (data.status === "MANUAL_REVIEW_REQUIRED") {
      return { action: "CONFLICT", errorCode: "MANUAL_REVIEW_REQUIRED", reason: "OPERATION_IN_MANUAL_REVIEW" };
    }
    if (data.status === "DEAD_LETTERED") {
      return { action: "CONFLICT", errorCode: "DEAD_LETTERED", reason: "OPERATION_DEAD_LETTERED" };
    }

    // 7. Legitimate takeover only allowed from RETRYABLE_FAILED or (PROCESSING with expired lease)
    const isRetryableFailed = data.status === "RETRYABLE_FAILED";
    const isExpiredProcessing = data.status === "PROCESSING" && activeExpiresMillis <= nowMillis;
    if (!isRetryableFailed && !isExpiredProcessing) {
      return { action: "CONFLICT", errorCode: "INVALID_STATE_TRANSITION", reason: `CANNOT_CLAIM_FROM_STATUS_${data.status}` };
    }

    // 7. TC-05: Lease expired or retryable: atomic takeover with incremented claimVersion
    const nextVersion = (data.claimVersion || 0) + 1;
    transaction.update(docRef, {
      status: "PROCESSING",
      claimVersion: nextVersion,
      leaseOwner: workerInstanceId,
      leaseExpiresAt: newExpiresTs,
      attemptCount: (data.attemptCount || 0) + 1,
      lastAttemptAt: nowTs
      // Erratum 1: Never overwrite projectionSnapshot
    });

    return { action: "PROCEED", claimVersion: nextVersion, record: data };
  });
}

/**
 * Authoritative Firestore re-validation before calling Sheets API
 */
async function verifyAuthoritativeLeaseBeforeSheetWrite(db, operationId, claimedVersion, currentWorkerId, clock) {
  const docRef = db.collection("projectionOperations").doc(operationId);
  const doc = await docRef.get();
  if (!doc.exists) {
    return { valid: false, errorCode: "DOCUMENT_NOT_FOUND" };
  }
  const data = doc.data();
  const nowMillis = clock.nowTimestamp().toMillis();
  const expiresMillis = data.leaseExpiresAt ? data.leaseExpiresAt.toMillis() : 0;

  if (data.status !== "PROCESSING") {
    return { valid: false, errorCode: "STATUS_NOT_PROCESSING" };
  }
  if (data.leaseOwner !== currentWorkerId) {
    return { valid: false, errorCode: "LEASE_OWNER_MISMATCH" };
  }
  if (data.claimVersion !== claimedVersion) {
    return { valid: false, errorCode: "CLAIM_VERSION_MISMATCH" };
  }
  if (expiresMillis <= nowMillis) {
    return { valid: false, errorCode: "LEASE_EXPIRED" };
  }

  return { valid: true };
}

/**
 * Search-and-Append 12-column row to Google Sheets PROJECTION_LOG
 */
async function upsertProjectionLogSheetRow(sheetsClient, rowData) {
  if (!Array.isArray(rowData) || rowData.length !== 12) {
    throw new Error("INVALID_SHEET_ROW: Row must contain exactly 12 columns");
  }

  const quantity = rowData[6];
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("INVALID_QUANTITY_VALUE: quantity must be a positive finite integer (> 0)");
  }

  const projectionKey = rowData[0];
  const existingRows = await sheetsClient.findRowsByColumn("PROJECTION_LOG", "A", projectionKey);
  if (existingRows.length > 0) {
    const existingRow = existingRows[0].rowData;
    const existingHash = existingRow ? existingRow[11] : null;
    const incomingHash = rowData[11];
    if (existingHash && incomingHash && existingHash !== incomingHash) {
      const err = new Error("PAYLOAD_HASH_MISMATCH");
      err.code = "PAYLOAD_HASH_MISMATCH";
      throw err;
    }
    return { action: "ALREADY_EXISTS" };
  }

  await sheetsClient.appendRow("PROJECTION_LOG", rowData);
  return { action: "APPENDED" };
}

/**
 * Finalize projection operation as SUCCEEDED with 90-day snapshot expiration and 6-condition fencing
 */
async function finalizeProjectionSuccess(db, operationId, claimVersion, workerInstanceId, clock, claimContext = {}) {
  let actualWorkerId = workerInstanceId;
  let actualClock = clock;
  let actualContext = claimContext;
  if (workerInstanceId && typeof workerInstanceId.nowTimestamp === "function") {
    // Backward-compatible 4-arg signature: (db, operationId, claimVersion, clock)
    actualClock = workerInstanceId;
    actualWorkerId = null;
    actualContext = {};
  }

  const docRef = db.collection("projectionOperations").doc(operationId);
  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) {
      throw new Error("OPERATION_NOT_FOUND");
    }
    const data = doc.data();

    // 1. Status check: must be PROCESSING
    if (data.status !== "PROCESSING") {
      throw new Error("STATUS_NOT_PROCESSING");
    }

    // 2. Fencing token check
    if (data.claimVersion !== claimVersion) {
      throw new Error("CLAIM_VERSION_MISMATCH");
    }

    // 3. Worker ownership check (if workerInstanceId supplied)
    if (actualWorkerId && data.leaseOwner !== actualWorkerId) {
      throw new Error("LEASE_OWNER_MISMATCH");
    }

    // 4. Lease expiration check
    const nowMillis = actualClock.nowTimestamp().toMillis();
    const expiresMillis = data.leaseExpiresAt ? data.leaseExpiresAt.toMillis() : 0;
    if (expiresMillis <= nowMillis) {
      throw new Error("LEASE_EXPIRED");
    }

    // 5. Payload hash and projection key consistency (if supplied in context)
    if (actualContext.payloadHash && data.payloadHash !== actualContext.payloadHash) {
      throw new Error("PAYLOAD_HASH_MISMATCH");
    }
    if (actualContext.projectionKey && data.projectionKey !== actualContext.projectionKey) {
      throw new Error("PROJECTION_KEY_MISMATCH");
    }

    const completedAt = actualClock.nowTimestamp();
    const ninetyDaysMs = 90 * 86400 * 1000;
    const projectionSnapshotExpiresAt = Timestamp.fromMillis(completedAt.toMillis() + ninetyDaysMs);

    transaction.update(docRef, {
      status: "SUCCEEDED",
      completedAt,
      projectionSnapshotExpiresAt,
      lastAttemptAt: completedAt,
      leaseOwner: null,
      leaseExpiresAt: null
    });
  });
}

/**
 * Handle projection error and classify into MANUAL_REVIEW_REQUIRED or RETRYABLE_FAILED
 */
async function handleProjectionError(db, operationId, claimVersion, error, clock) {
  const docRef = db.collection("projectionOperations").doc(operationId);
  const nowTs = clock.nowTimestamp();

  const rawErrorMessage = error && error.message ? error.message : String(error);
  const errorCode = error && error.code ? error.code : null;

  const isNonRetryable = Boolean(
    NON_RETRYABLE_ERROR_CODES.includes(rawErrorMessage) ||
    (errorCode && (errorCode === 403 || NON_RETRYABLE_ERROR_CODES.includes(errorCode)))
  );

  // Sanitize error before recording to prevent storing PII, raw LINE user ID, tokens or passwords
  const sanitizedMessage = sanitizeLogEntry(rawErrorMessage) || "REDACTED_ERROR";

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) return;
    const data = doc.data();
    if (data.claimVersion !== claimVersion) return;

    if (isNonRetryable) {
      transaction.update(docRef, {
        status: "MANUAL_REVIEW_REQUIRED",
        lastAttemptAt: nowTs,
        lastError: { message: sanitizedMessage, time: nowTs }
      });
    } else {
      transaction.update(docRef, {
        status: "RETRYABLE_FAILED",
        lastAttemptAt: nowTs,
        lastError: { message: sanitizedMessage, time: nowTs }
      });
    }
  });

  return { ack: isNonRetryable };
}

/**
 * Build 12-column PROJECTION_LOG row array
 */
function buildProjectionRowData(operation, snapshot) {
  const projectionKey = operation.projectionKey || `PROJECTION_${operation.operationId}`;
  return [
    projectionKey,
    operation.operationId,
    operation.eventId || (snapshot && snapshot.eventId) || "",
    snapshot.reservationNumber,
    snapshot.eventType,
    snapshot.storeId,
    snapshot.quantity,
    snapshot.occurredAt,
    snapshot.pseudonymousActorId,
    snapshot.productCode,
    "JINGYANG_PWA",
    operation.payloadHash || snapshot.payloadHash
  ];
}

module.exports = {
  ALLOWED_EVENT_TYPES,
  NON_RETRYABLE_ERROR_CODES,
  validateAndExtractProjectionSnapshot,
  claimProjectionOperation,
  verifyAuthoritativeLeaseBeforeSheetWrite,
  upsertProjectionLogSheetRow,
  finalizeProjectionSuccess,
  handleProjectionError,
  buildProjectionRowData
};
