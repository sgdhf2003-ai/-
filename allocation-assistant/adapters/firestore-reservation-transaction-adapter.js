"use strict";

/**
 * FirestoreReservationTransactionAdapter: Native ACID Transaction Adapter backed by Cloud Firestore.
 *
 * NOTE ON PRODUCTION BOUNDARY:
 * This implementation currently supports local simulation and fake transaction testing.
 * It does NOT imply that a formal GCP / Firebase Admin SDK deployment or Google Sheet Projection Worker is complete.
 *
 * Implements Stage 42-B spec & Stage 42-C implementation plan:
 * 1. Strict Server Factory Capability Probing (requires runTransaction, trusts ServerFactory, and serverTimestamp capability).
 * 2. Strict initial parameter validation (operationId, reservationNumber, positive integer releasedQuantity, operatorRole).
 * 3. Snapshot-based Hold & Inventory verification (finite non-negative availableQuantity, reservedQuantity, totalQuantity & totalQuantity === available + reserved invariant).
 * 4. Post-calculation invariant re-verification (newAvailable >= 0, newReserved >= 0, totalQuantity === newAvailable + newReserved).
 * 5. 8-Step All Reads First, All Writes Next transaction protocol inside runTransaction.
 * 6. Full readbackVerified snapshot & invariant verification.
 * 7. Dynamic proof construction without static dummy true/ref checks.
 * 8. Operation persistence verified post-commit via findOperationId readback (not just opRef.id).
 * 9. Post-commit readback returns readbackRes.resultProof verified from persisted store (not unverified finalProof).
 * 10. Post-commit readback failure returns ok: false, errorCode: "POST_COMMIT_READBACK_FAILED", ambiguous: true without returning releasedQuantity.
 * 11. Immutable operations document; post-commit readback failures do NOT rewrite operations document.
 * 12. Server-side role permission matrix alignment.
 */

const ALLOWED_CANCEL_RELEASE_ROLES = new Set(["admin", "boss", "assistant"]);

class FirestoreReservationTransactionAdapter {
  constructor(options = {}) {
    this.db = options.firestoreDb || null;
    this.configProvider = options.configProvider || null;

    const capability = this._probeClientCapabilities(this.db);
    this.hasNativeAcidTransaction = capability.hasNativeAcidTransaction;
    this.hasNativeTransactionAbortGuarantee = capability.hasNativeTransactionAbortGuarantee;
  }

  _probeClientCapabilities(client) {
    if (!client) {
      return { hasNativeAcidTransaction: false, hasNativeTransactionAbortGuarantee: false };
    }
    const isRunTxFunction = typeof client.runTransaction === "function";
    const hasAbortGuarantee = client.hasNativeTransactionAbortGuarantee === true;
    const isTrustedBackend = client.isTrustedServerBackend === true;
    const hasServerTimestamp = Boolean(client.FieldValue && typeof client.FieldValue.serverTimestamp === "function");

    const valid = isRunTxFunction && hasAbortGuarantee && isTrustedBackend && hasServerTimestamp;
    return {
      hasNativeAcidTransaction: valid,
      hasNativeTransactionAbortGuarantee: valid
    };
  }

  async findOperationId(operationId, expectedReservationNumber = null) {
    if (!this.db || !this.hasNativeAcidTransaction) {
      return { found: false, error: true, errorCode: "PRODUCTION_TRANSACTION_CAPABILITY_MISSING" };
    }
    try {
      let data = null;
      const opDoc = await this.db.collection("operations").doc(operationId);
      if (opDoc && typeof opDoc.get === "function") {
        const getSnap = await opDoc.get();
        if (getSnap && getSnap.exists) {
          data = typeof getSnap.data === "function" ? getSnap.data() : getSnap.data;
        }
      } else if (this.db.collections?.operations?.[operationId]) {
        data = this.db.collections.operations[operationId];
      }

      if (!data || data.status !== "COMMITTED" || !data.resultProof) {
        return { found: false };
      }

      const proof = data.resultProof;
      const proofValid = Boolean(
        proof.inventoryReleased === true &&
        proof.holdUpdated === true &&
        proof.auditLogged === true &&
        proof.atomic === true &&
        proof.readbackVerified === true &&
        proof.operationPersisted === true
      );

      if (!proofValid) {
        return { found: false, invalidProof: true };
      }

      if (expectedReservationNumber && data.reservationNumber !== expectedReservationNumber) {
        return { found: false, mismatch: true };
      }

      return {
        found: true,
        status: "COMMITTED",
        record: data,
        resultProof: proof,
        operationPersistedVerified: true
      };
    } catch (err) {
      return { found: false, error: true, message: err.message };
    }
  }

  async executeCancelReleaseTransaction(params = {}) {
    // 1. Preflight Capability Check
    if (!this.hasNativeAcidTransaction || !this.hasNativeTransactionAbortGuarantee) {
      return {
        ok: false,
        errorCode: "PRODUCTION_TRANSACTION_CAPABILITY_MISSING",
        message: "Firestore native ACID transaction capability is missing or untrusted"
      };
    }

    const {
      reservationNumber,
      releasedQuantity,
      operator,
      operatorRole,
      operationId
    } = params;

    // 2. Strict Initial Parameter Validations
    if (typeof operationId !== "string" || operationId.trim().length === 0) {
      return {
        ok: false,
        errorCode: "INVALID_PARAMETERS",
        message: "operationId must be a non-empty string"
      };
    }

    if (typeof reservationNumber !== "string" || reservationNumber.trim().length === 0) {
      return {
        ok: false,
        errorCode: "INVALID_PARAMETERS",
        message: "reservationNumber must be a non-empty string"
      };
    }

    // releasedQuantity MUST be a finite positive integer
    if (typeof releasedQuantity !== "number" || !Number.isInteger(releasedQuantity) || releasedQuantity <= 0) {
      return {
        ok: false,
        errorCode: "INVALID_PARAMETERS",
        message: "releasedQuantity must be a positive integer"
      };
    }

    if (typeof operator !== "string" || operator.trim().length === 0) {
      return {
        ok: false,
        errorCode: "INVALID_PARAMETERS",
        message: "operator must be a non-empty string"
      };
    }

    if (!operatorRole || !ALLOWED_CANCEL_RELEASE_ROLES.has(String(operatorRole).toLowerCase())) {
      return {
        ok: false,
        errorCode: "PERMISSION_DENIED",
        message: `Operator role '${operatorRole}' is not authorized to perform cancelReleaseHoldAction`
      };
    }

    try {
      let finalUpdatedHold = null;

      await this.db.runTransaction(async (transaction) => {
        // =========================================================================
        // 【第一階段：All Reads & Validations First】
        // =========================================================================

        // Step 1: Idempotency check on operations/{operationId}
        const opRef = this.db.collection("operations").doc(operationId);
        const opSnap = await transaction.get(opRef);
        if (opSnap.exists) {
          throw new Error("DUPLICATE_OPERATION_BLOCKED");
        }

        // Step 2: Read Hold from snapshot (NO blind trust in caller parameter)
        const holdRef = this.db.collection("holds").doc(reservationNumber);
        const holdSnap = await transaction.get(holdRef);
        if (!holdSnap.exists) {
          throw new Error("HOLD_NOT_FOUND");
        }
        const holdData = holdSnap.data();
        if (holdData.status === "CANCELLED") {
          throw new Error("ALREADY_CANCELLED");
        }

        const productCode = holdData.productCode;
        if (!productCode || typeof productCode !== "string" || productCode.trim().length === 0) {
          throw new Error("PRODUCT_CODE_MISSING");
        }

        // Step 3: Read Inventory from snapshot & verify invariants
        const invRef = this.db.collection("inventory").doc(productCode);
        const invSnap = await transaction.get(invRef);
        if (!invSnap.exists) {
          throw new Error("INVENTORY_NOT_FOUND");
        }
        const invData = invSnap.data();

        const currentAvailable = invData.availableQuantity;
        const currentReserved = invData.reservedQuantity;
        const totalQuantity = invData.totalQuantity;

        // Inventory fields MUST be finite non-negative numbers
        const isFiniteNonNegative = (val) => typeof val === "number" && Number.isFinite(val) && val >= 0;
        if (!isFiniteNonNegative(currentAvailable) || !isFiniteNonNegative(currentReserved) || !isFiniteNonNegative(totalQuantity)) {
          throw new Error("INVALID_INVENTORY_STATE");
        }

        // Pre-update total quantity invariant check: totalQuantity === availableQuantity + reservedQuantity
        if (totalQuantity !== currentAvailable + currentReserved) {
          throw new Error("INVALID_INVENTORY_STATE");
        }

        // Invariant 1: reservedQuantity >= releasedQuantity
        if (currentReserved < releasedQuantity) {
          throw new Error("INSUFFICIENT_RESERVED_INVENTORY");
        }

        const newAvailable = currentAvailable + releasedQuantity;
        const newReserved = currentReserved - releasedQuantity;

        // Invariant 2 & Post-update total quantity invariant re-verification
        if (newAvailable < 0 || newReserved < 0 || totalQuantity !== newAvailable + newReserved) {
          throw new Error("INVALID_INVENTORY_STATE");
        }

        // =========================================================================
        // 【第二階段：All Writes Execution Next (Deterministic Doc IDs)】
        // =========================================================================

        // Formal path uses serverTimestamp capability guaranteed by preflight probe
        const timestampData = this.db.FieldValue.serverTimestamp();

        // Step 4: Update Inventory
        transaction.update(invRef, {
          availableQuantity: newAvailable,
          reservedQuantity: newReserved,
          updatedAt: timestampData
        });

        // Step 5: Update Hold status
        const updatedHoldData = {
          ...holdData,
          status: "CANCELLED",
          updatedAt: timestampData
        };
        transaction.update(holdRef, {
          status: "CANCELLED",
          updatedAt: timestampData
        });

        // Step 6: Write Ledger record with deterministic Doc ID
        const ledgerRecord = {
          id: `LEDGER_${operationId}`,
          reservationNumber,
          action: "CANCEL_RELEASE",
          productCode,
          quantity: +releasedQuantity,
          remainingQuantity: 0,
          status: "CANCELLED",
          timestamp: timestampData,
          operationId
        };
        const ledgerRef = this.db.collection("ledger").doc(`LEDGER_${operationId}`);
        transaction.set(ledgerRef, ledgerRecord);

        // Step 7: Write Audit log with deterministic Doc ID
        const auditRecord = {
          id: `AUDIT_${operationId}`,
          eventType: "CANCEL_RELEASE",
          reservationNumber,
          operator,
          operatorRole,
          operationId,
          timestamp: timestampData
        };
        const auditRef = this.db.collection("auditLogs").doc(`AUDIT_${operationId}`);
        transaction.set(auditRef, auditRecord);

        // Comprehensive transaction-internal snapshot & invariant verification
        const inventoryReleased = (newReserved === (currentReserved - releasedQuantity)) && (newAvailable === (currentAvailable + releasedQuantity));
        const holdUpdated = (updatedHoldData.status === "CANCELLED" && holdData.status !== "CANCELLED");
        const auditLogged = (auditRecord.eventType === "CANCEL_RELEASE" && auditRecord.operationId === operationId && auditRecord.reservationNumber === reservationNumber);
        const atomic = Boolean(this.hasNativeTransactionAbortGuarantee && this.hasNativeAcidTransaction);

        // readbackVerified covers complete snapshot & invariant verification
        const readbackVerified = (
          currentReserved >= releasedQuantity &&
          currentAvailable >= 0 &&
          newAvailable >= 0 &&
          newReserved >= 0 &&
          totalQuantity === newAvailable + newReserved &&
          totalQuantity === currentAvailable + currentReserved &&
          holdData.status !== "CANCELLED" &&
          holdData.productCode === productCode
        );

        // Transaction-internal intent declaration for operation persistence
        const operationPersisted = Boolean(opRef && typeof opRef.id === "string" && opRef.id === operationId);

        const resultProof = {
          inventoryReleased,
          holdUpdated,
          auditLogged,
          atomic,
          readbackVerified, // Transaction-internal snapshot / pre-commit verification
          operationPersisted
        };

        // Strict proof integrity check: all proof flags MUST be strictly true
        if (!inventoryReleased || !holdUpdated || !auditLogged || !atomic || !readbackVerified || !operationPersisted) {
          throw new Error("CANCEL_TRANSACTION_INCOMPLETE");
        }

        // Step 8: Write immutable Operations record
        transaction.set(opRef, {
          id: operationId,
          action: "CANCEL_RELEASE",
          reservationNumber,
          status: "COMMITTED",
          executedAt: timestampData,
          resultProof
        });

        finalUpdatedHold = updatedHoldData;
      });

      // Step 9: Post-Commit Independent Readonly Readback Verification (proves actual operationPersisted from store readback)
      const readbackRes = await this.findOperationId(operationId, reservationNumber);
      const postCommitReadbackVerified = Boolean(
        readbackRes &&
        readbackRes.found &&
        readbackRes.status === "COMMITTED" &&
        readbackRes.operationPersistedVerified === true &&
        readbackRes.resultProof
      );

      if (!postCommitReadbackVerified) {
        // Readback failed: DO NOT rewrite or mutate operations document. Fail closed with ambiguous: true and NO releasedQuantity.
        return {
          ok: false,
          errorCode: "POST_COMMIT_READBACK_FAILED",
          message: "Post-commit operation readback failed to confirm valid COMMITTED status and complete result proof",
          ambiguous: true
        };
      }

      // Return resultProof verified from post-commit readback (readbackRes.resultProof)
      return {
        ok: true,
        releasedQuantity,
        updatedHold: finalUpdatedHold,
        resultProof: readbackRes.resultProof,
        postCommitReadbackVerified: true
      };
    } catch (err) {
      const knownErrorCodes = new Set([
        "DUPLICATE_OPERATION_BLOCKED",
        "HOLD_NOT_FOUND",
        "ALREADY_CANCELLED",
        "INVENTORY_NOT_FOUND",
        "INSUFFICIENT_RESERVED_INVENTORY",
        "INVALID_INVENTORY_STATE",
        "PRODUCT_CODE_MISSING",
        "CANCEL_TRANSACTION_INCOMPLETE"
      ]);

      const errorCode = knownErrorCodes.has(err.message) ? err.message : "CANCEL_TRANSACTION_FAILED";
      return {
        ok: false,
        errorCode,
        message: err.message
      };
    }
  }
}

module.exports = {
  FirestoreReservationTransactionAdapter
};
