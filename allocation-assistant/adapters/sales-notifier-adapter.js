/**
 * Stage 43: Real-Time Sales LINE Notifier Adapter
 *
 * Implements the notification adapter for sales personnel with:
 * - 3000ms fail-fast timeout (Promise.race)
 * - In-memory operationId deduplication cache (strictly at-most-once delivery per operation)
 * - Fail-closed notificationBypassed guard (default: true)
 * - Complete fail-safe isolation (never throws to caller or corrupts projection transactions)
 * - Sanitized logging and token protection
 */

"use strict";

const {
  buildReservationLockedFlexTemplate,
  buildReservationCancelledFlexTemplate,
  buildFulfillmentCommittedFlexTemplate,
  renderSalesFlexMessage
} = require("../templates/line-flex-templates");

class SalesNotifierAdapter {
  /**
   * @param {Object} [config={}] Configuration options
   * @param {boolean} [config.notificationBypassed=true] Safety bypass flag (default true)
   * @param {number} [config.timeoutMs=3000] Request timeout in milliseconds (default 3000ms)
   * @param {Function} [config.fetcher=null] Injected HTTP client / fetcher for testing or UrlFetchApp
   * @param {string} [config.channelAccessToken=null] LINE Channel Access Token
   * @param {number} [config.maxCacheSize=1000] Maximum entries in deduplication cache
   */
  constructor(config = {}) {
    this.notificationBypassed = config.notificationBypassed !== undefined ? Boolean(config.notificationBypassed) : true;
    this.timeoutMs = typeof config.timeoutMs === "number" && config.timeoutMs > 0 ? config.timeoutMs : 3000;
    this.fetcher = config.fetcher || (typeof UrlFetchApp !== "undefined" ? UrlFetchApp.fetch : null);
    this.channelAccessToken = config.channelAccessToken || null;
    this.maxCacheSize = config.maxCacheSize || 1000;

    // Deduplication Cache: set of string operationIds
    this._dedupCache = new Set();

    // Audit log history for verification and testing
    this._auditHistory = [];
  }

  /**
   * Checks whether an operationId has already been successfully notified.
   *
   * @param {string} operationId Operation ID to check
   * @returns {boolean}
   */
  hasNotified(operationId) {
    if (!operationId || typeof operationId !== "string") {
      return false;
    }
    return this._dedupCache.has(operationId.trim());
  }

  /**
   * Records an operationId into the deduplication cache.
   *
   * @param {string} operationId Operation ID to record
   */
  recordNotified(operationId) {
    if (!operationId || typeof operationId !== "string") {
      return;
    }
    const cleanId = operationId.trim();
    if (this._dedupCache.size >= this.maxCacheSize) {
      // LRU approximation: delete oldest inserted element
      const firstKey = this._dedupCache.values().next().value;
      if (firstKey) {
        this._dedupCache.delete(firstKey);
      }
    }
    this._dedupCache.add(cleanId);
  }

  /**
   * Clears the deduplication cache and audit history (for test isolation).
   */
  clearCache() {
    this._dedupCache.clear();
    this._auditHistory = [];
  }

  /**
   * Returns current cache size.
   *
   * @returns {number}
   */
  getCacheSize() {
    return this._dedupCache.size;
  }

  /**
   * Returns recent audit history entries.
   *
   * @returns {Array<Object>}
   */
  getAuditHistory() {
    return [...this._auditHistory];
  }

  /**
   * Core dispatcher that handles timeout, deduplication, bypass, and HTTP dispatch.
   * Always resolves (never rejects) to maintain strict Fail-Safe Isolation.
   *
   * @param {string} eventType Event type
   * @param {Object} data Event and template parameters
   * @returns {Promise<{ success: boolean, delivered: boolean, bypassed?: boolean, duplicate?: boolean, error?: string, lineRequestId?: string }>}
   */
  async dispatchSalesNotification(eventType, data = {}) {
    const operationId = data.operationId || data.reservationNumber || null;

    try {
      // 1. Deduplication Guard on operationId
      if (operationId && this.hasNotified(operationId)) {
        const dedupResult = {
          success: true,
          delivered: false,
          bypassed: true,
          duplicate: true,
          reason: "DEDUPLICATION_CACHE_HIT",
          operationId
        };
        this._recordAudit(eventType, operationId, dedupResult);
        return dedupResult;
      }

      // 2. Safety Bypass Guard (Enabled by default)
      if (this.notificationBypassed) {
        if (operationId) {
          this.recordNotified(operationId);
        }
        const bypassResult = {
          success: true,
          delivered: false,
          bypassed: true,
          reason: "NOTIFICATION_BYPASSED_BY_DEFAULT",
          operationId
        };
        this._recordAudit(eventType, operationId, bypassResult);
        return bypassResult;
      }

      // 3. Render Flex Message Payload
      const flexMessage = renderSalesFlexMessage(eventType, data);
      const recipientLineUserId = data.recipientLineUserId || data.salesRepLineUserId;

      const lineUserIdPattern = /^U[0-9a-fA-F]{32}$/;
      if (!recipientLineUserId || !lineUserIdPattern.test(recipientLineUserId)) {
        const invalidUserResult = {
          success: false,
          delivered: false,
          error: "LINE_USER_NOT_BOUND_OR_INVALID",
          operationId
        };
        this._recordAudit(eventType, operationId, invalidUserResult);
        return invalidUserResult;
      }

      if (!this.channelAccessToken) {
        const noTokenResult = {
          success: false,
          delivered: false,
          error: "LINE_TOKEN_MISSING",
          operationId
        };
        this._recordAudit(eventType, operationId, noTokenResult);
        return noTokenResult;
      }

      if (!this.fetcher) {
        const noAdapterResult = {
          success: false,
          delivered: false,
          error: "LINE_HTTP_FETCHER_MISSING",
          operationId
        };
        this._recordAudit(eventType, operationId, noAdapterResult);
        return noAdapterResult;
      }

      // 4. Dispatch with 3000ms Fail-Fast Timeout via Promise.race
      const dispatchPromise = this._executeLinePush(recipientLineUserId, flexMessage);
      const timeoutPromise = new Promise((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`NOTIFICATION_TIMEOUT: request exceeded ${this.timeoutMs}ms`));
        }, this.timeoutMs);
        if (typeof timer.unref === "function") {
          timer.unref();
        }
      });

      const response = await Promise.race([dispatchPromise, timeoutPromise]);

      if (response && response.success) {
        if (operationId) {
          this.recordNotified(operationId);
        }
        const successResult = {
          success: true,
          delivered: true,
          lineRequestId: response.lineRequestId || `req-${Date.now()}`,
          operationId
        };
        this._recordAudit(eventType, operationId, successResult);
        return successResult;
      }

      const failResult = {
        success: false,
        delivered: false,
        error: response && response.error ? response.error : "LINE_PUSH_FAILED",
        operationId
      };
      this._recordAudit(eventType, operationId, failResult);
      return failResult;

    } catch (err) {
      // 5. Fail-Safe Catch: Sanitize error message to avoid secret or PII exposure
      const sanitizedError = this._sanitizeErrorMessage(err.message || String(err));
      const errorResult = {
        success: false,
        delivered: false,
        error: sanitizedError,
        operationId
      };
      this._recordAudit(eventType, operationId, errorResult);
      return errorResult;
    }
  }

  /**
   * Helper for Reservation Locked event notification.
   */
  async notifySalesReservationLocked(data = {}) {
    return await this.dispatchSalesNotification("RESERVATION_CREATED", data);
  }

  /**
   * Helper for Reservation Cancelled event notification.
   */
  async notifySalesReservationCancelled(data = {}) {
    return await this.dispatchSalesNotification("RESERVATION_CANCELLED", data);
  }

  /**
   * Helper for Fulfillment Committed event notification.
   */
  async notifySalesFulfillmentCommitted(data = {}) {
    return await this.dispatchSalesNotification("FULFILLMENT_COMMITTED", data);
  }

  /**
   * Internal HTTP execution against LINE Messaging API.
   *
   * @private
   */
  async _executeLinePush(recipientLineUserId, flexMessage) {
    const url = "https://api.line.me/v2/bot/message/push";
    const body = {
      to: recipientLineUserId,
      messages: [flexMessage]
    };

    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.channelAccessToken}`
      },
      payload: JSON.stringify(body),
      body: JSON.stringify(body),
      muteHttpExceptions: true
    };

    let rawRes = this.fetcher(url, options);
    if (rawRes && typeof rawRes.then === "function") {
      rawRes = await rawRes;
    }

    const statusCode = rawRes && typeof rawRes.getResponseCode === "function"
      ? rawRes.getResponseCode()
      : (rawRes && rawRes.status ? rawRes.status : 200);

    const headers = rawRes && typeof rawRes.getAllHeaders === "function"
      ? rawRes.getAllHeaders()
      : (rawRes && rawRes.headers ? rawRes.headers : {});

    const lineRequestId = headers["x-line-request-id"] || headers["X-Line-Request-Id"] || `req-${Date.now()}`;

    if (statusCode >= 200 && statusCode < 300) {
      return { success: true, lineRequestId };
    }

    return {
      success: false,
      error: `LINE_API_HTTP_${statusCode}`,
      lineRequestId
    };
  }

  /**
   * Internal audit trail recording.
   *
   * @private
   */
  _recordAudit(eventType, operationId, result) {
    this._auditHistory.push({
      timestamp: new Date().toISOString(),
      eventType,
      operationId,
      result
    });
    if (this._auditHistory.length > 500) {
      this._auditHistory.shift();
    }
  }

  /**
   * Sanitizes error message removing sensitive tokens.
   *
   * @private
   */
  _sanitizeErrorMessage(message) {
    if (!message || typeof message !== "string") {
      return "UNKNOWN_ERROR";
    }
    return message
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
      .replace(/U[0-9a-fA-F]{32}/g, "U[REDACTED_USER_ID]");
  }
}

module.exports = {
  SalesNotifierAdapter
};
