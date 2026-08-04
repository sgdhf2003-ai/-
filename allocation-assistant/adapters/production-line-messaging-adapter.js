"use strict";

/**
 * Production LINE Messaging Adapter for Controlled Pilot
 * Handles LINE Messaging API dispatches under explicit configuration and fail-closed safety contracts.
 */
class ProductionLineMessagingAdapter {
  /**
   * @param {Object} config Configuration object
   * @param {string} [config.channelAccessToken] LINE Channel Access Token
   * @param {Function} [config.fetcher] Custom fetcher/HTTP client (for testing/injection)
   * @param {boolean} [config.notificationBypassed=true] Safety bypass flag
   */
  constructor(config = {}) {
    this.channelAccessToken = config.channelAccessToken || null;
    this.fetcher = config.fetcher || (typeof UrlFetchApp !== "undefined" ? UrlFetchApp.fetch : null);
    this.notificationBypassed = config.notificationBypassed !== undefined ? config.notificationBypassed : true;
  }

  /**
   * Sends a controlled LINE push notification under strict safety rules.
   *
   * @param {Object} params Notification parameters
   * @param {string} params.recipientLineUserId Destination LINE User ID
   * @param {string} params.message Message text payload
   * @param {string} params.reservationNumber Target reservation ID
   * @param {string} params.intent Notification intent (e.g., FULFILLMENT_NOTICE)
   * @return {{ success: boolean, failureCode?: string, delivered?: boolean, lineRequestId?: string, auditRecord?: Object }} Result
   */
  sendPushNotification(params = {}) {
    const { recipientLineUserId, message, reservationNumber, intent } = params;

    // 1. Safety Bypass Check
    if (this.notificationBypassed) {
      return {
        success: true,
        bypassed: true,
        failureCode: "NOTIFICATION_BYPASSED"
      };
    }

    // 2. Recipient Validation
    const lineUserIdPattern = /^U[0-9a-fA-F]{32}$/;
    if (!recipientLineUserId || !lineUserIdPattern.test(recipientLineUserId)) {
      return {
        success: false,
        failureCode: "LINE_USER_NOT_BOUND"
      };
    }

    // 3. Token Access Check
    if (!this.channelAccessToken) {
      return {
        success: false,
        failureCode: "LINE_TOKEN_MISSING"
      };
    }

    // 4. Fetcher / Adapter Capability Check
    if (!this.fetcher) {
      return {
        success: false,
        failureCode: "LINE_ADAPTER_MISSING"
      };
    }

    // 5. Execute HTTP Request via Injected Fetcher or UrlFetchApp
    try {
      const url = "https://api.line.me/v2/bot/message/push";
      const payload = {
        to: recipientLineUserId,
        messages: [{ type: "text", text: String(message || "") }]
      };
      const response = this.fetcher(url, {
        method: "post",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.channelAccessToken}`
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const responseCode = response && typeof response.getResponseCode === "function" ? response.getResponseCode() : 200;
      const headers = response && typeof response.getAllHeaders === "function" ? response.getAllHeaders() : {};
      const lineRequestId = headers["x-line-request-id"] || `line-req-${Date.now()}`;

      if (responseCode >= 200 && responseCode < 300) {
        const auditRecord = {
          reservationNumber,
          lineUserId: recipientLineUserId,
          intent,
          status: "DELIVERED",
          lineRequestId,
          sentAt: new Date().toISOString()
        };
        return {
          success: true,
          delivered: true,
          lineRequestId,
          auditRecord
        };
      }

      const errorRecord = {
        reservationNumber,
        lineUserId: recipientLineUserId,
        intent,
        status: "FAILED",
        failureCode: "LINE_API_EXECUTION_ERROR",
        sentAt: new Date().toISOString()
      };
      return {
        success: false,
        failureCode: "LINE_API_EXECUTION_ERROR",
        auditRecord: errorRecord
      };
    } catch (err) {
      return {
        success: false,
        failureCode: "LINE_API_EXECUTION_ERROR"
      };
    }
  }
}

module.exports = {
  ProductionLineMessagingAdapter
};
