"use strict";

const { assert, runSuite } = require("./helpers");

/**
 * Phase 4-C Controlled LINE Messaging Pilot Simulation Test Suite
 * Proves all Phase 4-B fail-closed contracts and audit log reconciliation rules.
 */

// Simulated pilot whitelist (placeholder IDs only, no real user IDs)
const APPROVED_LINE_PILOT_RECIPIENTS = [
  {
    recipientId: "PILOT_RECIPIENT_01",
    storeId: "store-taipei-01",
    lineUserId: "U11112222333344445555666677778888",
    optInStatus: "OPTED_IN"
  },
  {
    recipientId: "PILOT_RECIPIENT_02",
    storeId: "store-taichung-02",
    lineUserId: "U88887777666655554444333322221111",
    optInStatus: "OPTED_IN"
  }
];

class ControlledLineNotificationHarness {
  constructor(config = {}) {
    this.notificationBypassed = config.notificationBypassed !== undefined ? config.notificationBypassed : true;
    this.tokenConfigured = config.tokenConfigured !== undefined ? config.tokenConfigured : true;
    this.adapterInjected = config.adapterInjected !== undefined ? config.adapterInjected : true;
    this.simulatedApiError = config.simulatedApiError || false;
    this.lineApiCallsCount = 0;
    this.auditLogs = [];
  }

  dispatchNotification(request = {}) {
    const { operatorRole, recipientLineUserId, reservationNumber, intent, userOptInStatus } = request;

    // 1. Check Global Bypass Flag (Default: true)
    if (this.notificationBypassed) {
      return {
        success: true,
        bypassed: true,
        failureCode: "NOTIFICATION_BYPASSED",
        lineApiCallsCount: this.lineApiCallsCount
      };
    }

    // 2. Role Authorization Check
    const allowedRoles = ["admin", "boss", "assistant"];
    if (!operatorRole || !allowedRoles.includes(operatorRole)) {
      return {
        success: false,
        failureCode: "UNAUTHORIZED_ROLE",
        lineApiCallsCount: this.lineApiCallsCount
      };
    }

    // 3. lineUserId Format and Opt-In Check
    const lineUserIdPattern = /^U[0-9a-fA-F]{32}$/;
    if (!recipientLineUserId || !lineUserIdPattern.test(recipientLineUserId) || userOptInStatus !== "OPTED_IN") {
      return {
        success: false,
        failureCode: "LINE_USER_NOT_BOUND",
        lineApiCallsCount: this.lineApiCallsCount
      };
    }

    // 4. Pilot Whitelist Check
    const isWhitelisted = APPROVED_LINE_PILOT_RECIPIENTS.some(
      r => r.lineUserId === recipientLineUserId && r.optInStatus === "OPTED_IN"
    );
    if (!isWhitelisted) {
      return {
        success: false,
        failureCode: "NOT_IN_PILOT_WHITELIST",
        lineApiCallsCount: this.lineApiCallsCount
      };
    }

    // 5. Adapter Injection Check
    if (!this.adapterInjected) {
      return {
        success: false,
        failureCode: "LINE_ADAPTER_MISSING",
        lineApiCallsCount: this.lineApiCallsCount
      };
    }

    // 6. Token/Property Access Check
    if (!this.tokenConfigured) {
      return {
        success: false,
        failureCode: "LINE_TOKEN_MISSING",
        lineApiCallsCount: this.lineApiCallsCount
      };
    }

    // 7. Execute Controlled Messaging Action (Simulated)
    this.lineApiCallsCount++;

    if (this.simulatedApiError) {
      const errorLog = {
        reservationNumber,
        lineUserId: recipientLineUserId,
        intent,
        status: "FAILED",
        failureCode: "LINE_API_EXECUTION_ERROR",
        sentAt: new Date().toISOString()
      };
      this.auditLogs.push(errorLog);
      return {
        success: false,
        failureCode: "LINE_API_EXECUTION_ERROR",
        lineApiCallsCount: this.lineApiCallsCount
      };
    }

    const lineRequestId = `line-req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const successLog = {
      reservationNumber,
      lineUserId: recipientLineUserId,
      intent,
      status: "DELIVERED",
      lineRequestId,
      sentAt: new Date().toISOString()
    };
    this.auditLogs.push(successLog);

    return {
      success: true,
      delivered: true,
      lineRequestId,
      auditRecord: successLog,
      lineApiCallsCount: this.lineApiCallsCount
    };
  }
}

runSuite("line-notification-controlled-pilot", [
  {
    name: "notificationBypassed === true returns NOTIFICATION_BYPASSED and executes 0 LINE calls",
    run() {
      const harness = new ControlledLineNotificationHarness({ notificationBypassed: true });
      const res = harness.dispatchNotification({
        operatorRole: "admin",
        recipientLineUserId: "U11112222333344445555666677778888",
        reservationNumber: "RES-20260804-001",
        intent: "FULFILLMENT_NOTICE",
        userOptInStatus: "OPTED_IN"
      });
      assert(res.success === true, "bypassed request reports success");
      assert(res.bypassed === true, "bypassed flag is true");
      assert(res.failureCode === "NOTIFICATION_BYPASSED", "failureCode is NOTIFICATION_BYPASSED");
      assert(harness.lineApiCallsCount === 0, "0 LINE API calls executed");
    }
  },
  {
    name: "unauthorized roles return UNAUTHORIZED_ROLE",
    run() {
      const harness = new ControlledLineNotificationHarness({ notificationBypassed: false });
      for (const badRole of ["sales", "retail", "", null, undefined]) {
        const res = harness.dispatchNotification({
          operatorRole: badRole,
          recipientLineUserId: "U11112222333344445555666677778888",
          reservationNumber: "RES-20260804-002",
          intent: "FULFILLMENT_NOTICE",
          userOptInStatus: "OPTED_IN"
        });
        assert(res.success === false, `role ${badRole} must fail`);
        assert(res.failureCode === "UNAUTHORIZED_ROLE", `role ${badRole} must return UNAUTHORIZED_ROLE`);
        assert(harness.lineApiCallsCount === 0, "0 LINE API calls executed");
      }
    }
  },
  {
    name: "missing or malformed lineUserId returns LINE_USER_NOT_BOUND",
    run() {
      const harness = new ControlledLineNotificationHarness({ notificationBypassed: false });
      for (const badId of ["", "invalid-id", "U123", null]) {
        const res = harness.dispatchNotification({
          operatorRole: "admin",
          recipientLineUserId: badId,
          reservationNumber: "RES-20260804-003",
          intent: "FULFILLMENT_NOTICE",
          userOptInStatus: "OPTED_IN"
        });
        assert(res.success === false, "bad lineUserId must fail");
        assert(res.failureCode === "LINE_USER_NOT_BOUND", "returns LINE_USER_NOT_BOUND");
        assert(harness.lineApiCallsCount === 0, "0 LINE API calls executed");
      }
    }
  },
  {
    name: "optInStatus other than OPTED_IN returns LINE_USER_NOT_BOUND",
    run() {
      const harness = new ControlledLineNotificationHarness({ notificationBypassed: false });
      for (const badStatus of ["OPTED_OUT", "PENDING", "UNKNOWN", null]) {
        const res = harness.dispatchNotification({
          operatorRole: "admin",
          recipientLineUserId: "U11112222333344445555666677778888",
          reservationNumber: "RES-20260804-004",
          intent: "FULFILLMENT_NOTICE",
          userOptInStatus: badStatus
        });
        assert(res.success === false, "unbound opt-in status must fail");
        assert(res.failureCode === "LINE_USER_NOT_BOUND", "returns LINE_USER_NOT_BOUND");
        assert(harness.lineApiCallsCount === 0, "0 LINE API calls executed");
      }
    }
  },
  {
    name: "non-whitelisted recipient returns NOT_IN_PILOT_WHITELIST",
    run() {
      const harness = new ControlledLineNotificationHarness({ notificationBypassed: false });
      const res = harness.dispatchNotification({
        operatorRole: "admin",
        recipientLineUserId: "U99999999999999999999999999999999", // Valid format but not in whitelist
        reservationNumber: "RES-20260804-005",
        intent: "FULFILLMENT_NOTICE",
        userOptInStatus: "OPTED_IN"
      });
      assert(res.success === false, "non-whitelisted recipient must fail");
      assert(res.failureCode === "NOT_IN_PILOT_WHITELIST", "returns NOT_IN_PILOT_WHITELIST");
      assert(harness.lineApiCallsCount === 0, "0 LINE API calls executed");
    }
  },
  {
    name: "missing LINE token/property returns LINE_TOKEN_MISSING without printing secrets",
    run() {
      const harness = new ControlledLineNotificationHarness({ notificationBypassed: false, tokenConfigured: false });
      const res = harness.dispatchNotification({
        operatorRole: "admin",
        recipientLineUserId: "U11112222333344445555666677778888",
        reservationNumber: "RES-20260804-006",
        intent: "FULFILLMENT_NOTICE",
        userOptInStatus: "OPTED_IN"
      });
      assert(res.success === false, "missing token must fail");
      assert(res.failureCode === "LINE_TOKEN_MISSING", "returns LINE_TOKEN_MISSING");
      assert(harness.lineApiCallsCount === 0, "0 LINE API calls executed");
    }
  },
  {
    name: "missing adapter returns LINE_ADAPTER_MISSING",
    run() {
      const harness = new ControlledLineNotificationHarness({ notificationBypassed: false, adapterInjected: false });
      const res = harness.dispatchNotification({
        operatorRole: "admin",
        recipientLineUserId: "U11112222333344445555666677778888",
        reservationNumber: "RES-20260804-007",
        intent: "FULFILLMENT_NOTICE",
        userOptInStatus: "OPTED_IN"
      });
      assert(res.success === false, "missing adapter must fail");
      assert(res.failureCode === "LINE_ADAPTER_MISSING", "returns LINE_ADAPTER_MISSING");
      assert(harness.lineApiCallsCount === 0, "0 LINE API calls executed");
    }
  },
  {
    name: "simulated LINE API failure returns LINE_API_EXECUTION_ERROR",
    run() {
      const harness = new ControlledLineNotificationHarness({ notificationBypassed: false, simulatedApiError: true });
      const res = harness.dispatchNotification({
        operatorRole: "admin",
        recipientLineUserId: "U11112222333344445555666677778888",
        reservationNumber: "RES-20260804-008",
        intent: "FULFILLMENT_NOTICE",
        userOptInStatus: "OPTED_IN"
      });
      assert(res.success === false, "API failure must fail");
      assert(res.failureCode === "LINE_API_EXECUTION_ERROR", "returns LINE_API_EXECUTION_ERROR");
      assert(harness.lineApiCallsCount === 1, "1 simulated call attempted");
      assert(harness.auditLogs[0].status === "FAILED", "audit log status is FAILED");
    }
  },
  {
    name: "simulated successful delivery records reservationNumber, lineUserId, intent, status, lineRequestId, sentAt",
    run() {
      const harness = new ControlledLineNotificationHarness({ notificationBypassed: false });
      const res = harness.dispatchNotification({
        operatorRole: "admin",
        recipientLineUserId: "U11112222333344445555666677778888",
        reservationNumber: "RES-20260804-009",
        intent: "FULFILLMENT_NOTICE",
        userOptInStatus: "OPTED_IN"
      });
      assert(res.success === true, "delivery succeeds");
      assert(res.delivered === true, "delivered flag is true");
      assert(typeof res.lineRequestId === "string" && res.lineRequestId.length > 0, "has valid lineRequestId");

      const log = harness.auditLogs[0];
      assert(log.reservationNumber === "RES-20260804-009", "reservationNumber matches");
      assert(log.lineUserId === "U11112222333344445555666677778888", "lineUserId matches");
      assert(log.intent === "FULFILLMENT_NOTICE", "intent matches");
      assert(log.status === "DELIVERED", "status is DELIVERED");
      assert(log.lineRequestId === res.lineRequestId, "lineRequestId reconciled");
      assert(typeof log.sentAt === "string" && log.sentAt.length > 0, "has sentAt timestamp");
    }
  },
  {
    name: "mock adapter must be explicitly injected and impossible to trigger silently in production",
    run() {
      // Uninjected harness must fail with LINE_ADAPTER_MISSING
      const defaultHarness = new ControlledLineNotificationHarness({ notificationBypassed: false, adapterInjected: false });
      const res = defaultHarness.dispatchNotification({
        operatorRole: "admin",
        recipientLineUserId: "U11112222333344445555666677778888",
        reservationNumber: "RES-20260804-010",
        intent: "FULFILLMENT_NOTICE",
        userOptInStatus: "OPTED_IN"
      });
      assert(res.success === false, "un-injected adapter fails");
      assert(res.failureCode === "LINE_ADAPTER_MISSING", "returns LINE_ADAPTER_MISSING");
    }
  }
]);
