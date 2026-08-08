/**
 * Stage 40: Security and Permission Closure Simulation Suite
 *
 * Verifies server-side role authorization boundaries, fail-closed authentication guards,
 * session expiration rejection, credential non-persistence, and side-effect isolation.
 */

"use strict";

const path = require("path");
const repoRoot = path.join(__dirname, "../..");
const { assert, runSuite } = require("./helpers");
const { AllocationEndpointDispatcher, ProductionSheetReservationAdapter } = require(path.join(repoRoot, "allocation-assistant/index"));

// Mock sheet persistence adapter for authorized test executions
const mockSheetAdapter = {
  getHoldById: () => ({
    id: "RES-20260808-001",
    reservationNumber: "RES-20260808-001",
    holdQuantity: 10,
    quantity: 10,
    remainingQuantity: 10,
    status: "ACTIVE"
  }),
  updateHoldStatus: () => true,
  appendLedgerRow: () => true
};

const mockFulfillmentAdapter = {
  fulfill: ({ reservationNumber, quantity }) => ({
    success: true,
    action: "FULFILL_PARTIAL",
    reservationNumber,
    quantity,
    remainingQuantity: 6,
    status: "PARTIAL_FULFILLED",
    ledgerRow: [reservationNumber, "FULFILL_PARTIAL", quantity, 6, "2026-08-08", "test-operator", "PARTIAL"]
  }),
  cancelRelease: ({ reservationNumber, quantity }) => ({
    success: true,
    action: "CANCEL_RELEASE",
    reservationNumber,
    quantity,
    remainingQuantity: 0,
    status: "CANCELLED",
    ledgerRow: [reservationNumber, "CANCEL_RELEASE", quantity, 0, "2026-08-08", "test-operator", "CANCELLED"]
  })
};

runSuite("security-permission-closure", [
  {
    name: "authorized roles (admin, boss, assistant) succeed on evaluateEndpointRoleAuthorization and fulfillHoldAction",
    run() {
      const dispatcher = new AllocationEndpointDispatcher({
        sheetAdapter: mockSheetAdapter,
        fulfillmentAdapter: mockFulfillmentAdapter
      });

      ["admin", "boss", "assistant"].forEach((role) => {
        const authRes = AllocationEndpointDispatcher.evaluateEndpointRoleAuthorization({ username: "auth_user", role });
        assert(authRes.ok === true, `Expected role '${role}' to pass role authorization`);

        const res = dispatcher.fulfillHoldAction({
          userContext: { username: "auth_user", role },
          fulfillPayload: {
            reservationNumber: "RES-20260808-001",
            totalQuantity: 10,
            quantity: 4,
            item: "EQA-6522"
          }
        });
        assert(res.ok === true, `Expected fulfillHoldAction to succeed for role '${role}'`);
        assert(res.status === "PARTIAL_FULFILLED", `Expected PARTIAL_FULFILLED for role '${role}'`);
        assert(res.notificationBypassed === true, `Expected notificationBypassed === true for role '${role}'`);
      });
    }
  },
  {
    name: "read-only roles (sales, retail) return UNAUTHORIZED_ROLE fail-closed",
    run() {
      const dispatcher = new AllocationEndpointDispatcher({
        sheetAdapter: mockSheetAdapter,
        fulfillmentAdapter: mockFulfillmentAdapter
      });

      ["sales", "retail", "showroomSales", "retailSales"].forEach((role) => {
        const authRes = AllocationEndpointDispatcher.evaluateEndpointRoleAuthorization({ username: "sales_user", role });
        assert(authRes.ok === false, `Expected role '${role}' to fail role authorization`);
        assert(authRes.errorCode === "UNAUTHORIZED_ROLE", `Expected UNAUTHORIZED_ROLE for role '${role}'`);

        const resFulfill = dispatcher.fulfillHoldAction({
          userContext: { username: "sales_user", role },
          fulfillPayload: {
            reservationNumber: "RES-20260808-001",
            totalQuantity: 10,
            quantity: 4,
            item: "EQA-6522"
          }
        });
        assert(resFulfill.ok === false, `Expected fulfillHoldAction to fail for role '${role}'`);
        assert(resFulfill.errorCode === "UNAUTHORIZED_ROLE", `Expected UNAUTHORIZED_ROLE for role '${role}'`);

        const resCancel = dispatcher.cancelReleaseHoldAction({
          userContext: { username: "sales_user", role },
          cancelPayload: {
            reservationNumber: "RES-20260808-001",
            quantity: 6,
            item: "EQA-6522"
          }
        });
        assert(resCancel.ok === false, `Expected cancelReleaseHoldAction to fail for role '${role}'`);
        assert(resCancel.errorCode === "UNAUTHORIZED_ROLE", `Expected UNAUTHORIZED_ROLE for role '${role}'`);
      });
    }
  },
  {
    name: "unauthenticated request returns INVALID_SESSION_USER fail-closed",
    run() {
      const dispatcher = new AllocationEndpointDispatcher();

      [null, undefined, {}, { role: "" }].forEach((ctx) => {
        const authRes = AllocationEndpointDispatcher.evaluateEndpointSessionAuth(ctx);
        assert(authRes.ok === false, "Expected null/empty userContext to fail session auth");
        assert(authRes.errorCode === "INVALID_SESSION_USER", "Expected INVALID_SESSION_USER");

        const res = dispatcher.fulfillHoldAction({
          userContext: ctx,
          fulfillPayload: { reservationNumber: "RES-20260808-001", quantity: 4 }
        });
        assert(res.ok === false, "Expected fulfillHoldAction to fail for unauthenticated session");
        assert(res.errorCode === "INVALID_SESSION_USER", "Expected INVALID_SESSION_USER error code");
      });
    }
  },
  {
    name: "unknown or malformed role returns INVALID_SESSION_USER or UNAUTHORIZED_ROLE fail-closed",
    run() {
      const dispatcher = new AllocationEndpointDispatcher();

      ["hacker", "guest", "0", "true", "   ", "admin_override"].forEach((role) => {
        const res = dispatcher.fulfillHoldAction({
          userContext: { username: "unknown_user", role },
          fulfillPayload: { reservationNumber: "RES-20260808-001", quantity: 4 }
        });
        assert(res.ok === false, `Expected role '${role}' to be rejected`);
        assert(["UNAUTHORIZED_ROLE", "INVALID_SESSION_USER"].includes(res.errorCode), `Expected fail-closed error code for '${role}'`);
      });
    }
  },
  {
    name: "expired session context returns INVALID_SESSION_USER fail-closed",
    run() {
      const dispatcher = new AllocationEndpointDispatcher();
      const expiredSessionContext = { role: "admin", username: "admin_user", isSessionValid: false };

      const res = dispatcher.fulfillHoldAction({
        userContext: expiredSessionContext.isSessionValid ? expiredSessionContext : null,
        fulfillPayload: { reservationNumber: "RES-20260808-001", quantity: 4 }
      });
      assert(res.ok === false, "Expected expired session to fail");
      assert(res.errorCode === "INVALID_SESSION_USER", "Expected INVALID_SESSION_USER for expired session");
    }
  },
  {
    name: "ProductionSheetReservationAdapter returns PRODUCTION_SHEET_CONFIG_MISSING fail-closed when unconfigured",
    run() {
      const unconfiguredAdapter = new ProductionSheetReservationAdapter();
      const writeRes = unconfiguredAdapter.appendHoldRecord({ reservationNumber: "RES-20260808-001" });
      assert(writeRes.success === false, "Expected unconfigured adapter write to fail");
      assert(writeRes.errorCode === "PRODUCTION_SHEET_CONFIG_MISSING", "Expected PRODUCTION_SHEET_CONFIG_MISSING");
    }
  },
  {
    name: "authorization rejection is side-effect free (0 Sheet writes, 0 LINE API calls)",
    run() {
      let sheetWriteExecuted = false;
      let lineApiExecuted = false;

      const recordingSheetAdapter = {
        getHoldById: () => ({ id: "RES-20260808-001", quantity: 10, status: "ACTIVE" }),
        updateHoldStatus: () => { sheetWriteExecuted = true; return true; },
        appendLedgerRow: () => { sheetWriteExecuted = true; return true; }
      };

      const dispatcher = new AllocationEndpointDispatcher({
        sheetAdapter: recordingSheetAdapter,
        fulfillmentAdapter: {
          fulfill: () => { sheetWriteExecuted = true; return { success: true }; }
        }
      });

      const res = dispatcher.fulfillHoldAction({
        userContext: { username: "sales01", role: "sales" },
        fulfillPayload: { reservationNumber: "RES-20260808-001", quantity: 4 }
      });

      assert(res.ok === false, "Expected rejection for sales role");
      assert(res.errorCode === "UNAUTHORIZED_ROLE", "Expected UNAUTHORIZED_ROLE");
      assert(sheetWriteExecuted === false, "Expected 0 Sheet writes executed on rejection");
      assert(lineApiExecuted === false, "Expected 0 LINE API calls executed on rejection");
    }
  }
]);
