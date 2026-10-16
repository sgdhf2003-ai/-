/**
 * Stage 42-G4: DLQ Reconciler Adapter & Dead-Letter Handling
 *
 * Architecture & Spec:
 * - Stage 42-F Chapters 6, 11, 14 & Erratum 1
 * - docs/superpowers/plans/2026-09-24-stage-42-g4-dlq-reconciler.md
 *
 * Implements:
 * 1. validateDeadLetterPolicy(policy)
 * 2. parseDlqCloudEvent(cloudEvent)
 * 3. generateAlertIdempotencyKey(operationId, eventId, reasonCode)
 * 4. reconcileDeadLetterDelivery(db, parsedDlqMsg, clock)
 * 5. dispatchPendingDeadLetterAlert(db, alertingClient, claimContext, clock)
 * 6. handleDeadLetterCloudEvent(db, alertingClient, cloudEvent, clock)
 */

const crypto = require("crypto");
const {
  unpackTransportCloudEvent,
  sanitizeLogEntry
} = require("../contracts/projection-contract");

function sanitizeAlertErrorMessage(errMsg) {
  if (errMsg === null || errMsg === undefined) return "";
  let s = String(errMsg);
  // Sanitize via G1 sanitizer first
  s = sanitizeLogEntry(s);
  // Additional regexes for common token and secret patterns: sk-*, ghp_*, Bearer, tokens, emails
  s = s.replace(/\b(?:sk|ghp|gho|pat|xoxb|xoxp)-[A-Za-z0-9_\-]+\b/gi, "[REDACTED_TOKEN]");
  s = s.replace(/\bBearer\s+[A-Za-z0-9_\-\.]+\b/gi, "Bearer [REDACTED]");
  s = s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]");
  s = s.replace(/\bU[0-9a-fA-F]{32,33}\b/g, "[REDACTED_LINE_ID]");
  s = s.replace(/(?:token|secret|key|password|credential|bearer)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{8,})['"]?/gi, "[REDACTED_SECRET]");
  return s;
}

/**
 * Validates declared dead-letter policy on infrastructure
 * Notice: 5 is an approximate threshold from Pub/Sub, not a strict business counter guarantee.
 */
function validateDeadLetterPolicy(policy) {
  if (!policy || typeof policy !== "object") {
    throw new Error("INVALID_DEAD_LETTER_POLICY: Policy configuration object is required");
  }
  if (policy.maxDeliveryAttempts !== 5) {
    throw new Error(`INVALID_DEAD_LETTER_POLICY: maxDeliveryAttempts must be exactly 5, got: ${policy.maxDeliveryAttempts}`);
  }
  return {
    valid: true,
    maxAttempts: 5,
    approximate: true
  };
}

/**
 * Unpacks and strictly validates Eventarc Pub/Sub CloudEvent transporting dead-letter envelope
 * Reuses Stage 42-G1 unpackTransportCloudEvent
 */
function parseDlqCloudEvent(cloudEvent) {
  if (!cloudEvent || typeof cloudEvent !== "object") {
    const err = new Error("REJECT_POISON_MESSAGE: CloudEvent object is required");
    err.code = "POISON_MESSAGE";
    throw err;
  }

  // Use G1 strict unpacker (validates Eventarc type, strict Base64 regex, Fatal UTF-8, Envelope Schema)
  let envelope;
  try {
    envelope = unpackTransportCloudEvent(cloudEvent);
  } catch (err) {
    const poisonErr = new Error(`REJECT_POISON_MESSAGE: Transport unpack failed: ${err.message}`);
    poisonErr.code = "POISON_MESSAGE";
    throw poisonErr;
  }

  // Extract deliveryAttempt if present as a positive integer; strictly null if missing (never default to 5)
  let deliveryAttempt = null;
  const rawDeliveryAttempt = cloudEvent.data && cloudEvent.data.deliveryAttempt;
  if (typeof rawDeliveryAttempt === "number" && Number.isInteger(rawDeliveryAttempt) && rawDeliveryAttempt > 0) {
    deliveryAttempt = rawDeliveryAttempt;
  }

  const publishedMessageId =
    cloudEvent.data && cloudEvent.data.message && typeof cloudEvent.data.message.messageId === "string" && cloudEvent.data.message.messageId.trim() !== ""
      ? cloudEvent.data.message.messageId.trim()
      : null;

  return {
    operationId: envelope.operationId,
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    projectionKey: envelope.projectionKey,
    payloadHash: envelope.payloadHash,
    schemaVersion: envelope.schemaVersion,
    traceId: envelope.traceId,
    occurredAt: envelope.occurredAt,
    operator: envelope.operator,
    publishedMessageId,
    deliveryAttempt,
    envelope
  };
}

/**
 * Generates a deterministic 64-character hex SHA-256 idempotency key for alerting
 * Incorporates operationId, eventId, reasonCode, and optional payloadHash
 */
function generateAlertIdempotencyKey(operationId, eventId, reasonCode, payloadHash = null) {
  const hashSuffix =
    typeof payloadHash === "string" && payloadHash.trim() !== "" ? `:${payloadHash.trim()}` : "";
  const input = `JY_ALERT_IDEMPOTENCY:v1:${operationId}:${eventId}:${reasonCode}${hashSuffix}`;
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

const ALLOWED_ACTIVE_STATES = Object.freeze(["PENDING", "PROCESSING", "RETRYABLE_FAILED"]);
const TERMINAL_STATES = Object.freeze(["SUCCEEDED", "MANUAL_REVIEW_REQUIRED", "DEAD_LETTERED"]);
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

/**
 * Authoritative transactional reconciliation for a dead-letter delivery
 * Evaluates current document state and applies the owner-approved state transition matrix.
 */
async function reconcileDeadLetterDelivery(db, parsedDlqMsg, clock) {
  const { operationId, eventId, payloadHash, publishedMessageId, deliveryAttempt } = parsedDlqMsg;

  if (!operationId) {
    throw new Error("MISSING_OPERATION_ID: parsedDlqMsg.operationId is required");
  }

  const docRef = db.collection("projectionOperations").doc(operationId);
  const nowTs = clock.nowTimestamp();

  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);

    // Case G: Operation not found -> ORPHAN_DLQ_MESSAGE (Do NOT create projectionOperations document)
    if (!doc.exists) {
      return {
        action: "ORPHAN_DLQ_MESSAGE",
        ack: true,
        operationId,
        eventId,
        reasonCode: "ORPHAN_DLQ_MESSAGE",
        needAlert: true
      };
    }

    const docData = doc.data() || {};
    const currentStatus = docData.status;

    // Authoritative identity extraction
    const docOperationId = typeof docData.operationId === "string" ? docData.operationId.trim() : null;
    const docEventId = typeof docData.eventId === "string" ? docData.eventId.trim() : null;
    const docPayloadHash = typeof docData.payloadHash === "string" ? docData.payloadHash.trim() : null;

    const isOperationIdValid = docOperationId !== null && docOperationId === operationId;
    const isEventIdValid = docEventId !== null && docEventId === eventId;
    const isPayloadHashValid = docPayloadHash !== null && SHA256_HEX_REGEX.test(docPayloadHash) && docPayloadHash === payloadHash;

    const isIdentityMatch = isOperationIdValid && isEventIdValid && isPayloadHashValid;

    // Check Terminal States first
    if (TERMINAL_STATES.includes(currentStatus)) {
      if (currentStatus === "SUCCEEDED") {
        if (isIdentityMatch) {
          return {
            action: "IGNORE_SUCCEEDED",
            ack: true,
            operationId,
            eventId,
            status: "SUCCEEDED",
            needAlert: false
          };
        }

        // Terminal state with mismatch or missing identity: 0 mutation, preserve terminal state, send anomaly alert!
        const alertKey = generateAlertIdempotencyKey(operationId, eventId, "TERMINAL_STATE_IDENTITY_MISMATCH");
        return {
          action: "PRESERVE_TERMINAL_STATE",
          ack: true,
          operationId,
          eventId,
          status: "SUCCEEDED",
          needAlert: true,
          reasonCode: "TERMINAL_STATE_IDENTITY_MISMATCH",
          idempotencyKey: alertKey
        };
      }

      if (currentStatus === "MANUAL_REVIEW_REQUIRED") {
        if (isIdentityMatch) {
          return {
            action: "IGNORE_MANUAL_REVIEW",
            ack: true,
            operationId,
            eventId,
            status: "MANUAL_REVIEW_REQUIRED",
            needAlert: false
          };
        }

        // Terminal state with mismatch or missing identity:
        // Check if this delivery is a confirmed redelivery of the exact same active mismatch anomaly!
        const hasValidAnomalyPayloadHash =
          typeof docData.anomalyAlertPayloadHash === "string" &&
          SHA256_HEX_REGEX.test(docData.anomalyAlertPayloadHash);

        const isSameAnomalyRedelivery =
          hasValidAnomalyPayloadHash &&
          docData.anomalyAlertPayloadHash === payloadHash &&
          docData.anomalyAlertEventId === eventId &&
          docData.anomalyAlertReasonCode &&
          docData.anomalyAlertReasonCode === docData.lastErrorCode &&
          typeof docData.anomalyAlertIdempotencyKey === "string" &&
          SHA256_HEX_REGEX.test(docData.anomalyAlertIdempotencyKey);

        if (isSameAnomalyRedelivery) {
          return {
            action: "PRESERVE_TERMINAL_STATE",
            ack: true,
            operationId,
            eventId,
            status: "MANUAL_REVIEW_REQUIRED",
            needAlert: true,
            reasonCode: docData.anomalyAlertReasonCode,
            idempotencyKey: docData.anomalyAlertIdempotencyKey
          };
        }

        // Not confirmed as the same anomaly.
        // Check if it shares the same eventId (content conflict or legacy doc lacking anomalyAlertPayloadHash)
        const isSameEvent = docData.anomalyAlertEventId === eventId;
        const conflictReason = isSameEvent ? "PAYLOAD_CONTENT_CONFLICT" : "TERMINAL_STATE_IDENTITY_MISMATCH";
        const alertKey = isSameEvent
          ? generateAlertIdempotencyKey(operationId, eventId, conflictReason, payloadHash)
          : generateAlertIdempotencyKey(operationId, eventId, conflictReason);

        return {
          action: "PRESERVE_TERMINAL_STATE",
          ack: true,
          operationId,
          eventId,
          status: "MANUAL_REVIEW_REQUIRED",
          needAlert: true,
          reasonCode: conflictReason,
          idempotencyKey: alertKey
        };
      }

      if (currentStatus === "DEAD_LETTERED") {
        // Strict duplicate verification: ALL THREE (operationId, eventId, payloadHash) must be valid and match
        if (isIdentityMatch) {
          if (docData.deadLetterAlertStatus === "SENT") {
            return {
              action: "ALREADY_DEAD_LETTERED",
              ack: true,
              operationId,
              eventId,
              status: "DEAD_LETTERED",
              needAlert: false
            };
          }
          // If alert is PENDING, verify stored deadLetterAlertIdempotencyKey
          const storedKey = docData.deadLetterAlertIdempotencyKey;
          if (typeof storedKey !== "string" || !SHA256_HEX_REGEX.test(storedKey)) {
            // Missing or invalid stored key -> fail closed! Do NOT generate fallback!
            return {
              action: "RETRY_ALERT_PENDING_CORRUPTED",
              ack: false,
              operationId,
              eventId,
              status: "DEAD_LETTERED",
              needAlert: false,
              reasonCode: "CORRUPTED_ALERT_IDEMPOTENCY_KEY",
              error: "CORRUPTED_ALERT_IDEMPOTENCY_KEY: Stored deadLetterAlertIdempotencyKey is missing or invalid"
            };
          }

          // If alert is PENDING, retry sending without updating deadLetteredAt
          return {
            action: "RETRY_ALERT_PENDING",
            ack: true,
            operationId,
            eventId,
            status: "DEAD_LETTERED",
            needAlert: true,
            idempotencyKey: storedKey
          };
        }

        // Terminal state with mismatch or missing identity: 0 mutation, preserve original terminal state!
        const alertKey = generateAlertIdempotencyKey(operationId, eventId, "TERMINAL_STATE_IDENTITY_MISMATCH");
        return {
          action: "PRESERVE_TERMINAL_STATE",
          ack: true,
          operationId,
          eventId,
          status: "DEAD_LETTERED",
          needAlert: true,
          reasonCode: "TERMINAL_STATE_IDENTITY_MISMATCH",
          idempotencyKey: alertKey
        };
      }
    }

    // Check for Active States vs Unknown/Corrupt State
    if (!ALLOWED_ACTIVE_STATES.includes(currentStatus)) {
      // Unknown, missing, or corrupted status: fail-closed!
      // 0 business-state mutation, deterministic sanitized result, never becomes DEAD_LETTERED!
      const alertKey = generateAlertIdempotencyKey(operationId, eventId, "UNKNOWN_OR_CORRUPT_STATUS");
      return {
        action: "CORRUPT_OR_UNKNOWN_STATUS_REJECTED",
        ack: true,
        operationId,
        eventId,
        status: currentStatus,
        reasonCode: "UNKNOWN_OR_CORRUPT_STATUS",
        needAlert: true,
        idempotencyKey: alertKey
      };
    }

    // Active State identity validation:
    // If any of operationId, eventId, payloadHash is missing or mismatches:
    // Move to MANUAL_REVIEW_REQUIRED, preserve existing snapshot, clear leases!
    if (!isIdentityMatch) {
      let mismatchCode = "AUTHORITATIVE_IDENTITY_MISMATCH";
      if (!isOperationIdValid) mismatchCode = "OPERATION_ID_MISMATCH";
      else if (!isEventIdValid) mismatchCode = "EVENT_ID_MISMATCH";
      else if (!isPayloadHashValid) mismatchCode = "PAYLOAD_HASH_MISMATCH";

      const alertKey = generateAlertIdempotencyKey(operationId, eventId, mismatchCode);

      transaction.update(docRef, {
        status: "MANUAL_REVIEW_REQUIRED",
        lastAttemptAt: nowTs,
        lastErrorCode: mismatchCode,
        anomalyAlertIdempotencyKey: alertKey,
        anomalyAlertReasonCode: mismatchCode,
        anomalyAlertEventId: eventId,
        anomalyAlertPayloadHash: payloadHash,
        leaseOwner: null,
        leaseExpiresAt: null
      });

      return {
        action: "MANUAL_REVIEW_REQUIRED",
        ack: true,
        operationId,
        eventId,
        reasonCode: mismatchCode,
        needAlert: true,
        idempotencyKey: alertKey
      };
    }

    // Valid active state (PENDING, PROCESSING, RETRYABLE_FAILED) with matching identity -> DEAD_LETTERED
    const idempotencyKey = generateAlertIdempotencyKey(operationId, eventId, "MAX_DELIVERY_ATTEMPTS_EXCEEDED");

    const updatePayload = {
      status: "DEAD_LETTERED",
      deadLetteredAt: nowTs,
      deadLetterMessageId: publishedMessageId,
      deliveryAttempt: deliveryAttempt !== undefined ? deliveryAttempt : null,
      deadLetterReason: "MAX_DELIVERY_ATTEMPTS_EXCEEDED",
      deadLetterAlertStatus: "PENDING",
      deadLetterAlertIdempotencyKey: idempotencyKey,
      lastAttemptAt: nowTs,
      leaseOwner: null,
      leaseExpiresAt: null
    };

    transaction.update(docRef, updatePayload);

    return {
      action: "DEAD_LETTERED",
      ack: true,
      operationId,
      eventId,
      status: "DEAD_LETTERED",
      needAlert: true,
      idempotencyKey
    };
  });
}

/**
 * Dispatches alert strictly AFTER Firestore transaction commits, then updates alertStatus to SENT
 */
async function dispatchPendingDeadLetterAlert(db, alertingClient, claimContext, clock) {
  if (!claimContext || !claimContext.needAlert) {
    return { sent: false, ack: true, alertAction: "SKIPPED" };
  }

  if (!claimContext.idempotencyKey || typeof claimContext.idempotencyKey !== "string" || !/^[a-f0-9]{64}$/.test(claimContext.idempotencyKey)) {
    return {
      sent: false,
      ack: false,
      alertAction: "RETRY_ALERT",
      error: "MISSING_ALERT_IDEMPOTENCY_KEY: Alert-required claim omitted valid deterministic idempotencyKey"
    };
  }

  if (!alertingClient) {
    return {
      sent: false,
      ack: false,
      alertAction: "RETRY_ALERT",
      error: "MISSING_ALERTING_CLIENT: Alert dispatch required but alertingClient is missing"
    };
  }

  const { operationId, eventId, idempotencyKey } = claimContext;

  // Prepare sanitized alert payload with dynamic, accurate message text
  let alertMessageText;
  if (claimContext.action === "DEAD_LETTERED" || claimContext.action === "RETRY_ALERT_PENDING") {
    alertMessageText = `[DLQ_P1_ALERT] Operation ${operationId} reached DEAD_LETTERED state`;
  } else if (
    claimContext.action === "MANUAL_REVIEW_REQUIRED" ||
    claimContext.reasonCode === "AUTHORITATIVE_IDENTITY_MISMATCH" ||
    claimContext.reasonCode === "OPERATION_ID_MISMATCH" ||
    claimContext.reasonCode === "EVENT_ID_MISMATCH" ||
    claimContext.reasonCode === "PAYLOAD_HASH_MISMATCH"
  ) {
    alertMessageText = `[DLQ_ANOMALY_ALERT] Operation ${operationId} identity mismatch transitioned to MANUAL_REVIEW_REQUIRED (${claimContext.reasonCode || claimContext.action})`;
  } else if (claimContext.reasonCode === "TERMINAL_STATE_IDENTITY_MISMATCH") {
    alertMessageText = `[DLQ_ANOMALY_ALERT] Operation ${operationId} terminal state identity mismatch preserved (${claimContext.status})`;
  } else if (claimContext.reasonCode === "PAYLOAD_CONTENT_CONFLICT") {
    alertMessageText = `[DLQ_ANOMALY_ALERT] Operation ${operationId} payload content conflict detected for terminal state (${claimContext.status})`;
  } else if (claimContext.action === "CORRUPT_OR_UNKNOWN_STATUS_REJECTED" || claimContext.reasonCode === "UNKNOWN_OR_CORRUPT_STATUS") {
    alertMessageText = `[DLQ_ANOMALY_ALERT] Operation ${operationId} corrupt or unknown status rejected`;
  } else if (claimContext.action === "ORPHAN_DLQ_MESSAGE" || claimContext.reasonCode === "ORPHAN_DLQ_MESSAGE") {
    alertMessageText = `[ORPHAN_DLQ_MESSAGE] DLQ received for nonexistent operation: ${operationId}`;
  } else {
    alertMessageText = `[DLQ_ANOMALY_ALERT] Operation ${operationId} anomaly detected (${claimContext.reasonCode || claimContext.action})`;
  }

  const alertPayload = {
    idempotencyKey,
    severity: "P1",
    reasonCode: claimContext.reasonCode || "MAX_DELIVERY_ATTEMPTS_EXCEEDED",
    operationId,
    eventId,
    message: sanitizeLogEntry(alertMessageText)
  };

  // Dispatch alert to adapter
  let alertResult;
  try {
    alertResult = await alertingClient.sendAlert(alertPayload);
  } catch (err) {
    // Transient failure: leave status as PENDING in Firestore; signal caller to retry
    return {
      sent: false,
      ack: false,
      alertAction: "RETRY_ALERT",
      error: sanitizeAlertErrorMessage(err.message)
    };
  }

  // Update alert status to SENT in an independent transaction ONLY for DEAD_LETTERED records
  // For anomalies with 0 mutation (e.g. PRESERVE_TERMINAL_STATE, CORRUPT_OR_UNKNOWN_STATUS_REJECTED),
  // external adapter idempotency is authoritative; do NOT write bookkeeping into protected records!
  const isDeadLetterAction = claimContext.action === "DEAD_LETTERED" || claimContext.action === "RETRY_ALERT_PENDING";
  if (operationId && isDeadLetterAction) {
    try {
      const docRef = db.collection("projectionOperations").doc(operationId);
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        if (!doc.exists) {
          throw new Error("OPERATION_NOT_FOUND");
        }
        const data = doc.data() || {};
        if (data.deadLetterAlertIdempotencyKey !== idempotencyKey) {
          throw new Error("ALERT_IDEMPOTENCY_KEY_MISMATCH");
        }
        if (data.deadLetterAlertStatus === "SENT") {
          // Already finalized idempotently
          return;
        }
        if (data.deadLetterAlertStatus === "PENDING") {
          transaction.update(docRef, {
            deadLetterAlertStatus: "SENT",
            deadLetterAlertSentAt: clock.nowTimestamp()
          });
          return;
        }
        throw new Error(`INVALID_ALERT_STATUS_FOR_FINALIZATION: ${data.deadLetterAlertStatus}`);
      });
    } catch (err) {
      // If finalization transaction fails, NACK so redelivery retries and completes finalization!
      return {
        sent: alertResult.sent,
        dedup: alertResult.dedup,
        ack: false,
        alertAction: "FINALIZATION_FAILED",
        error: sanitizeAlertErrorMessage(`ALERT_SENT_FINALIZATION_FAILED: ${err.message}`)
      };
    }
  }

  return {
    sent: alertResult.sent,
    dedup: alertResult.dedup,
    ack: true,
    alertAction: "SENT"
  };
}

/**
 * Top-level CloudEvent handler for DLQ Reconciler service
 */
async function handleDeadLetterCloudEvent(db, alertingClient, cloudEvent, clock) {
  let parsed;
  try {
    parsed = parseDlqCloudEvent(cloudEvent);
  } catch (err) {
    // Poison message: return ACK to prevent infinite loop, log sanitized error
    return {
      action: "REJECT_POISON_MESSAGE",
      ack: true,
      reasonCode: err.code || "POISON_MESSAGE",
      alertAction: "SKIPPED",
      error: sanitizeAlertErrorMessage(err.message)
    };
  }

  let claimContext;
  try {
    claimContext = await reconcileDeadLetterDelivery(db, parsed, clock);
  } catch (err) {
    // Firestore transient error: NACK so Pub/Sub can retry
    return {
      action: "RETRY",
      ack: false,
      reasonCode: "FIRESTORE_TRANSIENT_FAILURE",
      alertAction: "SKIPPED",
      error: sanitizeAlertErrorMessage(err.message)
    };
  }

  // Special handling for orphan message
  if (claimContext.action === "ORPHAN_DLQ_MESSAGE") {
    if (!alertingClient) {
      return {
        action: "ORPHAN_DLQ_MESSAGE",
        ack: false,
        operationId: parsed.operationId,
        eventId: parsed.eventId,
        reasonCode: "ORPHAN_DLQ_MESSAGE",
        alertAction: "RETRY_ALERT",
        error: "MISSING_ALERTING_CLIENT: Alert required for orphan DLQ message"
      };
    }

    const orphanKey = generateAlertIdempotencyKey(parsed.operationId, parsed.eventId, "ORPHAN_DLQ_MESSAGE");
    try {
      await alertingClient.sendAlert({
        idempotencyKey: orphanKey,
        severity: "P1",
        reasonCode: "ORPHAN_DLQ_MESSAGE",
        operationId: parsed.operationId,
        eventId: parsed.eventId,
        message: sanitizeLogEntry(`[ORPHAN_DLQ_MESSAGE] DLQ received for nonexistent operation: ${parsed.operationId}`)
      });
    } catch (err) {
      return {
        action: "ORPHAN_DLQ_MESSAGE",
        ack: false,
        operationId: parsed.operationId,
        eventId: parsed.eventId,
        reasonCode: "ORPHAN_DLQ_MESSAGE",
        alertAction: "RETRY_ALERT",
        error: sanitizeAlertErrorMessage(err.message)
      };
    }

    return {
      action: "ORPHAN_DLQ_MESSAGE",
      ack: true,
      operationId: parsed.operationId,
      eventId: parsed.eventId,
      reasonCode: "ORPHAN_DLQ_MESSAGE",
      alertAction: "SENT"
    };
  }

  // Handle alert dispatch if needed
  let alertOutcome = { alertAction: "SKIPPED", ack: true };
  if (claimContext.needAlert) {
    if (!alertingClient) {
      return {
        action: claimContext.action,
        ack: false,
        operationId: parsed.operationId,
        eventId: parsed.eventId,
        status: claimContext.status,
        reasonCode: claimContext.reasonCode || claimContext.action,
        alertAction: "RETRY_ALERT",
        error: "MISSING_ALERTING_CLIENT: Alert dispatch required but alertingClient is missing"
      };
    }
    alertOutcome = await dispatchPendingDeadLetterAlert(db, alertingClient, claimContext, clock);
  }

  const finalAck = Boolean(claimContext.ack && alertOutcome.ack);

  let finalAction = claimContext.action;
  if (finalAction === "RETRY_ALERT_PENDING" && alertOutcome.alertAction === "SENT") {
    finalAction = "ALREADY_DEAD_LETTERED";
  }

  return {
    action: finalAction,
    ack: finalAck,
    operationId: parsed.operationId,
    eventId: parsed.eventId,
    status: claimContext.status,
    reasonCode: claimContext.reasonCode || claimContext.action,
    alertAction: alertOutcome.alertAction,
    idempotencyKey: claimContext.idempotencyKey,
    error: alertOutcome.error
      ? sanitizeAlertErrorMessage(alertOutcome.error)
      : claimContext.error
      ? sanitizeAlertErrorMessage(claimContext.error)
      : undefined
  };
}

module.exports = {
  validateDeadLetterPolicy,
  parseDlqCloudEvent,
  generateAlertIdempotencyKey,
  reconcileDeadLetterDelivery,
  dispatchPendingDeadLetterAlert,
  handleDeadLetterCloudEvent
};
