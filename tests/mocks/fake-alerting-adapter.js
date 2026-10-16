/**
 * Fake Alerting Adapter for Stage 42-G4 DLQ Reconciler Simulation Tests
 *
 * Requirements:
 * - In-memory implementation with 0 external network calls.
 * - Enforces deterministic idempotencyKey (64-character hex string).
 * - Deduplicates alerts by idempotencyKey.
 * - Supports injecting transient failure.
 * - Validates that sensitive PII (Email, LINE User ID, token, raw payload) is NOT present.
 */

const assert = require("assert");

class FakeAlertingAdapter {
  constructor(options = {}) {
    this.alerts = new Map(); // idempotencyKey -> alertPayload
    this.callHistory = [];
    this.shouldFailNext = false;
    this.failureError = null;
    this.simulateTransientError = options.simulateTransientError || false;
  }

  setFailNext(shouldFail, error = new Error("ALERT_DISPATCH_TRANSIENT_FAILURE")) {
    this.shouldFailNext = shouldFail;
    this.failureError = error;
  }

  /**
   * Send an alert with deterministic deduplication
   * @param {object} payload
   * @returns {Promise<{ sent: boolean, dedup: boolean, idempotencyKey: string }>}
   */
  async sendAlert(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("INVALID_ALERT_PAYLOAD: Payload object is required");
    }

    const { idempotencyKey, severity, reasonCode, eventId, operationId, message } = payload;

    // Validate idempotencyKey
    if (!idempotencyKey || typeof idempotencyKey !== "string" || !/^[a-f0-9]{64}$/.test(idempotencyKey)) {
      throw new Error(`INVALID_ALERT_IDEMPOTENCY_KEY: Must be a 64-character lowercase hex SHA-256 string (got: ${idempotencyKey})`);
    }

    // Security check: Verify NO PII or sensitive tokens in payload or message
    const serialized = JSON.stringify(payload);
    if (/@|\b(U[0-9a-f]{32})\b|\bBearer\b|\bsecret\b|\btoken\b/i.test(serialized)) {
      throw new Error("SECURITY_ALERT_PII_VIOLATION: Alert payload contains forbidden PII or credential pattern");
    }

    this.callHistory.push({ idempotencyKey, timestamp: Date.now() });

    // Transient failure simulation
    if (this.shouldFailNext || this.simulateTransientError) {
      this.shouldFailNext = false;
      throw this.failureError || new Error("ALERT_DISPATCH_TRANSIENT_FAILURE");
    }

    // Idempotent deduplication check
    if (this.alerts.has(idempotencyKey)) {
      return {
        sent: false,
        dedup: true,
        idempotencyKey
      };
    }

    // Save alert
    this.alerts.set(idempotencyKey, {
      idempotencyKey,
      severity: severity || "P1",
      reasonCode: reasonCode || "UNKNOWN",
      eventId: eventId || null,
      operationId: operationId || null,
      message: message || "",
      recordedAt: Date.now()
    });

    return {
      sent: true,
      dedup: false,
      idempotencyKey
    };
  }

  getAlert(idempotencyKey) {
    return this.alerts.get(idempotencyKey);
  }

  getAllAlerts() {
    return Array.from(this.alerts.values());
  }

  getCallCount(idempotencyKey) {
    return this.callHistory.filter(c => c.idempotencyKey === idempotencyKey).length;
  }

  clear() {
    this.alerts.clear();
    this.callHistory = [];
    this.shouldFailNext = false;
    this.failureError = null;
  }
}

module.exports = {
  FakeAlertingAdapter
};
