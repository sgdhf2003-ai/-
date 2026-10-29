/**
 * Stage 42-G6: Unified Projection Engine
 *
 * Facade coordinating:
 * - G1: Projection Contract & Canonical JSON / SHA-256 Hashing
 * - G2: Outbox Staging & Publishing Adapter
 * - G3: Projection Worker Pipeline & Authoritative Pre-write Verification
 * - G4: DLQ Eventarc CloudEvent Reconciler & Worker Fencing
 * - G5: Audit Self-Healing, Compensating Reversal & Retention Pruning
 */

"use strict";

const {
  validateAllocationPayload,
  buildApplicationEnvelope,
  computePayloadHash64,
  serializeCanonicalJson,
  createFakeClock,
  getProductionClock,
  unpackTransportCloudEvent,
  validateApplicationEnvelope,
  sanitizeLogEntry
} = require("../contracts/projection-contract");

const {
  stageProjectionOutboxInTransaction,
  claimOutboxBatchForPublishing,
  publishOutboxBatch,
  markOutboxPublished,
  reconcileOutboxPendingBatch,
  formatApplicationEnvelope
} = require("../adapters/outbox-publisher-adapter");

const {
  validateAndExtractProjectionSnapshot,
  claimProjectionOperation,
  verifyAuthoritativeLeaseBeforeSheetWrite,
  upsertProjectionLogSheetRow,
  finalizeProjectionSuccess,
  handleProjectionError,
  buildProjectionRowData
} = require("../services/projection-worker-service");

const {
  validateDeadLetterPolicy,
  parseDlqCloudEvent,
  generateAlertIdempotencyKey,
  reconcileDeadLetterDelivery,
  dispatchPendingDeadLetterAlert,
  handleDeadLetterCloudEvent
} = require("../adapters/dlq-reconciler-adapter");

const {
  scanSucceededProjectionOperations,
  claimReconciliationLease,
  markManualReviewUnderReconciliationLease,
  releaseReconciliationLease,
  reconcileProjectionRow,
  reconcileCompensatingTransaction,
  pruneExpiredSnapshotsAndTombstones
} = require("../adapters/projection-reconciler-adapter");

class ProjectionEngine {
  constructor(options = {}) {
    const firestoreDb = options.firestoreDb || options.db;
    if (!firestoreDb) {
      throw new Error("FAIL_CLOSED_ENGINE_INIT: firestoreDb is required");
    }

    this.firestoreDb = firestoreDb;
    this.sheetsClient = options.sheetsClient || null;
    this.pubsubClient = options.pubsubClient || null;
    this.alertingClient = options.alertingClient || null;
    this.clock = options.clock || getProductionClock();
    this.topic = options.topic || "projects/demo-jy-stage42/topics/projection-events";
    this.engineId = options.engineId || `ENGINE_${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * 1. Transactional Staging: Stage an event envelope atomically inside a business Firestore transaction.
   */
  async stageOutbox(transaction, envelopeData, options = {}) {
    if (!transaction) {
      throw new Error("FAIL_CLOSED_ENGINE_STAGE: transaction is required for atomic outbox staging");
    }
    const params = {
      ...envelopeData,
      sourceDocumentPath: options.sourceDocumentPath || envelopeData.sourceDocumentPath || `reservations/${envelopeData.reservationNumber || envelopeData.operationId}`
    };
    return await stageProjectionOutboxInTransaction(
      transaction,
      this.firestoreDb,
      params,
      this.clock
    );
  }

  /**
   * 2. Outbox Dispatcher: Claim and publish pending outbox entries to PubSub / Eventarc.
   */
  async dispatchOutboxBatch(options = {}) {
    if (!this.pubsubClient) {
      throw new Error("FAIL_CLOSED_ENGINE_DISPATCH: pubsubClient is required to dispatch outbox entries");
    }
    const publisherId = options.publisherId || this.engineId;
    const batchSize = options.batchSize || 10;
    const claimed = await claimOutboxBatchForPublishing(
      this.firestoreDb,
      publisherId,
      { batchSize },
      this.clock
    );

    if (!claimed || claimed.length === 0) {
      return { publishedCount: 0, results: [] };
    }

    const publishResults = await publishOutboxBatch(
      this.firestoreDb,
      this.pubsubClient,
      publisherId,
      this.clock,
      claimed
    );

    const publishedCount = publishResults.filter((r) => r.success).length;
    return { publishedCount, results: publishResults };
  }

  /**
   * 3. Projection Worker Intake: Normal projection event processing pipeline.
   */
  async processProjectionEvent(cloudEvent, options = {}) {
    if (!this.sheetsClient) {
      throw new Error("FAIL_CLOSED_ENGINE_WORKER: sheetsClient is required to process projection event");
    }
    const workerId = options.workerId || this.engineId;

    let envelope = cloudEvent;
    if (cloudEvent && cloudEvent.data && typeof cloudEvent.data === "string" && cloudEvent.specversion) {
      envelope = unpackTransportCloudEvent(cloudEvent);
    }

    // 1. Claim operation in Firestore
    const claimRes = await claimProjectionOperation(this.firestoreDb, envelope, workerId, this.clock);
    const operationId = envelope && envelope.operationId ? envelope.operationId.trim() : null;

    if (claimRes.action === "SKIP_ACK") {
      return { status: "ACK", outcome: claimRes.reason || "SKIP_ACK", operationId };
    }
    if (claimRes.action === "CONFLICT") {
      return { status: "ACK", outcome: claimRes.errorCode || "CONFLICT", operationId };
    }
    if (claimRes.action === "REJECT_MALFORMED" || claimRes.action === "REJECT_INVALID_DUPLICATE") {
      return { status: "ACK", outcome: claimRes.errorCode || claimRes.action, operationId };
    }
    if (claimRes.action !== "PROCEED") {
      return { status: "NACK", outcome: claimRes.action, operationId };
    }

    const claimVersion = claimRes.claimVersion;

    try {
      // 2. Validate application envelope contract (including computed payloadHash verification)
      const envelopeValidation = validateApplicationEnvelope(envelope);
      if (!envelopeValidation.valid) {
        const err = new Error(envelopeValidation.errorCode || "INVALID_ENVELOPE");
        err.code = envelopeValidation.errorCode;
        throw err;
      }

      // 3. Erratum 1 fail-closed snapshot extraction
      const validation = validateAndExtractProjectionSnapshot(envelope);
      if (!validation.valid) {
        throw new Error(validation.errorCode || "INVALID_SNAPSHOT");
      }
      const snapshot = validation.snapshot;

      // 4. Pre-write authoritative lease verification
      const leaseCheck = await verifyAuthoritativeLeaseBeforeSheetWrite(
        this.firestoreDb,
        operationId,
        claimVersion,
        workerId,
        this.clock
      );
      if (!leaseCheck.valid) {
        throw new Error(leaseCheck.errorCode || "LEASE_INVALID");
      }

      // 4. Build 12-column row data and upsert to Google Sheets
      const rowData = buildProjectionRowData({ operationId, ...envelope }, snapshot);
      await upsertProjectionLogSheetRow(this.sheetsClient, rowData, operationId);

      // 5. Finalize Firestore operation as SUCCEEDED
      await finalizeProjectionSuccess(
        this.firestoreDb,
        operationId,
        claimVersion,
        workerId,
        this.clock
      );

      return { status: "ACK", outcome: "PROJECTION_SUCCEEDED", operationId };
    } catch (err) {
      const errorResult = await handleProjectionError(
        this.firestoreDb,
        operationId,
        claimVersion,
        err,
        this.clock
      );
      return {
        status: errorResult.ack ? "ACK" : "NACK",
        outcome: errorResult.ack ? "MANUAL_REVIEW_REQUIRED" : "RETRYABLE_FAILED",
        operationId,
        error: err.message
      };
    }
  }

  /**
   * 4. Dead-Letter Event Intake: Process DLQ events, fence workers, and emit sanitized alerts.
   */
  async processDeadLetterEvent(cloudEvent, options = {}) {
    return await handleDeadLetterCloudEvent(
      this.firestoreDb,
      this.alertingClient,
      cloudEvent,
      this.clock
    );
  }

  /**
   * 5. Audit & Self-Healing Cycle: Scan succeeded operations and restore missing sheet rows from snapshots.
   */
  async runAuditReconciliationCycle(options = {}) {
    if (!this.sheetsClient) {
      throw new Error("FAIL_CLOSED_ENGINE_RECONCILER: sheetsClient is required to run audit reconciliation");
    }
    const reconcilerId = options.reconcilerId || this.engineId;
    const batchSize = options.batchSize || 50;

    const scanRes = await scanSucceededProjectionOperations(this.firestoreDb, {
      batchSize,
      cursor: options.cursor
    });
    const results = [];

    for (const op of scanRes.operations) {
      const opId = op.operationId;
      try {
        const reconRes = await reconcileProjectionRow(
          this.firestoreDb,
          this.sheetsClient,
          opId,
          reconcilerId,
          this.clock
        );
        results.push({
          operationId: opId,
          status: (reconRes.outcome === "REPAIRED" || reconRes.outcome === "MATCH") ? "RECONCILED" : reconRes.outcome,
          outcome: reconRes.outcome,
          reason: reconRes.reason
        });
      } catch (err) {
        results.push({ operationId: opId, status: "ERROR", error: err.message });
      }
    }

    return {
      reconciledCount: results.filter((r) => r.status === "RECONCILED").length,
      nextCursor: scanRes.nextCursor,
      details: results
    };
  }

  /**
   * 6. Compensating Transaction: Idempotently append negative offset rows for FULFILLMENT_REVERSAL.
   */
  async executeCompensationReversal(reversalData, options = {}) {
    if (!this.sheetsClient) {
      throw new Error("FAIL_CLOSED_ENGINE_COMPENSATION: sheetsClient is required for compensation");
    }
    const reconcilerId = options.reconcilerId || this.engineId;
    return await reconcileCompensatingTransaction(
      this.firestoreDb,
      this.sheetsClient,
      reversalData,
      reconcilerId,
      this.clock
    );
  }

  /**
   * 7. Retention Pruning: Delete snapshots older than 90 days and tombstone records older than 400 days.
   */
  async runRetentionPruning() {
    return await pruneExpiredSnapshotsAndTombstones(this.firestoreDb, this.clock);
  }
}

function createProjectionEngine(options = {}) {
  return new ProjectionEngine(options);
}

module.exports = {
  ProjectionEngine,
  createProjectionEngine
};
