"use strict";

const path = require("path");
const fs = require("fs");
const vm = require("vm");
const repoRoot = path.join(__dirname, "../..");
const { assert, runSuite } = require("./helpers");

const codeGsPath = path.join(repoRoot, "google-apps-script/Code.gs");
const codeGsContent = fs.readFileSync(codeGsPath, "utf8");

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

function createMockStore(initialHolds = []) {
  const store = {
    holds: JSON.parse(JSON.stringify(initialHolds)),
    auditLogs: [],
    inventory: { "STU-6101": 10 }
  };
  return store;
}

function createMockTxAdapter(store, options = {}) {
  return {
    findHoldById(id) {
      if (options.throwOnReadHold) {
        throw new Error("DB_READ_ERROR");
      }
      return store.holds.find(h => h.id === id || h.reservationNumber === id) || null;
    },
    executeCancelReleaseTransaction(params) {
      const { reservationNumber, existingHold, releasedQuantity, operator, operatorRole } = params;

      // Sandbox temporary store for atomic transaction execution
      const tempStore = JSON.parse(JSON.stringify(store));

      // Step 1: Inventory Release
      if (options.failInventoryRelease) {
        return { ok: false, errorCode: "INVENTORY_RELEASE_FAILED", message: "庫存釋放更新失敗" };
      }
      if (tempStore.inventory[existingHold.item] !== undefined) {
        tempStore.inventory[existingHold.item] += releasedQuantity;
      }

      // Step 2: Holds status update
      if (options.failHoldWrite) {
        return { ok: false, errorCode: "HOLD_WRITE_FAILED", message: "保留物品狀態更新失敗" };
      }
      const holdIdx = tempStore.holds.findIndex(h => h.id === reservationNumber);
      if (holdIdx !== -1) {
        tempStore.holds[holdIdx] = {
          ...tempStore.holds[holdIdx],
          status: "CANCELLED",
          reservationStatus: "CANCELLED",
          updatedAt: new Date().toISOString()
        };
      }

      // Step 3: Audit log write
      if (options.failAuditLogWrite) {
        return { ok: false, errorCode: "AUDIT_LOG_WRITE_FAILED", message: "操作紀錄寫入失敗" };
      }
      tempStore.auditLogs.push({
        id: "AUDIT-" + Date.now(),
        workId: reservationNumber,
        action: "CANCEL_RELEASE",
        operator: operator,
        operatorRole: operatorRole,
        fromStatus: existingHold.status,
        toStatus: "CANCELLED",
        details: "取消劃扣保留單 " + reservationNumber + "，釋放數量：" + releasedQuantity,
        createdAt: new Date().toISOString()
      });

      // Complete atomic commit: copy sandbox tempStore to store in one operation
      Object.assign(store, tempStore);

      return {
        ok: true,
        inventoryReleased: true,
        holdUpdated: true,
        auditLogged: true,
        atomic: true
      };
    }
  };
}

runSuite("cancel-release-hold", [
  {
    name: "1. Missing formal transaction adapter MUST fail-closed with CANCEL_TRANSACTION_ADAPTER_MISSING, zero writes, and no releasedQuantity",
    run() {
      const context = createVmContext();
      const res = context.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin" },
        cancelPayload: { reservationNumber: "RES-20260826-001" }
      });

      assert(res.ok === false, "Missing transaction adapter MUST fail closed (ok: false)");
      assert(res.errorCode === "CANCEL_TRANSACTION_ADAPTER_MISSING", "errorCode MUST be CANCEL_TRANSACTION_ADAPTER_MISSING");
      assert(res.releasedQuantity === undefined, "releasedQuantity MUST NOT be returned when adapter is missing");
    }
  },
  {
    name: "2. Read error during hold lookup MUST fail-closed with READ_HOLDS_FAILED without swallowing exception",
    run() {
      const context = createVmContext();
      const store = createMockStore();
      const adapter = createMockTxAdapter(store, { throwOnReadHold: true });

      const res = context.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin" },
        cancelPayload: { reservationNumber: "RES-20260826-001" }
      }, adapter);

      assert(res.ok === false, "Read error MUST fail closed (ok: false)");
      assert(res.errorCode === "READ_HOLDS_FAILED", "errorCode MUST be READ_HOLDS_FAILED");
      assert(res.releasedQuantity === undefined, "releasedQuantity MUST NOT be returned on read failure");
    }
  },
  {
    name: "3. Non-existent hold MUST fail-closed with HOLD_NOT_FOUND",
    run() {
      const context = createVmContext();
      const store = createMockStore([]);
      const adapter = createMockTxAdapter(store);

      const res = context.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin" },
        cancelPayload: { reservationNumber: "RES-NONEXISTENT" }
      }, adapter);

      assert(res.ok === false, "Non-existent hold MUST fail closed (ok: false)");
      assert(res.errorCode === "HOLD_NOT_FOUND", "errorCode MUST be HOLD_NOT_FOUND");
      assert(res.releasedQuantity === undefined, "releasedQuantity MUST NOT be returned when hold is not found");
    }
  },
  {
    name: "4. Already cancelled hold MUST fail-closed with ALREADY_CANCELLED",
    run() {
      const context = createVmContext();
      const store = createMockStore([{
        id: "RES-20260826-002",
        item: "STU-6101",
        quantity: 5,
        status: "CANCELLED"
      }]);
      const adapter = createMockTxAdapter(store);

      const res = context.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin" },
        cancelPayload: { reservationNumber: "RES-20260826-002" }
      }, adapter);

      assert(res.ok === false, "Already cancelled hold MUST be rejected (ok: false)");
      assert(res.errorCode === "ALREADY_CANCELLED", "errorCode MUST be ALREADY_CANCELLED");
      assert(res.releasedQuantity === undefined, "releasedQuantity MUST NOT be returned on already cancelled hold");
    }
  },
  {
    name: "5. Full transaction adapter provided and succeeds -> updates inventory, holds, and audit logs atomically with verified state",
    run() {
      const context = createVmContext();
      const store = createMockStore([{
        id: "RES-20260826-003",
        storeName: "美麗空間",
        item: "STU-6101",
        quantity: 5,
        status: "ACTIVE"
      }]);
      const adapter = createMockTxAdapter(store);

      const res = context.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin", displayName: "管理員" },
        cancelPayload: { reservationNumber: "RES-20260826-003" }
      }, adapter);

      assert(res.ok === true, "Transaction MUST succeed when all steps pass");
      assert(res.status === "CANCELLED", "Result status MUST be CANCELLED");
      assert(res.releasedQuantity === 5, "Released quantity MUST equal 5");

      // Verify actual data mutated in store
      const holdInStore = store.holds.find(h => h.id === "RES-20260826-003");
      assert(holdInStore.status === "CANCELLED", "Hold status MUST be CANCELLED");
      assert(store.inventory["STU-6101"] === 15, "Inventory MUST be incremented by 5 (10 -> 15)");
      assert(store.auditLogs.length === 1, "Audit log MUST be created");
      assert(store.auditLogs[0].action === "CANCEL_RELEASE", "Audit log action MUST be CANCEL_RELEASE");
      assert(store.auditLogs[0].toStatus === "CANCELLED", "Audit log toStatus MUST be CANCELLED");
    }
  },
  {
    name: "6. Transaction adapter inventory release failure MUST fail-closed with zero store changes and no releasedQuantity",
    run() {
      const context = createVmContext();
      const store = createMockStore([{
        id: "RES-20260826-004",
        item: "STU-6101",
        quantity: 4,
        status: "ACTIVE"
      }]);
      const adapter = createMockTxAdapter(store, { failInventoryRelease: true });

      const res = context.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin" },
        cancelPayload: { reservationNumber: "RES-20260826-004" }
      }, adapter);

      assert(res.ok === false, "Inventory release failure MUST fail closed");
      assert(res.errorCode === "INVENTORY_RELEASE_FAILED", "errorCode MUST be INVENTORY_RELEASE_FAILED");
      assert(res.releasedQuantity === undefined, "releasedQuantity MUST NOT be returned on failure");

      // Verify zero changes in store
      const holdInStore = store.holds.find(h => h.id === "RES-20260826-004");
      assert(holdInStore.status === "ACTIVE", "Hold status MUST remain ACTIVE");
      assert(store.inventory["STU-6101"] === 10, "Inventory MUST remain 10 (zero partial change)");
      assert(store.auditLogs.length === 0, "Audit log MUST NOT be written");
    }
  },
  {
    name: "7. Transaction adapter holds write failure MUST fail-closed with zero store changes and no releasedQuantity",
    run() {
      const context = createVmContext();
      const store = createMockStore([{
        id: "RES-20260826-005",
        item: "STU-6101",
        quantity: 3,
        status: "ACTIVE"
      }]);
      const adapter = createMockTxAdapter(store, { failHoldWrite: true });

      const res = context.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin" },
        cancelPayload: { reservationNumber: "RES-20260826-005" }
      }, adapter);

      assert(res.ok === false, "Holds write failure MUST fail closed");
      assert(res.errorCode === "HOLD_WRITE_FAILED", "errorCode MUST be HOLD_WRITE_FAILED");
      assert(res.releasedQuantity === undefined, "releasedQuantity MUST NOT be returned on failure");

      // Verify zero changes in store
      const holdInStore = store.holds.find(h => h.id === "RES-20260826-005");
      assert(holdInStore.status === "ACTIVE", "Hold status MUST remain ACTIVE");
      assert(store.inventory["STU-6101"] === 10, "Inventory MUST remain 10 (zero partial change)");
      assert(store.auditLogs.length === 0, "Audit log MUST NOT be written");
    }
  },
  {
    name: "8. Transaction adapter audit log write failure MUST fail-closed with zero store changes and no releasedQuantity",
    run() {
      const context = createVmContext();
      const store = createMockStore([{
        id: "RES-20260826-006",
        item: "STU-6101",
        quantity: 2,
        status: "ACTIVE"
      }]);
      const adapter = createMockTxAdapter(store, { failAuditLogWrite: true });

      const res = context.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin" },
        cancelPayload: { reservationNumber: "RES-20260826-006" }
      }, adapter);

      assert(res.ok === false, "Audit log write failure MUST fail closed");
      assert(res.errorCode === "AUDIT_LOG_WRITE_FAILED", "errorCode MUST be AUDIT_LOG_WRITE_FAILED");
      assert(res.releasedQuantity === undefined, "releasedQuantity MUST NOT be returned on failure");

      // Verify zero changes in store
      const holdInStore = store.holds.find(h => h.id === "RES-20260826-006");
      assert(holdInStore.status === "ACTIVE", "Hold status MUST remain ACTIVE");
      assert(store.inventory["STU-6101"] === 10, "Inventory MUST remain 10 (zero partial change)");
      assert(store.auditLogs.length === 0, "Audit log MUST NOT be written");
    }
  },
  {
    name: "9. Transaction adapter returning incomplete proof fields MUST fail-closed with CANCEL_TRANSACTION_INCOMPLETE",
    run() {
      const context = createVmContext();
      const store = createMockStore([{
        id: "RES-20260826-007",
        item: "STU-6101",
        quantity: 2,
        status: "ACTIVE"
      }]);
      const incompleteAdapter = {
        findHoldById(id) {
          return store.holds.find(h => h.id === id) || null;
        },
        executeCancelReleaseTransaction() {
          // Missing atomic: true proof field
          return { ok: true, inventoryReleased: true, holdUpdated: true, auditLogged: true, atomic: false };
        }
      };

      const res = context.cancelReleaseHoldAction({
        userContext: { username: "admin01", role: "admin" },
        cancelPayload: { reservationNumber: "RES-20260826-007" }
      }, incompleteAdapter);

      assert(res.ok === false, "Incomplete proof fields MUST fail closed");
      assert(res.errorCode === "CANCEL_TRANSACTION_INCOMPLETE", "errorCode MUST be CANCEL_TRANSACTION_INCOMPLETE");
      assert(res.releasedQuantity === undefined, "releasedQuantity MUST NOT be returned when transaction is incomplete");
    }
  }
]);
