"use strict";

/**
 * TDD Simulation Suite for Formal Production Transaction Adapter & Cancel-Release Contract
 *
 * Enforces strict transaction requirements:
 * 1. Missing executeCancelReleaseTransaction on adapter explicitly fails closed with CANCEL_TRANSACTION_ADAPTER_MISSING.
 * 2. Complete transaction success atomically updates inventory, Holds, Ledger, Audit.
 * 3. Any step failure (inventory, Holds, Ledger, Audit) leaves original state completely untouched.
 * 4. Retrying the same operationId via cancelReleaseHoldAction does not duplicate inventory release.
 * 5. Already cancelled hold reservation cannot be cancelled again.
 * 6. Readback inconsistency must Fail-Closed.
 * 7. Forged/Mock proof flags are strictly rejected.
 * 8. ProductionSheetReservationAdapter formally implements executeCancelReleaseTransaction.
 */

const path = require("path");
const fs = require("fs");
const vm = require("vm");
const repoRoot = path.join(__dirname, "../..");
const { assert, runSuite } = require("./helpers");

const codeGsPath = path.join(repoRoot, "google-apps-script/Code.gs");
const codeGsContent = fs.readFileSync(codeGsPath, "utf8");

const { ProductionSheetReservationAdapter } = require(path.join(repoRoot, "allocation-assistant/adapters/production-sheet-reservation-adapter"));

function createVmContext() {
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
    evaluateLineNotificationPolicy_: () => ({ success: false, reason: "MOCK_BYPASS" }),
    sendLinePushToOwner: () => false
  };

  const context = vm.createContext(globalContext);
  vm.runInContext(codeGsContent, context);
  return context;
}

function createConfigProvider() {
  return {
    JYAI_ALLOCATION_PRODUCTION_SPREADSHEET_ID: "prod-sheet-id-999",
    JYAI_ALLOCATION_PRODUCTION_HOLDS_SHEET_NAME: "Holds",
    JYAI_ALLOCATION_PRODUCTION_LEDGER_SHEET_NAME: "Ledger"
  };
}

function createMockStore(initialHolds = []) {
  return {
    holds: JSON.parse(JSON.stringify(initialHolds)),
    inventory: { "STU-6101": 10 },
    ledger: [],
    auditLogs: [],
    processedOperationIds: new Set()
  };
}

/**
 * Mock Formal Transaction Adapter implementation for contract testing
 */
function createFormalTransactionAdapter(store, options = {}) {
  return {
    findHoldById(id) {
      if (options.throwOnReadHold) throw new Error("DB_READ_ERROR");
      return store.holds.find(h => h.id === id || h.reservationNumber === id) || null;
    },
    executeCancelReleaseTransaction(params) {
      const { reservationNumber, existingHold, releasedQuantity, operator, operatorRole, operationId } = params;

      // Rule 4: Idempotency check on operationId
      if (operationId && store.processedOperationIds.has(operationId)) {
        return {
          ok: false,
          errorCode: "DUPLICATE_OPERATION_BLOCKED",
          message: "交易操作 ID 已執行過，防重複釋放攔截"
        };
      }

      // Rule 5: Already cancelled guard
      if (existingHold && existingHold.status === "CANCELLED") {
        return {
          ok: false,
          errorCode: "ALREADY_CANCELLED",
          message: "保留單已被取消"
        };
      }

      // Rule 7: Reject forged mock proof
      if (options.forgedProof) {
        return {
          ok: true,
          mockProof: true,
          inventoryReleased: false,
          holdUpdated: false,
          auditLogged: false,
          atomic: false
        };
      }

      // Sandbox temporary store for atomic transaction execution
      const tempStore = JSON.parse(JSON.stringify(store));
      tempStore.processedOperationIds = new Set(store.processedOperationIds);

      // Step 1: Inventory Release
      if (options.failInventoryStep) {
        return { ok: false, errorCode: "INVENTORY_RELEASE_FAILED", message: "庫存釋放失敗" };
      }
      const itemCode = existingHold ? existingHold.productCode : "STU-6101";
      tempStore.inventory[itemCode] = (tempStore.inventory[itemCode] || 0) + releasedQuantity;

      // Step 2: Holds Status Update
      if (options.failHoldsStep) {
        return { ok: false, errorCode: "HOLDS_UPDATE_FAILED", message: "Holds 狀態更新失敗" };
      }
      const holdIndex = tempStore.holds.findIndex(h => h.id === reservationNumber || h.reservationNumber === reservationNumber);
      if (holdIndex !== -1) {
        tempStore.holds[holdIndex].status = "CANCELLED";
        tempStore.holds[holdIndex].updatedAt = new Date().toISOString();
      }

      // Step 3: Ledger Append
      if (options.failLedgerStep) {
        return { ok: false, errorCode: "LEDGER_WRITE_FAILED", message: "Ledger 紀錄寫入失敗" };
      }
      tempStore.ledger.push({
        reservationNumber,
        action: "CANCEL_RELEASE",
        releasedQuantity,
        operator,
        timestamp: new Date().toISOString()
      });

      // Step 4: Audit Log Append
      if (options.failAuditStep) {
        return { ok: false, errorCode: "AUDIT_LOG_FAILED", message: "Audit 日誌寫入失敗" };
      }
      tempStore.auditLogs.push({
        eventType: "CANCEL_RELEASE",
        reservationNumber,
        operator,
        operatorRole,
        timestamp: new Date().toISOString()
      });

      // Rule 6: Readback consistency verification
      if (options.readbackInconsistent) {
        return {
          ok: false,
          errorCode: "READBACK_INCONSISTENT",
          message: "寫入後讀回校驗不一致，交易被安全撤銷"
        };
      }

      // Mark operationId as processed
      if (operationId) {
        tempStore.processedOperationIds.add(operationId);
      }

      // Commit tempStore to formal store atomically
      store.holds = tempStore.holds;
      store.inventory = tempStore.inventory;
      store.ledger = tempStore.ledger;
      store.auditLogs = tempStore.auditLogs;
      store.processedOperationIds = tempStore.processedOperationIds;

      return {
        ok: true,
        inventoryReleased: true,
        holdUpdated: true,
        auditLogged: true,
        atomic: true,
        releasedQuantity,
        updatedHold: tempStore.holds[holdIndex] || existingHold
      };
    }
  };
}

runSuite("formal-transaction-adapter-cancel-release", [
  {
    name: "1. ProductionSheetReservationAdapter without transaction capabilities fails closed with PRODUCTION_TRANSACTION_CAPABILITY_MISSING",
    run() {
      const adapter = new ProductionSheetReservationAdapter({
        configProvider: createConfigProvider()
      });
      const directRes = adapter.executeCancelReleaseTransaction({ operationId: "OP-NO-CAP", releasedQuantity: 5 });
      assert(directRes.ok === false, "Direct invocation without capabilities must return ok: false");
      assert(directRes.errorCode === "PRODUCTION_TRANSACTION_CAPABILITY_MISSING", "ErrorCode must be PRODUCTION_TRANSACTION_CAPABILITY_MISSING");

      const vmContext = createVmContext();
      const res = vmContext.cancelReleaseHoldAction({
        userContext: { role: "admin" },
        reservationNumber: "RES-20260827-001",
        operator: "AdminUser",
        operatorRole: "admin",
        operationId: "OP-NO-CAP"
      }, adapter);

      assert(res.ok === false, "Execution without complete capabilities must return ok: false");
      assert(typeof res.releasedQuantity === "undefined", "releasedQuantity must NOT be returned on missing capabilities");
    }
  },
  {
    name: "2. Complete transaction success atomically updates inventory, Holds, Ledger, and Audit",
    run() {
      const store = createMockStore([
        { id: "RES-20260827-100", reservationNumber: "RES-20260827-100", productCode: "STU-6101", quantity: 5, status: "HOLD" }
      ]);
      const adapter = createFormalTransactionAdapter(store);
      const vmContext = createVmContext();

      const res = vmContext.cancelReleaseHoldAction({
        userContext: { role: "admin" },
        reservationNumber: "RES-20260827-100",
        operator: "AdminUser",
        operatorRole: "admin",
        operationId: "OP-CANCEL-001"
      }, adapter);

      assert(res.ok === true, "Result must be ok: true");
      assert(res.releasedQuantity === 5, "Released quantity must be 5");
      assert(res.status === "CANCELLED", "Returned status must be CANCELLED");

      // Verify atomic store updates
      assert(store.inventory["STU-6101"] === 15, "Inventory must be released +5");
      assert(store.holds[0].status === "CANCELLED", "Hold status must be CANCELLED");
      assert(store.ledger.length === 1, "Ledger entry must be appended");
      assert(store.auditLogs.length === 1, "Audit log must be appended");
    }
  },
  {
    name: "3. Any step failure (inventory, Holds, Ledger, Audit) leaves original store state completely untouched",
    run() {
      const failureSteps = ["failInventoryStep", "failHoldsStep", "failLedgerStep", "failAuditStep"];

      failureSteps.forEach(stepFlag => {
        const initialHolds = [{ id: "RES-20260827-200", reservationNumber: "RES-20260827-200", productCode: "STU-6101", quantity: 4, status: "HOLD" }];
        const store = createMockStore(initialHolds);
        const adapter = createFormalTransactionAdapter(store, { [stepFlag]: true });
        const vmContext = createVmContext();

        const res = vmContext.cancelReleaseHoldAction({
          userContext: { role: "admin" },
          reservationNumber: "RES-20260827-200",
          operator: "AdminUser",
          operatorRole: "admin"
        }, adapter);

        assert(res.ok === false, `Transaction must fail on ${stepFlag}`);
        assert(typeof res.releasedQuantity === "undefined", `releasedQuantity must NOT be returned on ${stepFlag}`);

        // Verify zero mutations in store
        assert(store.inventory["STU-6101"] === 10, `Inventory must remain unchanged on ${stepFlag}`);
        assert(store.holds[0].status === "HOLD", `Hold status must remain HOLD on ${stepFlag}`);
        assert(store.ledger.length === 0, `Ledger must remain empty on ${stepFlag}`);
        assert(store.auditLogs.length === 0, `Audit logs must remain empty on ${stepFlag}`);
      });
    }
  },
  {
    name: "4. Retrying the same operationId via cancelReleaseHoldAction does not duplicate inventory release (idempotency guard)",
    run() {
      const store = createMockStore([
        { id: "RES-20260827-300", reservationNumber: "RES-20260827-300", productCode: "STU-6101", quantity: 3, status: "HOLD" }
      ]);
      let lastReceivedOperationId = null;
      const baseAdapter = createFormalTransactionAdapter(store);
      const adapter = {
        ...baseAdapter,
        executeCancelReleaseTransaction(params) {
          lastReceivedOperationId = params.operationId;
          return baseAdapter.executeCancelReleaseTransaction(params);
        }
      };
      const vmContext = createVmContext();

      // First execution via cancelReleaseHoldAction
      const res1 = vmContext.cancelReleaseHoldAction({
        userContext: { role: "admin" },
        reservationNumber: "RES-20260827-300",
        operator: "AdminUser",
        operatorRole: "admin",
        operationId: "OP-REPEAT-99"
      }, adapter);

      assert(res1.ok === true, "First transaction execution must succeed");
      assert(lastReceivedOperationId === "OP-REPEAT-99", "Adapter must actually receive operationId from Code.gs");
      assert(store.inventory["STU-6101"] === 13, "First release +3");

      // Verify transaction adapter directly blocks duplicate operationId
      const directRetry = adapter.executeCancelReleaseTransaction({
        reservationNumber: "RES-20260827-300",
        existingHold: store.holds[0],
        releasedQuantity: 3,
        operator: "AdminUser",
        operatorRole: "admin",
        operationId: "OP-REPEAT-99"
      });
      assert(directRetry.ok === false, "Adapter must fail on duplicate operationId");
      assert(directRetry.errorCode === "DUPLICATE_OPERATION_BLOCKED", "ErrorCode must be DUPLICATE_OPERATION_BLOCKED");

      // Second execution via cancelReleaseHoldAction fails closed
      const res2 = vmContext.cancelReleaseHoldAction({
        userContext: { role: "admin" },
        reservationNumber: "RES-20260827-300",
        operator: "AdminUser",
        operatorRole: "admin",
        operationId: "OP-REPEAT-99"
      }, adapter);

      assert(res2.ok === false, "Duplicate call via cancelReleaseHoldAction must fail closed");
      assert(res2.errorCode === "ALREADY_CANCELLED" || res2.errorCode === "DUPLICATE_OPERATION_BLOCKED", "Must fail closed");
      assert(store.inventory["STU-6101"] === 13, "Inventory must NOT increase again");
    }
  },
  {
    name: "5. Already cancelled hold reservation cannot be cancelled again",
    run() {
      const store = createMockStore([
        { id: "RES-20260827-400", reservationNumber: "RES-20260827-400", productCode: "STU-6101", quantity: 2, status: "CANCELLED" }
      ]);
      const adapter = createFormalTransactionAdapter(store);
      const vmContext = createVmContext();

      const res = vmContext.cancelReleaseHoldAction({
        userContext: { role: "admin" },
        reservationNumber: "RES-20260827-400",
        operator: "AdminUser",
        operatorRole: "admin"
      }, adapter);

      assert(res.ok === false, "Already cancelled hold execution must fail");
      assert(res.errorCode === "ALREADY_CANCELLED", "ErrorCode must be ALREADY_CANCELLED");
      assert(store.inventory["STU-6101"] === 10, "Inventory must remain unchanged");
    }
  },
  {
    name: "6. Readback inconsistency must Fail-Closed without returning releasedQuantity",
    run() {
      const store = createMockStore([
        { id: "RES-20260827-500", reservationNumber: "RES-20260827-500", productCode: "STU-6101", quantity: 2, status: "HOLD" }
      ]);
      const adapter = createFormalTransactionAdapter(store, { readbackInconsistent: true });
      const vmContext = createVmContext();

      const res = vmContext.cancelReleaseHoldAction({
        userContext: { role: "admin" },
        reservationNumber: "RES-20260827-500",
        operator: "AdminUser",
        operatorRole: "admin"
      }, adapter);

      assert(res.ok === false, "Readback inconsistent transaction must fail");
      assert(res.errorCode === "READBACK_INCONSISTENT", "ErrorCode must be READBACK_INCONSISTENT");
      assert(typeof res.releasedQuantity === "undefined", "releasedQuantity must NOT be returned");
      assert(store.inventory["STU-6101"] === 10, "Inventory must remain unchanged");
    }
  },
  {
    name: "7. Forged/Mock proof flags are strictly rejected with CANCEL_TRANSACTION_INCOMPLETE",
    run() {
      const store = createMockStore([
        { id: "RES-20260827-600", reservationNumber: "RES-20260827-600", productCode: "STU-6101", quantity: 2, status: "HOLD" }
      ]);
      const adapter = createFormalTransactionAdapter(store, { forgedProof: true });
      const vmContext = createVmContext();

      const res = vmContext.cancelReleaseHoldAction({
        userContext: { role: "admin" },
        reservationNumber: "RES-20260827-600",
        operator: "AdminUser",
        operatorRole: "admin"
      }, adapter);

      assert(res.ok === false, "Forged proof transaction must fail");
      assert(res.errorCode === "CANCEL_TRANSACTION_INCOMPLETE", "ErrorCode must be CANCEL_TRANSACTION_INCOMPLETE");
      assert(typeof res.releasedQuantity === "undefined", "releasedQuantity must NOT be returned on incomplete proof");
    }
  },
  {
    name: "8. ProductionSheetReservationAdapter formally implements executeCancelReleaseTransaction method",
    run() {
      const adapter = new ProductionSheetReservationAdapter();
      assert(typeof adapter.executeCancelReleaseTransaction === "function", "ProductionSheetReservationAdapter method executeCancelReleaseTransaction must exist");
    }
  }
]);
