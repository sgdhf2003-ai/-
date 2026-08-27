"use strict";

const path = require("path");
const fs = require("fs");
const repoRoot = path.join(__dirname, "../..");
const { assert, runSuite } = require("./helpers");
const vm = require("vm");

/**
 * Stage 35 Chained Vertical Slice Proof Suite (A -> B -> C)
 * Phase A: Formal Hold Write + Immediate Readback Audit
 * Phase B: Partial Fulfillment + Immediate Readback Audit
 * Phase C: Cancel / Release + Final Readback Audit
 */

const codeGsPath = path.join(repoRoot, "google-apps-script/Code.gs");
const codeGsContent = fs.readFileSync(codeGsPath, "utf8");

class MockSpreadsheetDB {
  constructor() {
    this.holds = [];
    this.ledger = [];
    this.inventory = { "STU-6101 100x200": 10, "STU-6101": 10 };
    this.auditLogs = [];
  }

  upsertHold(hold) {
    const existingIndex = this.holds.findIndex(h => h.id === hold.id || h.reservationNumber === hold.reservationNumber);
    if (existingIndex >= 0) {
      this.holds[existingIndex] = { ...this.holds[existingIndex], ...hold };
    } else {
      this.holds.push({ ...hold });
    }
    return { ok: true, holdRecord: hold };
  }

  findHoldById(id) {
    return this.holds.find(h => h.id === id || h.reservationNumber === id) || null;
  }

  fulfillHold(reservationNumber, qty, remainingQty, status, ledgerRow) {
    const hold = this.findHoldById(reservationNumber);
    if (hold) {
      hold.remainingQuantity = remainingQty;
      hold.status = status;
    }
    this.ledger.push(ledgerRow);
    return { ok: true, reservationNumber, remainingQuantity: remainingQty, status, ledgerRow };
  }

  cancelReleaseHold(reservationNumber, releasedQty, remainingQty, status, ledgerRow) {
    const hold = this.findHoldById(reservationNumber);
    if (hold) {
      hold.remainingQuantity = remainingQty;
      hold.status = status;
    }
    this.ledger.push(ledgerRow);
    return { ok: true, reservationNumber, releasedQuantity: releasedQty, remainingQuantity: remainingQty, status, ledgerRow };
  }
}

const db = new MockSpreadsheetDB();

const mockAdapter = {
  upsertHold(hold) {
    const res = db.upsertHold(hold);
    return {
      ok: true,
      reservationNumber: hold.reservationNumber,
      holdRecord: hold,
      rowData: [hold.reservationNumber, hold.storeName, hold.item, hold.quantity, hold.remainingQuantity, hold.status, hold.holdDate]
    };
  },
  findHoldById(id) {
    return db.findHoldById(id);
  },
  fulfillHold(reservationNumber, qty, remainingQty, status, ledgerRow) {
    return db.fulfillHold(reservationNumber, qty, remainingQty, status, ledgerRow);
  },
  cancelReleaseHold(reservationNumber, releasedQty, remainingQty, status, ledgerRow) {
    return db.cancelReleaseHold(reservationNumber, releasedQty, remainingQty, status, ledgerRow);
  },
  executeCancelReleaseTransaction(params) {
    const { reservationNumber, existingHold, releasedQuantity, operator, operatorRole, ledgerRow } = params;
    const tempHolds = JSON.parse(JSON.stringify(db.holds));
    const tempLedger = JSON.parse(JSON.stringify(db.ledger));
    const tempInventory = JSON.parse(JSON.stringify(db.inventory));
    const tempAuditLogs = JSON.parse(JSON.stringify(db.auditLogs));

    const targetHold = tempHolds.find(h => h.id === reservationNumber || h.reservationNumber === reservationNumber);
    if (!targetHold) {
      return { ok: false, errorCode: "HOLD_NOT_FOUND", message: "找不到該筆劃扣保留記錄" };
    }
    targetHold.remainingQuantity = 0;
    targetHold.status = "CANCELLED";
    targetHold.reservationStatus = "CANCELLED";
    targetHold.updatedAt = new Date().toISOString();

    const itemKey = (existingHold && existingHold.item) || targetHold.item;
    if (tempInventory[itemKey] !== undefined) {
      tempInventory[itemKey] += releasedQuantity;
    }

    tempAuditLogs.push({
      action: "CANCEL_RELEASE",
      reservationNumber,
      operator,
      operatorRole,
      releasedQuantity,
      createdAt: new Date().toISOString()
    });

    tempLedger.push(ledgerRow);

    db.holds = tempHolds;
    db.ledger = tempLedger;
    db.inventory = tempInventory;
    db.auditLogs = tempAuditLogs;

    return {
      ok: true,
      inventoryReleased: true,
      holdUpdated: true,
      auditLogged: true,
      atomic: true
    };
  }
};

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

const context = vm.createContext(globalContext);
vm.runInContext(codeGsContent, context);

runSuite("allocation-vertical-slice", [
  {
    name: "Stage 35 A -> B -> C Chained Vertical Slice: Formal Hold Write -> Partial Fulfillment -> Cancel Release -> Final Readback Audit",
    run() {
      const adminUser = { username: "stage35_admin", role: "admin" };
      const chainHoldId = "RES-20260806-CHAIN35";

      // 0. Proving Phase B cannot run before Phase A (Uncreated Hold Fulfill Fails Closed)
      const uncreatedFulfill = context.fulfillHoldAction({
        userContext: adminUser,
        fulfillPayload: { reservationNumber: chainHoldId, quantity: 4 },
        notificationBypassed: true
      }, mockAdapter);
      assert(uncreatedFulfill.ok === false, "Fulfillment on uncreated hold fails closed");
      assert(uncreatedFulfill.errorCode === "HOLD_NOT_FOUND", "Returns HOLD_NOT_FOUND before hold creation");

      // PHASE A: Formal Hold Creation + Immediate Readback Audit
      const holdPayload = {
        id: chainHoldId,
        reservationNumber: chainHoldId,
        storeId: "STORE-CHAIN35",
        storeName: "測試連鎖門市",
        salesOwner: "sales_admin",
        item: "EQA-6522-CHAIN35 (60x60 cm)",
        quantity: 10,
        remainingQuantity: 10,
        reservationStatus: "已收訂 (劃扣)",
        status: "ACTIVE",
        holdDate: "2026-08-06",
        expiresAt: "2026-10-06"
      };

      // Phase A Security Guards
      const unauthUpsert = context.upsertHoldAction({ userContext: null, hold: holdPayload }, mockAdapter);
      assert(unauthUpsert.ok === false && unauthUpsert.errorCode === "INVALID_SESSION_USER", "Unauthenticated upsertHold fails with INVALID_SESSION_USER");

      const unauthRoleUpsert = context.upsertHoldAction({ userContext: { username: "rep", role: "sales" }, hold: holdPayload }, mockAdapter);
      assert(unauthRoleUpsert.ok === false && unauthRoleUpsert.errorCode === "UNAUTHORIZED_OPERATOR", "Sales role upsertHold fails with UNAUTHORIZED_OPERATOR");

      const invalidPayloadUpsert = context.upsertHoldAction({ userContext: adminUser, hold: null }, mockAdapter);
      assert(invalidPayloadUpsert.ok === false && invalidPayloadUpsert.errorCode === "INVALID_HOLD_PAYLOAD", "Missing hold payload fails with INVALID_HOLD_PAYLOAD");

      // Formal Hold Creation Write
      const holdCreateRes = context.upsertHoldAction({
        userContext: adminUser,
        hold: holdPayload,
        notificationBypassed: true
      }, mockAdapter);

      assert(holdCreateRes.ok === true, "Phase A hold creation returns ok: true");
      assert(holdCreateRes.reservationNumber === chainHoldId, "reservationNumber matches input");
      assert(holdCreateRes.holdRecord.id === chainHoldId, "holdRecord.id matches reservationNumber");
      assert(holdCreateRes.holdRecord.status === "ACTIVE", "status is ACTIVE");
      assert(holdCreateRes.holdRecord.quantity === 10, "quantity is 10");
      assert(holdCreateRes.holdRecord.remainingQuantity === 10, "remainingQuantity is 10");
      assert(
        holdCreateRes.reservationNumber === holdCreateRes.holdRecord.id &&
        holdCreateRes.holdRecord.id === holdCreateRes.rowData[0],
        "ID Equality Contract: reservationNumber === holdRecord.id === rowData[0]"
      );

      // Phase A Immediate Readback Audit
      const phaseAAudit = context.readbackAuditAction({
        userContext: adminUser,
        queryPayload: { reservationNumber: chainHoldId },
        notificationBypassed: true
      }, mockAdapter);
      assert(phaseAAudit.ok === true && phaseAAudit.found === true, "Phase A readback finds record");
      assert(phaseAAudit.record.status === "ACTIVE", "Phase A readback status is ACTIVE");
      assert(phaseAAudit.record.remainingQuantity === 10, "Phase A readback remainingQuantity is 10");

      // PHASE B: Reconnected Partial Fulfillment + Immediate Readback Audit
      // Over-fulfillment negative test
      const overFulfill = context.fulfillHoldAction({
        userContext: adminUser,
        fulfillPayload: { reservationNumber: chainHoldId, quantity: 15 },
        notificationBypassed: true
      }, mockAdapter);
      assert(overFulfill.ok === false && overFulfill.errorCode === "EXCEEDS_REMAINING_QUANTITY", "Over-fulfillment fails with EXCEEDS_REMAINING_QUANTITY");

      // Partial Fulfillment (Fulfill 4 of 10 -> Remaining 6)
      const partialFulfillRes = context.fulfillHoldAction({
        userContext: adminUser,
        fulfillPayload: { reservationNumber: chainHoldId, quantity: 4 },
        notificationBypassed: true
      }, mockAdapter);

      assert(partialFulfillRes.ok === true, "Phase B partial fulfillment succeeds");
      assert(partialFulfillRes.remainingQuantity === 6, "Phase B remainingQuantity is 6");
      assert(partialFulfillRes.status === "PARTIAL_FULFILLED", "Phase B status is PARTIAL_FULFILLED");
      assert(Array.isArray(partialFulfillRes.ledgerRow) && partialFulfillRes.ledgerRow.length === 7, "Ledger row has 7 columns");
      assert(partialFulfillRes.ledgerRow[0] === chainHoldId, "Ledger row[0] matches reservationNumber");
      assert(partialFulfillRes.ledgerRow[3] === 4, "Ledger row[3] fulfilled quantity is 4");
      assert(partialFulfillRes.ledgerRow[4] === 6, "Ledger row[4] remaining quantity is 6");
      assert(partialFulfillRes.ledgerRow[5] === "PARTIAL_FULFILLED", "Ledger row[5] status is PARTIAL_FULFILLED");

      // Phase B Immediate Readback Audit
      const phaseBAudit = context.readbackAuditAction({
        userContext: adminUser,
        queryPayload: { reservationNumber: chainHoldId },
        notificationBypassed: true
      }, mockAdapter);
      assert(phaseBAudit.ok === true && phaseBAudit.record.remainingQuantity === 6, "Phase B readback remainingQuantity is 6");
      assert(phaseBAudit.record.status === "PARTIAL_FULFILLED", "Phase B readback status is PARTIAL_FULFILLED");

      // PHASE C: Cancel / Release + Final Readback Audit
      // Phase C Security & Payload Guards
      const unauthCancel = context.cancelReleaseHoldAction({ userContext: null, cancelPayload: { reservationNumber: chainHoldId } }, mockAdapter);
      assert(unauthCancel.ok === false && unauthCancel.errorCode === "INVALID_SESSION_USER", "Unauthenticated cancel fails with INVALID_SESSION_USER");

      const unauthRoleCancel = context.cancelReleaseHoldAction({ userContext: { username: "rep", role: "sales" }, cancelPayload: { reservationNumber: chainHoldId } }, mockAdapter);
      assert(unauthRoleCancel.ok === false && unauthRoleCancel.errorCode === "UNAUTHORIZED_ROLE", "Sales role cancel fails with UNAUTHORIZED_ROLE");

      const missingHoldCancel = context.cancelReleaseHoldAction({ userContext: adminUser, cancelPayload: { reservationNumber: "RES-NONEXISTENT" } }, mockAdapter);
      assert(missingHoldCancel.ok === false && missingHoldCancel.errorCode === "HOLD_NOT_FOUND", "Cancelling non-existent hold fails with HOLD_NOT_FOUND");

      // Cancel / Release Writeback (Releasing remaining 6 units -> Remaining 0)
      const cancelRes = context.cancelReleaseHoldAction({
        userContext: adminUser,
        cancelPayload: { reservationNumber: chainHoldId },
        notificationBypassed: true
      }, mockAdapter);

      assert(cancelRes.ok === true, "Phase C cancel release returns ok: true");
      assert(cancelRes.releasedQuantity === 6, "Phase C releasedQuantity is 6");
      assert(cancelRes.remainingQuantity === 0, "Phase C remainingQuantity is 0");
      assert(cancelRes.status === "CANCELLED", "Phase C status is CANCELLED");
      assert(Array.isArray(cancelRes.ledgerRow) && cancelRes.ledgerRow.length === 7, "Cancel ledger row has 7 columns");
      assert(cancelRes.ledgerRow[0] === chainHoldId, "Cancel ledger row[0] matches reservationNumber");
      assert(cancelRes.ledgerRow[1] === "CANCEL_RELEASE", "Cancel ledger row[1] operation is CANCEL_RELEASE");
      assert(cancelRes.ledgerRow[3] === 6, "Cancel ledger row[3] released quantity is 6");
      assert(cancelRes.ledgerRow[4] === 0, "Cancel ledger row[4] remaining quantity is 0");
      assert(cancelRes.ledgerRow[5] === "CANCELLED", "Cancel ledger row[5] status is CANCELLED");
      assert(db.auditLogs.length === 1, "Phase C audit log recorded in db");
      assert(db.auditLogs[0].action === "CANCEL_RELEASE", "Phase C audit log action is CANCEL_RELEASE");

      // Phase C Immediate Final Readback Audit
      const phaseCAudit = context.readbackAuditAction({
        userContext: adminUser,
        queryPayload: { reservationNumber: chainHoldId },
        notificationBypassed: true
      }, mockAdapter);
      assert(phaseCAudit.ok === true && phaseCAudit.found === true, "Phase C final audit finds record");
      assert(phaseCAudit.record.remainingQuantity === 0, "Phase C final audit remainingQuantity is 0");
      assert(phaseCAudit.record.status === "CANCELLED", "Phase C final audit status is CANCELLED");

      // Phase C Post-Cancellation Negative Tests
      const repeatedCancel = context.cancelReleaseHoldAction({
        userContext: adminUser,
        cancelPayload: { reservationNumber: chainHoldId },
        notificationBypassed: true
      }, mockAdapter);
      assert(repeatedCancel.ok === false && repeatedCancel.errorCode === "ALREADY_CANCELLED", "Repeated cancellation fails with ALREADY_CANCELLED");

      const fulfillCancelled = context.fulfillHoldAction({
        userContext: adminUser,
        fulfillPayload: { reservationNumber: chainHoldId, quantity: 1 },
        notificationBypassed: true
      }, mockAdapter);
      assert(fulfillCancelled.ok === false && fulfillCancelled.errorCode === "HOLD_CANCELLED", "Fulfilling cancelled hold fails with HOLD_CANCELLED");
    }
  },
  {
    name: "Production readback contract: non-existent reservation number returns found:false and missing adapter fails closed",
    run() {
      const adminUser = { username: "stage35_admin", role: "admin" };

      // 1. Non-existent reservation number returns found: false and record: null
      const nonexistentRes = context.readbackAuditAction({
        userContext: adminUser,
        queryPayload: { reservationNumber: "RES-NONEXISTENT-999" }
      }, mockAdapter);
      assert(nonexistentRes.ok === true, "nonexistent readback returns ok: true");
      assert(nonexistentRes.found === false, "nonexistent readback returns found: false");
      assert(nonexistentRes.record === null, "nonexistent readback returns record: null");
      assert(nonexistentRes.reservationNumber === "RES-NONEXISTENT-999", "nonexistent readback matches reservationNumber");

      // 2. Missing persistence adapter in non-sheet runtime fails closed
      const missingAdapterRes = context.readbackAuditAction({
        userContext: adminUser,
        queryPayload: { reservationNumber: "RES-20260806-CHAIN35" }
      });
      assert(missingAdapterRes.ok === false, "missing adapter readback fails closed");
      assert(missingAdapterRes.errorCode === "READBACK_ADAPTER_MISSING", "missing adapter returns READBACK_ADAPTER_MISSING");
    }
  }
]);
