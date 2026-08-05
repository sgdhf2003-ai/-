"use strict";

const path = require("path");
const repoRoot = path.join(__dirname, "../..");
const { assert, runSuite } = require("./helpers");

const { AllocationEndpointDispatcher } = require(path.join(repoRoot, "allocation-assistant/index"));

/**
 * Phase 6-C Allocation Endpoint Dispatcher Simulation Suite
 * Verifies endpoint action consolidation for fulfillHoldAction, cancelReleaseHoldAction,
 * readbackAuditAction, session auth, role authorization, and 7-column ledger schema.
 */

runSuite("allocation-endpoint-dispatcher", [
  {
    name: "session auth guard rejects unauthenticated or missing role context with INVALID_SESSION_USER",
    run() {
      const badContexts = [null, undefined, {}, { role: "" }, { role: "unknown" }, { role: "無" }];
      for (const ctx of badContexts) {
        const authRes = AllocationEndpointDispatcher.evaluateEndpointSessionAuth(ctx);
        assert(authRes.ok === false, "unauthenticated context fails");
        assert(authRes.errorCode === "INVALID_SESSION_USER", "returns INVALID_SESSION_USER");
      }

      const validContext = { username: "assistant_user", role: "assistant" };
      const validRes = AllocationEndpointDispatcher.evaluateEndpointSessionAuth(validContext);
      assert(validRes.ok === true, "valid session auth succeeds");
    }
  },
  {
    name: "role authorization guard restricts write actions to admin, boss, assistant only",
    run() {
      for (const badRole of ["sales", "retailsales", "showroomsales", "retail"]) {
        const authRes = AllocationEndpointDispatcher.evaluateEndpointRoleAuthorization({ username: "user", role: badRole });
        assert(authRes.ok === false, `role ${badRole} fails write authorization`);
        assert(authRes.errorCode === "UNAUTHORIZED_ROLE", "returns UNAUTHORIZED_ROLE");
      }

      for (const okRole of ["admin", "boss", "assistant"]) {
        const authRes = AllocationEndpointDispatcher.evaluateEndpointRoleAuthorization({ username: "user", role: okRole });
        assert(authRes.ok === true, `role ${okRole} passes write authorization`);
      }
    }
  },
  {
    name: "fulfillHoldAction validates payload and returns 7-column ledgerRow",
    run() {
      const dispatcher = new AllocationEndpointDispatcher();

      // Unauthorized role fails
      const badRoleRes = dispatcher.fulfillHoldAction({
        userContext: { username: "sales01", role: "sales" },
        fulfillPayload: { reservationNumber: "RES-20260805-001", quantity: 5, totalQuantity: 10 }
      });
      assert(badRoleRes.ok === false, "sales role fails fulfillment");
      assert(badRoleRes.errorCode === "UNAUTHORIZED_ROLE", "errorCode matches");

      // Invalid payload fails
      const invalidRes = dispatcher.fulfillHoldAction({
        userContext: { username: "admin01", role: "admin" },
        fulfillPayload: { reservationNumber: "", quantity: 0 }
      });
      assert(invalidRes.ok === false, "empty payload fails");
      assert(invalidRes.errorCode === "INVALID_FULFILL_PAYLOAD", "errorCode matches");

      // Exceeding quantity fails
      const exceedRes = dispatcher.fulfillHoldAction({
        userContext: { username: "admin01", role: "admin" },
        fulfillPayload: { reservationNumber: "RES-20260805-001", quantity: 15, totalQuantity: 10 }
      });
      assert(exceedRes.ok === false, "exceeding quantity fails");
      assert(exceedRes.errorCode === "EXCEEDS_REMAINING_QUANTITY", "errorCode matches");

      // Valid partial fulfillment
      const validRes = dispatcher.fulfillHoldAction({
        userContext: { username: "admin01", role: "admin" },
        fulfillPayload: {
          reservationNumber: "RES-20260805-001",
          quantity: 4,
          totalQuantity: 10,
          item: "ART-101 (100x200 cm)"
        }
      });
      assert(validRes.ok === true, "valid fulfillment succeeds");
      assert(validRes.remainingQuantity === 6, "remainingQuantity is 6");
      assert(validRes.status === "PARTIAL_FULFILLED", "status is PARTIAL_FULFILLED");
      assert(validRes.notificationBypassed === true, "notificationBypassed is true");

      const row = validRes.ledgerRow;
      assert(Array.isArray(row) && row.length === 7, "returns exact 7-column ledger row");
      assert(row[0] === "RES-20260805-001", "row[0] === reservationNumber ID parity");
      assert(row[1] === "PARTIAL_FULFILL_DEDUCT", "action matches");
      assert(row[3] === 4, "quantity matches");
      assert(row[4] === 6, "remainingQuantity matches");
      assert(row[5] === "PARTIAL_FULFILLED", "status matches");
    }
  },
  {
    name: "cancelReleaseHoldAction processes cancellation and returns CANCELLED 7-column ledgerRow",
    run() {
      const dispatcher = new AllocationEndpointDispatcher();

      // Missing payload fails
      const invalidRes = dispatcher.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin" },
        cancelPayload: { reservationNumber: "" }
      });
      assert(invalidRes.ok === false, "empty cancel payload fails");
      assert(invalidRes.errorCode === "INVALID_CANCEL_PAYLOAD", "errorCode matches");

      // Valid cancellation
      const validRes = dispatcher.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin" },
        cancelPayload: {
          reservationNumber: "RES-20260805-001",
          item: "ART-101 (100x200 cm)",
          quantity: 10
        }
      });
      assert(validRes.ok === true, "valid cancellation succeeds");
      assert(validRes.remainingQuantity === 0, "remainingQuantity is 0");
      assert(validRes.status === "CANCELLED", "status is CANCELLED");
      assert(validRes.notificationBypassed === true, "notificationBypassed is true");

      const row = validRes.ledgerRow;
      assert(Array.isArray(row) && row.length === 7, "returns exact 7-column ledger row");
      assert(row[0] === "RES-20260805-001", "row[0] === reservationNumber ID parity");
      assert(row[1] === "CANCEL_RELEASE", "action matches CANCEL_RELEASE");
      assert(row[4] === 0, "remainingQuantity is 0");
      assert(row[5] === "CANCELLED", "status is CANCELLED");
    }
  },
  {
    name: "readbackAuditAction requires authenticated session and returns redacted output",
    run() {
      const dispatcher = new AllocationEndpointDispatcher();

      // Unauthenticated readback fails
      const unauthRes = dispatcher.readbackAuditAction({
        userContext: null,
        queryPayload: { reservationNumber: "RES-20260805-001" }
      });
      assert(unauthRes.ok === false, "unauthenticated readback fails");
      assert(unauthRes.errorCode === "INVALID_SESSION_USER", "errorCode matches");

      // Missing query reservation number fails
      const emptyRes = dispatcher.readbackAuditAction({
        userContext: { username: "sales01", role: "sales" },
        queryPayload: { reservationNumber: "" }
      });
      assert(emptyRes.ok === false, "empty query reservation number fails");
      assert(emptyRes.errorCode === "INVALID_QUERY_PAYLOAD", "errorCode matches");

      // Authenticated sales readback succeeds with redacted record
      const validRes = dispatcher.readbackAuditAction({
        userContext: { username: "sales01", role: "sales" },
        queryPayload: {
          reservationNumber: "RES-20260805-001",
          storeName: "台北展示中心",
          item: "ART-101",
          quantity: 10,
          remainingQuantity: 5,
          status: "PARTIAL_FULFILLED"
        }
      });
      assert(validRes.ok === true, "authenticated readback succeeds");
      assert(validRes.found === true, "found is true");
      assert(validRes.readbackRedacted === true, "readbackRedacted is true");
      assert(validRes.record && validRes.record.reservationNumber === "RES-20260805-001", "record contains reservationNumber");
    }
  }
]);
