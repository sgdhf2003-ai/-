"use strict";

const path = require("path");
const fs = require("fs");
const repoRoot = path.join(__dirname, "../..");
const { assert, runSuite } = require("./helpers");

/**
 * Phase 7-C Allocation UI Control Panel Simulation Suite (TDD)
 * Tests inline action button rendering, modal validation, loading locks,
 * payload construction, and response state reconciliation.
 */

// Load app.js into local VM context
const appJsPath = path.join(repoRoot, "app.js");
const appJsContent = fs.readFileSync(appJsPath, "utf8");

// Create virtual window/document environment
const vm = require("vm");

function createMockEnvironment() {
  const dummyElement = {
    addEventListener: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    reset: () => {},
    style: {},
    appendChild: () => {},
    removeChild: () => {}
  };

  const mockDocument = {
    querySelector: () => dummyElement,
    querySelectorAll: () => [],
    createElement: () => dummyElement,
    body: dummyElement,
    addEventListener: () => {}
  };

  const mockWindow = {
    document: mockDocument,
    navigator: { userAgent: "node", onLine: true },
    location: { href: "https://example.com", search: "" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    history: { pushState: () => {}, replaceState: () => {} },
    FormData: class { get() { return ""; } },
    URLSearchParams: class { get() { return null; } },
    Element: class {},
    Event: class {},
    CustomEvent: class {},
    crypto: { randomUUID: () => "uuid-1234" },
    Date,
    Math,
    Number,
    String,
    JSON,
    Array,
    console
  };
  mockWindow.window = mockWindow;
  mockWindow.globalThis = mockWindow;

  const context = vm.createContext(mockWindow);
  vm.runInContext(appJsContent, context);
  return context;
}

runSuite("allocation-ui-control-panel", [
  {
    name: "holdsView card contains inline 銷扣出貨 and 取消釋放 action buttons",
    run() {
      const env = createMockEnvironment();
      if (typeof env.renderHoldItemActions !== "function") {
        throw new Error("renderHoldItemActions function is missing in UI codebase");
      }

      const actionsHtml = env.renderHoldItemActions({
        id: "RES-20260805-001",
        item: "ART-101 (100x200 cm)",
        quantity: 10,
        remainingQuantity: 10,
        status: "ACTIVE"
      }, { role: "admin" });

      assert(actionsHtml.includes('btn-fulfill-hold'), "contains btn-fulfill-hold button class");
      assert(actionsHtml.includes('btn-cancel-hold'), "contains btn-cancel-hold button class");
      assert(actionsHtml.includes('銷扣出貨'), "contains text 銷扣出貨");
      assert(actionsHtml.includes('取消釋放'), "contains text 取消釋放");
    }
  },
  {
    name: "role authorization guard restricts inline action buttons for sales/retail roles",
    run() {
      const env = createMockEnvironment();
      if (typeof env.renderHoldItemActions !== "function") {
        throw new Error("renderHoldItemActions function is missing in UI codebase");
      }

      const salesActionsHtml = env.renderHoldItemActions({
        id: "RES-20260805-001",
        quantity: 10,
        status: "ACTIVE"
      }, { role: "sales" });

      assert(salesActionsHtml.includes("disabled"), "sales role receives disabled buttons");
      assert(salesActionsHtml.includes("唯讀防護"), "sales role displays read-only protection note");
    }
  },
  {
    name: "quantity validation prevents zero, negative, or exceeding fulfillment quantities",
    run() {
      const env = createMockEnvironment();
      if (typeof env.validateFulfillInput !== "function") {
        throw new Error("validateFulfillInput function is missing in UI codebase");
      }

      const zeroRes = env.validateFulfillInput(0, 10);
      assert(zeroRes.ok === false, "quantity 0 fails");
      assert(zeroRes.errorCode === "INVALID_FULFILL_PAYLOAD", "returns INVALID_FULFILL_PAYLOAD");

      const exceedRes = env.validateFulfillInput(15, 10);
      assert(exceedRes.ok === false, "exceeding quantity fails");
      assert(exceedRes.errorCode === "EXCEEDS_REMAINING_QUANTITY", "returns EXCEEDS_REMAINING_QUANTITY");

      const validRes = env.validateFulfillInput(4, 10);
      assert(validRes.ok === true, "valid quantity 4 succeeds");
    }
  },
  {
    name: "fulfillment and cancellation action payloads preserve userContext and notificationBypassed === true",
    run() {
      const env = createMockEnvironment();
      if (typeof env.buildAllocationActionPayload !== "function") {
        throw new Error("buildAllocationActionPayload function is missing in UI codebase");
      }

      const payload = env.buildAllocationActionPayload("fulfillHold", {
        reservationNumber: "RES-20260805-001",
        quantity: 4,
        totalQuantity: 10,
        item: "ART-101"
      }, { username: "admin01", role: "admin" });

      assert(payload.userContext && payload.userContext.role === "admin", "attaches userContext");
      assert(payload.notificationBypassed === true, "preserves notificationBypassed === true");
      assert(payload.fulfillPayload && payload.fulfillPayload.reservationNumber === "RES-20260805-001", "contains fulfillPayload");
    }
  },
  {
    name: "fulfillment receipt reconciles remainingQuantity, status, and 7-column ledgerRow into local UI state",
    run() {
      const env = createMockEnvironment();
      if (typeof env.reconcileHoldStateFromReceipt !== "function") {
        throw new Error("reconcileHoldStateFromReceipt function is missing in UI codebase");
      }

      const initialHold = {
        id: "RES-20260805-001",
        item: "ART-101",
        quantity: 10,
        remainingQuantity: 10,
        status: "ACTIVE",
        ledgerHistory: []
      };

      const receipt = {
        ok: true,
        reservationNumber: "RES-20260805-001",
        remainingQuantity: 6,
        status: "PARTIAL_FULFILLED",
        ledgerRow: ["RES-20260805-001", "FULFILL_PARTIAL", "ART-101", 4, 6, "PARTIAL_FULFILLED", new Date().toISOString()],
        notificationBypassed: true
      };

      const updatedHold = env.reconcileHoldStateFromReceipt(initialHold, receipt);
      assert(updatedHold.remainingQuantity === 6, "remainingQuantity updated to 6");
      assert(updatedHold.status === "PARTIAL_FULFILLED", "status updated to PARTIAL_FULFILLED");
      assert(updatedHold.ledgerHistory.length === 1, "ledgerRow prepended to ledgerHistory");
      assert(updatedHold.ledgerHistory[0][0] === "RES-20260805-001", "ledgerRow[0] matches ID parity");
    }
  }
]);
