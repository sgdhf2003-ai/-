"use strict";

/**
 * Stage 42-G2 Transactional Outbox & Publisher Adapter
 *
 * Implements:
 * 1. stageProjectionOutboxInTransaction: In-transaction atomic outbox staging & idempotency guard.
 * 2. claimOutboxBatchForPublishing: Atomic 60-second publisher lease claim with clock.
 * 3. publishOutboxBatch: Fake Pub/Sub batch publishing with Base64 G1 Application Envelope.
 * 4. markOutboxPublished: Completion fencing on leaseOwner, attemptId, status, and expiration.
 * 5. reconcileOutboxPendingBatch: 5-minute sweep recovering stale PENDING records (> 2 minutes).
 */

const crypto = require("crypto");
const assert = require("assert");
const { Timestamp } = require("firebase-admin/firestore");
const {
  computePayloadHash64,
  serializeCanonicalJson,
  validateApplicationEnvelope,
  ALLOWED_EVENT_TYPES,
  sanitizeLogEntry
} = require("../contracts/projection-contract");

/**
 * Validates payload schema strictly per Stage 42-G1 contract
 */
function validateOutboxPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("INVALID_PAYLOAD: payload must be a plain object");
  }
  const keys = Object.keys(payload);
  const allowedKeys = ["storeId", "productCode", "quantity"];
  for (const k of keys) {
    if (!allowedKeys.includes(k)) {
      throw new Error(`UNAUTHORIZED_PAYLOAD_FIELD: field ${k} is forbidden`);
    }
  }
  const { storeId, productCode, quantity } = payload;
  if (typeof storeId !== "string" || storeId.trim().length === 0) {
    throw new Error("INVALID_PAYLOAD_STORE_ID: storeId must be non-empty string");
  }
  if (typeof productCode !== "string" || productCode.trim().length === 0) {
    throw new Error("INVALID_PAYLOAD_PRODUCT_CODE: productCode must be non-empty string");
  }
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("INVALID_PAYLOAD_QUANTITY: quantity must be positive safe integer");
  }
}

/**
 * Validates operator schema strictly per Stage 42-G1 contract
 */
function validateOutboxOperator(operator) {
  if (!operator || typeof operator !== "object" || Array.isArray(operator)) {
    throw new Error("INVALID_OPERATOR: operator must be a plain object");
  }
  const keys = Object.keys(operator);
  for (const k of keys) {
    if (k !== "pseudonymousActorId") {
      throw new Error(`UNAUTHORIZED_OPERATOR_FIELD: field ${k} is forbidden`);
    }
  }
  const { pseudonymousActorId } = operator;
  if (typeof pseudonymousActorId !== "string" || pseudonymousActorId.trim().length === 0) {
    throw new Error("INVALID_OPERATOR_ACTOR_ID: pseudonymousActorId must be non-empty string");
  }
  if (/@/.test(pseudonymousActorId)) {
    throw new Error("OPERATOR_ACTOR_ID_CONTAINS_EMAIL: pseudonymousActorId contains email");
  }
  if (/^U[0-9a-fA-F]{32}$/.test(pseudonymousActorId)) {
    throw new Error("OPERATOR_ACTOR_ID_CONTAINS_RAW_LINE_ID: pseudonymousActorId contains raw LINE ID");
  }
}

/**
 * Builds and validates the canonical G1 Application Projection Event Envelope.
 * Preserves the exact Outbox eventId generated at creation.
 */
function formatApplicationEnvelope(entry, clock) {
  const occurredAtIso = (entry.occurredAt && typeof entry.occurredAt.toDate === "function")
    ? entry.occurredAt.toDate().toISOString()
    : (typeof entry.occurredAt === "string" ? entry.occurredAt : clock.nowTimestamp().toDate().toISOString());

  const envelope = {
    eventId: entry.eventId,
    schemaVersion: "1.0.0",
    eventType: entry.eventType,
    source: "urn:jingyang:sales:allocation-assistant",
    occurredAt: occurredAtIso,
    operationId: entry.operationId,
    reservationNumber: entry.reservationNumber,
    projectionKey: `PROJECTION_${entry.operationId}`,
    payloadHash: entry.payloadHash,
    payload: entry.payload,
    traceId: entry.traceId || `trace_${entry.operationId}`,
    operator: {
      pseudonymousActorId: entry.operator.pseudonymousActorId
    }
  };

  const validation = validateApplicationEnvelope(envelope);
  if (!validation.valid) {
    throw new Error(`APPLICATION_ENVELOPE_VALIDATION_FAILED: ${validation.errorCode}`);
  }
  return envelope;
}

/**
 * Stages a new projectionOutbox entry within an ongoing Firestore transaction.
 */
async function stageProjectionOutboxInTransaction(transaction, db, params, clock) {
  if (!transaction || typeof transaction.get !== "function") {
    throw new Error("INVALID_TRANSACTION: active Firestore transaction is required");
  }
  if (!db || typeof db.collection !== "function") {
    throw new Error("INVALID_DATABASE: Firestore db client is required");
  }
  if (!params || typeof params !== "object") {
    throw new Error("INVALID_PARAMS: params object is required");
  }
  if (!clock || typeof clock.nowTimestamp !== "function") {
    throw new Error("INVALID_CLOCK: Clock abstraction is required");
  }

  const {
    operationId,
    reservationNumber,
    eventType,
    sourceDocumentPath,
    payload,
    operator,
    traceId
  } = params;

  if (typeof operationId !== "string" || operationId.trim().length === 0) {
    throw new Error("INVALID_OPERATION_ID: operationId must be a non-empty string");
  }
  if (typeof reservationNumber !== "string" || reservationNumber.trim().length === 0) {
    throw new Error("INVALID_RESERVATION_NUMBER: reservationNumber must be a non-empty string");
  }
  if (!ALLOWED_EVENT_TYPES.includes(eventType)) {
    throw new Error(`INVALID_EVENT_TYPE: eventType ${eventType} is not authorized`);
  }
  if (typeof sourceDocumentPath !== "string" || sourceDocumentPath.trim().length === 0) {
    throw new Error("INVALID_SOURCE_DOCUMENT_PATH: sourceDocumentPath must be a non-empty string");
  }

  validateOutboxPayload(payload);
  validateOutboxOperator(operator);

  const payloadHash = computePayloadHash64(payload);
  const outboxRef = db.collection("projectionOutbox").doc(operationId);
  const existingDoc = await transaction.get(outboxRef);

  if (existingDoc.exists) {
    const existingData = existingDoc.data();
    if (existingData.payloadHash !== payloadHash) {
      throw new Error("OUTBOX_IDEMPOTENCY_CONFLICT: payload hash mismatch for existing operationId");
    }
    // Idempotent duplicate: reuse original entry without overwriting or adding docs
    return existingData;
  }

  const eventId = `evt_${crypto.randomUUID()}`;
  const effectiveTraceId = traceId || `trace_${crypto.randomUUID()}`;
  const nowTs = clock.nowTimestamp();

  const outboxEntry = {
    schemaVersion: "1.0.0",
    operationId,
    reservationNumber,
    eventId,
    eventType,
    sourceDocumentPath,
    occurredAt: nowTs,
    payload,
    payloadHash,
    traceId: effectiveTraceId,
    operator: {
      pseudonymousActorId: operator.pseudonymousActorId
    },
    status: "PENDING",
    publishAttempts: 0,
    publishAttemptCount: 0,
    lastError: null,
    publisherLeaseOwner: null,
    publisherLeaseExpiresAt: null,
    publishAttemptId: null,
    publishedMessageId: null,
    createdAt: nowTs,
    lastAttemptAt: null
  };

  transaction.set(outboxRef, outboxEntry);
  return outboxEntry;
}

/**
 * Claims a batch of PENDING outbox records with a 60-second atomic lease.
 */
async function claimOutboxBatchForPublishing(db, publisherInstanceId, options = {}, clock) {
  if (!publisherInstanceId || typeof publisherInstanceId !== "string" || publisherInstanceId.trim().length === 0) {
    throw new Error("INVALID_PUBLISHER_ID: publisherInstanceId must be a non-empty string");
  }
  const batchSize = options.batchSize !== undefined ? options.batchSize : 10;
  if (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > 100) {
    throw new Error("INVALID_BATCH_SIZE: batchSize must be positive integer <= 100");
  }
  if (!clock || typeof clock.nowMillis !== "function") {
    throw new Error("INVALID_CLOCK: Clock abstraction is required");
  }

  const nowMillis = clock.nowMillis();
  const nowTs = clock.nowTimestamp();
  const leaseDurationMs = 60 * 1000;

  const snapshot = await db.collection("projectionOutbox")
    .where("status", "==", "PENDING")
    .limit(batchSize)
    .get();

  const claimed = [];

  for (const doc of snapshot.docs) {
    const claimResult = await db.runTransaction(async (transaction) => {
      const freshDoc = await transaction.get(doc.ref);
      if (!freshDoc.exists) return null;
      const data = freshDoc.data();

      if (data.status !== "PENDING") return null;

      const leaseExpiresAtMillis = data.publisherLeaseExpiresAt ? data.publisherLeaseExpiresAt.toMillis() : 0;
      if (data.publisherLeaseOwner && leaseExpiresAtMillis > nowMillis) {
        // Lease currently held by an active publisher and not expired
        return null;
      }

      const currentAttempts = typeof data.publishAttempts === "number" ? data.publishAttempts : (typeof data.publishAttemptCount === "number" ? data.publishAttemptCount : 0);
      if (currentAttempts < 0 || !Number.isInteger(currentAttempts)) {
        throw new Error("CORRUPTED_OUTBOX_RECORD: publishAttempts must be non-negative integer");
      }

      const newAttempts = currentAttempts + 1;
      const newAttemptId = crypto.randomUUID();
      const newExpiresTs = Timestamp.fromMillis(nowMillis + leaseDurationMs);

      const updateFields = {
        publisherLeaseOwner: publisherInstanceId,
        publisherLeaseExpiresAt: newExpiresTs,
        publishAttemptId: newAttemptId,
        publishAttempts: newAttempts,
        publishAttemptCount: newAttempts,
        lastAttemptAt: nowTs
      };

      transaction.update(doc.ref, updateFields);
      return { ...data, ...updateFields };
    });

    if (claimResult) {
      claimed.push(claimResult);
    }
  }

  return claimed;
}

/**
 * Validates completion fencing and marks the outbox entry as PUBLISHED.
 */
async function markOutboxPublished(db, claimContext, clock) {
  if (!claimContext || typeof claimContext !== "object") {
    return { success: false, errorCode: "INVALID_CLAIM_CONTEXT" };
  }
  const { operationId, eventId, publisherLeaseOwner, publishAttemptId, publishedMessageId } = claimContext;
  if (!operationId || !publisherLeaseOwner || !publishAttemptId) {
    return { success: false, errorCode: "INCOMPLETE_CLAIM_CONTEXT" };
  }

  const outboxRef = db.collection("projectionOutbox").doc(operationId);

  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(outboxRef);
    if (!doc.exists) {
      return { success: false, errorCode: "OUTBOX_NOT_FOUND" };
    }
    const data = doc.data();

    const nowMillis = clock.nowMillis();
    const expiresMillis = data.publisherLeaseExpiresAt ? data.publisherLeaseExpiresAt.toMillis() : 0;

    if (data.status !== "PENDING") {
      return { success: false, errorCode: "ALREADY_PROCESSED" };
    }
    if (data.publisherLeaseOwner !== publisherLeaseOwner) {
      return { success: false, errorCode: "PUBLISH_LEASE_LOST" };
    }
    if (data.publishAttemptId !== publishAttemptId) {
      return { success: false, errorCode: "PUBLISH_ATTEMPT_MISMATCH" };
    }
    if (expiresMillis <= nowMillis) {
      return { success: false, errorCode: "PUBLISH_LEASE_EXPIRED" };
    }
    if (eventId && data.eventId !== eventId) {
      return { success: false, errorCode: "OUTBOX_IDENTITY_MISMATCH" };
    }

    transaction.update(outboxRef, {
      status: "PUBLISHED",
      publishedAt: clock.nowTimestamp(),
      publishedMessageId: publishedMessageId || null,
      lastError: null
    });

    return { success: true };
  });
}

/**
 * Publishes a batch of claimed outbox items to Pub/Sub and applies completion fencing.
 */
async function publishOutboxBatch(db, pubsubClient, publisherInstanceId, clock, claimedItems = null) {
  const items = Array.isArray(claimedItems)
    ? claimedItems
    : await claimOutboxBatchForPublishing(db, publisherInstanceId, { batchSize: 10 }, clock);

  const results = [];

  for (const entry of items) {
    try {
      const envelope = formatApplicationEnvelope(entry, clock);
      const canonicalJson = serializeCanonicalJson(envelope);
      const base64Data = Buffer.from(canonicalJson, "utf8").toString("base64");

      const messageId = await pubsubClient.publish("jy-reservation-events", {
        attributes: {
          schemaVersion: "1.0.0",
          eventType: entry.eventType,
          operationId: entry.operationId,
          eventId: entry.eventId
        },
        data: base64Data
      });

      const markResult = await markOutboxPublished(db, {
        operationId: entry.operationId,
        eventId: entry.eventId,
        publisherLeaseOwner: publisherInstanceId,
        publishAttemptId: entry.publishAttemptId,
        publishedMessageId: messageId
      }, clock);

      results.push({
        operationId: entry.operationId,
        success: markResult.success,
        publishedMessageId: messageId,
        errorCode: markResult.errorCode || null
      });
    } catch (err) {
      const sanitized = sanitizeLogEntry(err.message || String(err));
      try {
        await db.collection("projectionOutbox").doc(entry.operationId).update({
          lastError: sanitized
        });
      } catch (_) {}

      results.push({
        operationId: entry.operationId,
        success: false,
        error: sanitized
      });
    }
  }

  return results;
}

/**
 * Sweeps for stale PENDING outbox records (> 2 minutes) and republishes them.
 */
async function reconcileOutboxPendingBatch(db, pubsubClient, clock, options = {}) {
  const nowMillis = clock.nowMillis();
  const staleThresholdMillis = 2 * 60 * 1000; // 2 minutes
  const reconcilerId = options.reconcilerInstanceId || `reconciler_${crypto.randomUUID()}`;

  const snapshot = await db.collection("projectionOutbox")
    .where("status", "==", "PENDING")
    .get();

  let recoveredCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const refMillis = data.lastAttemptAt
      ? data.lastAttemptAt.toMillis()
      : (data.createdAt ? data.createdAt.toMillis() : 0);

    const elapsed = nowMillis - refMillis;
    if (elapsed < staleThresholdMillis) {
      // Not stale yet
      continue;
    }

    const leaseExpiresAtMillis = data.publisherLeaseExpiresAt ? data.publisherLeaseExpiresAt.toMillis() : 0;
    if (data.publisherLeaseOwner && leaseExpiresAtMillis > nowMillis) {
      // Valid unexpired lease; do not disrupt
      continue;
    }

    // Atomic claim via transaction
    const claimedEntry = await db.runTransaction(async (transaction) => {
      const freshDoc = await transaction.get(doc.ref);
      if (!freshDoc.exists) return null;
      const freshData = freshDoc.data();
      if (freshData.status !== "PENDING") return null;

      const currentExpires = freshData.publisherLeaseExpiresAt ? freshData.publisherLeaseExpiresAt.toMillis() : 0;
      if (freshData.publisherLeaseOwner && currentExpires > nowMillis) return null;

      const currentAttempts = typeof freshData.publishAttempts === "number" ? freshData.publishAttempts : (typeof freshData.publishAttemptCount === "number" ? freshData.publishAttemptCount : 0);
      const newAttempts = currentAttempts + 1;
      const newAttemptId = crypto.randomUUID();
      const newExpiresTs = Timestamp.fromMillis(nowMillis + 60000);

      const updateFields = {
        publisherLeaseOwner: reconcilerId,
        publisherLeaseExpiresAt: newExpiresTs,
        publishAttemptId: newAttemptId,
        publishAttempts: newAttempts,
        publishAttemptCount: newAttempts,
        lastAttemptAt: clock.nowTimestamp()
      };

      transaction.update(doc.ref, updateFields);
      return { ...freshData, ...updateFields };
    });

    if (!claimedEntry) continue;

    try {
      const envelope = formatApplicationEnvelope(claimedEntry, clock);
      const canonicalJson = serializeCanonicalJson(envelope);
      const base64Data = Buffer.from(canonicalJson, "utf8").toString("base64");

      const messageId = await pubsubClient.publish("jy-reservation-events", {
        attributes: {
          schemaVersion: "1.0.0",
          eventType: claimedEntry.eventType,
          operationId: claimedEntry.operationId,
          eventId: claimedEntry.eventId
        },
        data: base64Data
      });

      const markResult = await markOutboxPublished(db, {
        operationId: claimedEntry.operationId,
        eventId: claimedEntry.eventId,
        publisherLeaseOwner: reconcilerId,
        publishAttemptId: claimedEntry.publishAttemptId,
        publishedMessageId: messageId
      }, clock);

      if (markResult.success) {
        recoveredCount++;
      }
    } catch (err) {
      const sanitized = sanitizeLogEntry(err.message || String(err));
      try {
        await db.collection("projectionOutbox").doc(claimedEntry.operationId).update({
          lastError: sanitized
        });
      } catch (_) {}
    }
  }

  return { recoveredCount };
}

module.exports = {
  stageProjectionOutboxInTransaction,
  claimOutboxBatchForPublishing,
  publishOutboxBatch,
  markOutboxPublished,
  reconcileOutboxPendingBatch,
  formatApplicationEnvelope
};
