"use strict";

const path = require("path");
const repoRoot = path.join(__dirname, "../..");
const { assert, runSuite } = require("./helpers");

const { FulfillmentAdapter } = require(path.join(repoRoot, "allocation-assistant/index"));

/**
 * Phase 6 Multi-Lot Fulfillment Simulation Test Suite
 * Verifies multi-lot split fulfillment arithmetic, ledger schema validation, and fail-closed security contracts.
 */

class MockMultiLotSheetAdapter {
  constructor(options = {}) {
    this.holdRecord = options.holdRecord || {
      id: "RES-20260805-001",
      reservationNumber: "RES-20260805-001",
      item: "ART-101 (100x200 cm)",
      quantity: 10,
      status: "ACTIVE"
    };
    this.statusUpdateFail = options.statusUpdateFail || false;
    this.inventoryRecordFail = options.inventoryRecordFail || false;
    this.ledgerRows = [];
  }

  queryHoldByReservationNumber(reservationNumber) {
    if (reservationNumber === this.holdRecord.reservationNumber) {
      return { found: true, record: this.holdRecord };
    }
    return { found: false, record: null };
  }

  updateHoldStatus(payload = {}) {
    if (this.statusUpdateFail) {
      return { success: false, errorCode: "STATUS_WRITEBACK_FAILED" };
    }
    return { success: true, persisted: true, updatedStatus: payload.status };
  }

  recordInventoryAdjustment(payload = {}) {
    if (this.inventoryRecordFail) {
      return { success: false, errorCode: "LEDGER_WRITEBACK_FAILED" };
    }
    // Record 7-column ledger row
    const ledgerRow = [
      payload.reservationNumber,
      payload.action,
      payload.item,
      payload.quantity,
      payload.remainingQuantity,
      payload.status,
      payload.updatedAt
    ];
    this.ledgerRows.push(ledgerRow);
    return { success: true, persisted: true, ledgerRow };
  }
}

runSuite("allocation-multi-lot-fulfillment", [
  {
    name: "arithmetic reconciliation enforces totalFulfilled <= holdQuantity and remainingQuantity >= 0",
    run() {
      const resPartial = FulfillmentAdapter.reconcileMultiLotArithmetic({
        holdQuantity: 10,
        fulfilledQuantity: 4,
        lots: [{ lotId: "LOT-A", quantity: 4 }]
      });
      assert(resPartial.ok === true, "partial arithmetic succeeds");
      assert(resPartial.remainingQuantity === 6, "remainingQuantity is 6");
      assert(resPartial.status === "PARTIALLY_FULFILLED", "status is PARTIALLY_FULFILLED");

      const resFull = FulfillmentAdapter.reconcileMultiLotArithmetic({
        holdQuantity: 10,
        fulfilledQuantity: 10,
        lots: [{ lotId: "LOT-A", quantity: 6 }, { lotId: "LOT-B", quantity: 4 }]
      });
      assert(resFull.ok === true, "full split arithmetic succeeds");
      assert(resFull.remainingQuantity === 0, "remainingQuantity is 0");
      assert(resFull.status === "FULFILLED", "status is FULFILLED");
    }
  },
  {
    name: "exceeds remaining quantity returns EXCEEDS_REMAINING_QUANTITY fail-closed",
    run() {
      const resExceeds = FulfillmentAdapter.reconcileMultiLotArithmetic({
        holdQuantity: 10,
        fulfilledQuantity: 15,
        lots: [{ lotId: "LOT-A", quantity: 15 }]
      });
      assert(resExceeds.ok === false, "exceeding quantity fails");
      assert(resExceeds.errorCode === "EXCEEDS_REMAINING_QUANTITY", "errorCode is EXCEEDS_REMAINING_QUANTITY");
    }
  },
  {
    name: "unauthorized roles return UNAUTHORIZED_OPERATOR fail-closed",
    run() {
      const mockSheet = new MockMultiLotSheetAdapter();
      const adapter = new FulfillmentAdapter({ sheetAdapter: mockSheet });

      for (const badRole of ["sales", "retail", "unknown"]) {
        const res = adapter.processMultiLotFulfillment({
          reservationNumber: "RES-20260805-001",
          operatorRole: badRole,
          fulfilledQuantity: 5,
          lots: [{ lotId: "LOT-A", quantity: 5 }]
        });
        assert(res.success === false, `role ${badRole} must fail`);
        assert(res.errorCode === "UNAUTHORIZED_OPERATOR", "returns UNAUTHORIZED_OPERATOR");
      }
    }
  },
  {
    name: "missing adapter returns FULFILLMENT_ADAPTER_MISSING fail-closed",
    run() {
      const adapter = new FulfillmentAdapter({ sheetAdapter: null });
      const res = adapter.processMultiLotFulfillment({
        reservationNumber: "RES-20260805-001",
        operatorRole: "admin",
        fulfilledQuantity: 5
      });
      assert(res.success === false, "missing adapter must fail");
      assert(res.errorCode === "FULFILLMENT_ADAPTER_MISSING", "returns FULFILLMENT_ADAPTER_MISSING");
    }
  },
  {
    name: "hold not found returns HOLD_NOT_FOUND fail-closed",
    run() {
      const mockSheet = new MockMultiLotSheetAdapter();
      const adapter = new FulfillmentAdapter({ sheetAdapter: mockSheet });
      const res = adapter.processMultiLotFulfillment({
        reservationNumber: "RES-NONEXISTENT-999",
        operatorRole: "admin",
        fulfilledQuantity: 5
      });
      assert(res.success === false, "nonexistent hold must fail");
      assert(res.errorCode === "HOLD_NOT_FOUND", "returns HOLD_NOT_FOUND");
    }
  },
  {
    name: "multi-lot split fulfillment persists 7-column ledger row with ID equality contract",
    run() {
      const mockSheet = new MockMultiLotSheetAdapter();
      const adapter = new FulfillmentAdapter({ sheetAdapter: mockSheet });

      const res = adapter.processMultiLotFulfillment({
        reservationNumber: "RES-20260805-001",
        operatorRole: "admin",
        fulfilledQuantity: 6,
        lots: [
          { lotId: "LOT-001", quantity: 4 },
          { lotId: "LOT-002", quantity: 2 }
        ]
      });

      assert(res.success === true, "fulfillment succeeds");
      assert(res.status === "PARTIALLY_FULFILLED", "status is PARTIALLY_FULFILLED");
      assert(res.remainingQuantity === 4, "remainingQuantity is 4");

      const ledgerRow = mockSheet.ledgerRows[0];
      assert(Array.isArray(ledgerRow) && ledgerRow.length === 7, "persists exact 7-column ledger schema");
      assert(ledgerRow[0] === "RES-20260805-001", "ID equality contract: row[0] === reservationNumber");
      assert(ledgerRow[1] === "PARTIAL_FULFILL_DEDUCT", "action matches");
      assert(ledgerRow[3] === 6, "quantity matches fulfilledQuantity");
      assert(ledgerRow[4] === 4, "remainingQuantity matches");
      assert(ledgerRow[5] === "PARTIALLY_FULFILLED", "status matches");
    }
  },
  {
    name: "adapter status update failure fails closed with error code",
    run() {
      const mockSheet = new MockMultiLotSheetAdapter({ statusUpdateFail: true });
      const adapter = new FulfillmentAdapter({ sheetAdapter: mockSheet });

      const res = adapter.processMultiLotFulfillment({
        reservationNumber: "RES-20260805-001",
        operatorRole: "admin",
        fulfilledQuantity: 5
      });

      assert(res.success === false, "failed status update must fail");
      assert(res.errorCode === "STATUS_WRITEBACK_FAILED", "returns STATUS_WRITEBACK_FAILED");
    }
  },
  {
    name: "adapter inventory ledger write failure fails closed with error code",
    run() {
      const mockSheet = new MockMultiLotSheetAdapter({ inventoryRecordFail: true });
      const adapter = new FulfillmentAdapter({ sheetAdapter: mockSheet });

      const res = adapter.processMultiLotFulfillment({
        reservationNumber: "RES-20260805-001",
        operatorRole: "admin",
        fulfilledQuantity: 5
      });

      assert(res.success === false, "failed inventory record must fail");
      assert(res.errorCode === "LEDGER_WRITEBACK_FAILED", "returns LEDGER_WRITEBACK_FAILED");
    }
  }
]);
