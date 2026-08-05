"use strict";

const path = require("path");
const fs = require("fs");
const repoRoot = path.join(__dirname, "../..");
const { assert, runSuite } = require("./helpers");

/**
 * Phase 6-E Allocation Backend Wireup Simulation Suite
 * Verifies that Apps Script handlers (fulfillHoldAction, cancelReleaseHoldAction, readbackAuditAction)
 * match AllocationEndpointDispatcher contracts and enforce fail-closed security guards.
 */

// Load Code.gs into local context to test Apps Script functions directly
const codeGsPath = path.join(repoRoot, "google-apps-script/Code.gs");
const codeGsContent = fs.readFileSync(codeGsPath, "utf8");

// Mock Apps Script globals needed for Code.gs eval
const globalContext = {
  Date,
  Math,
  Number,
  String,
  JSON,
  Array,
  Logger: { log: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null
    })
  },
  newDateISO: () => new Date().toISOString()
};

// Evaluate Code.gs functions in safe vm context
const vm = require("vm");
const context = vm.createContext(globalContext);
vm.runInContext(codeGsContent, context);

runSuite("allocation-backend-wireup", [
  {
    name: "fulfillHoldAction in Code.gs matches dispatcher contract and 7-column ledger row",
    run() {
      // Unauthenticated fails
      const unauthRes = context.fulfillHoldAction({
        userContext: null,
        fulfillPayload: { reservationNumber: "RES-20260805-001", quantity: 5 }
      });
      assert(unauthRes.ok === false, "unauthenticated request fails");
      assert(unauthRes.errorCode === "INVALID_SESSION_USER", "returns INVALID_SESSION_USER");

      // Unauthorized role fails
      const badRoleRes = context.fulfillHoldAction({
        userContext: { username: "sales01", role: "sales" },
        fulfillPayload: { reservationNumber: "RES-20260805-001", quantity: 5 }
      });
      assert(badRoleRes.ok === false, "sales role fails");
      assert(badRoleRes.errorCode === "UNAUTHORIZED_ROLE", "returns UNAUTHORIZED_ROLE");

      // Exceeding quantity fails
      const exceedRes = context.fulfillHoldAction({
        userContext: { username: "admin01", role: "admin" },
        fulfillPayload: { reservationNumber: "RES-20260805-001", quantity: 15, totalQuantity: 10 }
      });
      assert(exceedRes.ok === false, "exceeding quantity fails");
      assert(exceedRes.errorCode === "EXCEEDS_REMAINING_QUANTITY", "returns EXCEEDS_REMAINING_QUANTITY");

      // Valid partial fulfillment
      const validRes = context.fulfillHoldAction({
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
      assert(Array.isArray(row) && row.length === 7, "exact 7-column ledger row returned");
      assert(row[0] === "RES-20260805-001", "row[0] === reservationNumber ID parity");
      assert(row[3] === 4, "quantity matches");
      assert(row[4] === 6, "remainingQuantity matches");
    }
  },
  {
    name: "cancelReleaseHoldAction in Code.gs processes cancellation and returns CANCELLED 7-column ledger row",
    run() {
      // Invalid payload fails
      const emptyRes = context.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin" },
        cancelPayload: { reservationNumber: "" }
      });
      assert(emptyRes.ok === false, "empty payload fails");
      assert(emptyRes.errorCode === "INVALID_CANCEL_PAYLOAD", "returns INVALID_CANCEL_PAYLOAD");

      // Valid cancellation
      const validRes = context.cancelReleaseHoldAction({
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

      const row = validRes.ledgerRow;
      assert(Array.isArray(row) && row.length === 7, "exact 7-column ledger row returned");
      assert(row[0] === "RES-20260805-001", "row[0] === reservationNumber ID parity");
      assert(row[1] === "CANCEL_RELEASE", "action matches CANCEL_RELEASE");
      assert(row[4] === 0, "remainingQuantity is 0");
      assert(row[5] === "CANCELLED", "status is CANCELLED");
    }
  },
  {
    name: "readbackAuditAction in Code.gs enforces authenticated session and returns redacted record",
    run() {
      // Unauthenticated fails
      const unauthRes = context.readbackAuditAction({
        userContext: null,
        queryPayload: { reservationNumber: "RES-20260805-001" }
      });
      assert(unauthRes.ok === false, "unauthenticated readback fails");
      assert(unauthRes.errorCode === "INVALID_SESSION_USER", "returns INVALID_SESSION_USER");

      // Authenticated readback succeeds with redacted record
      const validRes = context.readbackAuditAction({
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
