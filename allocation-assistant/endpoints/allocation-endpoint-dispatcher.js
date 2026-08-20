"use strict";

/**
 * Allocation Endpoint Dispatcher (Phase 6-C Consolidation Suite)
 * Provides unified, fail-closed endpoint action dispatchers with session auth,
 * role authorization, ID equality contracts, and 7-column ledger schema validation.
 */

class AllocationEndpointDispatcher {
  constructor(options = {}) {
    this.sheetAdapter = options.sheetAdapter || null;
    this.fulfillmentAdapter = options.fulfillmentAdapter || null;
  }

  /**
   * Unified Session Auth Evaluation.
   * Enforces valid userContext presence and role non-empty.
   */
  static evaluateEndpointSessionAuth(userContext) {
    if (!userContext || typeof userContext !== 'object') {
      return {
        ok: false,
        errorCode: "INVALID_SESSION_USER",
        message: "登入狀態失效或缺少使用者權限脈絡"
      };
    }

    const role = userContext.role ? String(userContext.role).trim().toLowerCase() : "";
    if (!role || role === "unknown" || role === "無") {
      return {
        ok: false,
        errorCode: "INVALID_SESSION_USER",
        message: "登入狀態失效或缺少使用者權限脈絡"
      };
    }

    return {
      ok: true,
      user: userContext,
      role
    };
  }

  /**
   * Unified Role Authorization Guard.
   * Restricts write actions to allowed roles (default: admin, boss, assistant).
   */
  static evaluateEndpointRoleAuthorization(userContext, allowedRoles = ["admin", "boss", "assistant"]) {
    const authResult = AllocationEndpointDispatcher.evaluateEndpointSessionAuth(userContext);
    if (!authResult.ok) {
      return authResult;
    }

    const forbiddenRoles = ["sales", "retailsales", "showroomsales", "retail"];
    if (forbiddenRoles.includes(authResult.role) || !allowedRoles.includes(authResult.role)) {
      return {
        ok: false,
        errorCode: "UNAUTHORIZED_ROLE",
        message: "您目前的權限角色無法執行劃扣與出貨操作"
      };
    }

    return authResult;
  }

  /**
   * fulfillHoldAction(data, options)
   * Dispatches outbound partial/full fulfillment with role boundary & 7-column ledger row.
   */
  fulfillHoldAction(data, options = {}) {
    const dataObj = data || {};
    const userContext = dataObj.userContext || dataObj.user || (options && options.userContext) || null;

    const authCheck = AllocationEndpointDispatcher.evaluateEndpointRoleAuthorization(userContext);
    if (!authCheck.ok) {
      return authCheck;
    }

    const fulfillPayload = dataObj.fulfillPayload || dataObj;
    const reservationNumber = (fulfillPayload && fulfillPayload.reservationNumber) || "";
    const quantity = Number((fulfillPayload && fulfillPayload.quantity) || 0);
    const totalQuantity = Number((fulfillPayload && fulfillPayload.totalQuantity) || quantity);

    if (!reservationNumber || quantity <= 0) {
      return {
        ok: false,
        errorCode: "INVALID_FULFILL_PAYLOAD",
        message: "部分銷扣出貨數量無效"
      };
    }

    if (quantity > totalQuantity) {
      return {
        ok: false,
        errorCode: "EXCEEDS_REMAINING_QUANTITY",
        message: "銷扣數量超過劃扣保留數量"
      };
    }

    const remainingQty = Math.max(0, totalQuantity - quantity);
    const targetStatus = remainingQty === 0 ? "FULFILLED" : "PARTIAL_FULFILLED";
    const actionType = fulfillPayload.action || (remainingQty === 0 ? "FULFILL_DEDUCT" : "PARTIAL_FULFILL_DEDUCT");
    const item = fulfillPayload.item || "品項";
    const timestamp = (options && options.timestamp) || new Date().toISOString();

    // Enforce 7-column ledger row schema
    const ledgerRow = [
      reservationNumber,
      actionType,
      item,
      quantity,
      remainingQty,
      targetStatus,
      timestamp
    ];

    if (this.sheetAdapter && typeof this.sheetAdapter.recordInventoryAdjustment === 'function') {
      const recordResult = this.sheetAdapter.recordInventoryAdjustment({
        reservationNumber,
        action: actionType,
        item,
        quantity,
        remainingQuantity: remainingQty,
        status: targetStatus,
        updatedAt: timestamp
      });
      if (!recordResult || recordResult.success !== true) {
        return {
          ok: false,
          errorCode: (recordResult && recordResult.errorCode) || "WRITEBACK_FAILED",
          message: "劃扣銷扣出貨紀錄寫回失敗"
        };
      }
    }

    return {
      ok: true,
      reservationNumber,
      remainingQuantity: remainingQty,
      status: targetStatus,
      ledgerRow,
      notificationBypassed: true,
      message: "劃扣銷扣出貨成功"
    };
  }

  /**
   * cancelReleaseHoldAction(data, options)
   * Dispatches formal hold cancellation & stock release with 7-column ledger row.
   */
  cancelReleaseHoldAction(data, options = {}) {
    const dataObj = data || {};
    const userContext = dataObj.userContext || dataObj.user || (options && options.userContext) || null;

    const authCheck = AllocationEndpointDispatcher.evaluateEndpointRoleAuthorization(userContext);
    if (!authCheck.ok) {
      return authCheck;
    }

    const cancelPayload = dataObj.cancelPayload || dataObj;
    const reservationNumber = (cancelPayload && cancelPayload.reservationNumber) || "";

    if (!reservationNumber) {
      return {
        ok: false,
        errorCode: "INVALID_CANCEL_PAYLOAD",
        message: "取消釋放劃扣單號無效"
      };
    }

    const item = cancelPayload.item || "品項";
    const quantity = Number((cancelPayload && cancelPayload.quantity) || 0);
    const timestamp = (options && options.timestamp) || new Date().toISOString();

    // Enforce 7-column ledger row schema
    const ledgerRow = [
      reservationNumber,
      "CANCEL_RELEASE",
      item,
      quantity,
      0,
      "CANCELLED",
      timestamp
    ];

    if (this.sheetAdapter && typeof this.sheetAdapter.recordInventoryAdjustment === 'function') {
      const recordResult = this.sheetAdapter.recordInventoryAdjustment({
        reservationNumber,
        action: "CANCEL_RELEASE",
        item,
        quantity,
        remainingQuantity: 0,
        status: "CANCELLED",
        updatedAt: timestamp
      });
      if (!recordResult || recordResult.success !== true) {
        return {
          ok: false,
          errorCode: (recordResult && recordResult.errorCode) || "WRITEBACK_FAILED",
          message: "劃扣取消寫回失敗"
        };
      }
    }

    const customerName = cancelPayload.customerName || cancelPayload.storeName || "未知客戶";
    const notificationMessage = `🚫【劃扣保留取消通知】\n` +
      `保留單號：${reservationNumber}\n` +
      `店家：${customerName}\n` +
      `品項：${item}\n` +
      `釋放數量：${quantity}\n` +
      `狀態：CANCELLED`;

    // Security Guard: Ignore client POST body parameters for notification policy.
    // Read ONLY from verified server options, sessionUser, or persisted hold record.
    const notificationBypassedReq = options.notificationBypassed !== undefined ? options.notificationBypassed : true;
    const sessionUser = options.sessionUser || null;
    const existingHold = options.existingHold || null;
    const recipientLineUserId = options.recipientLineUserId || (sessionUser && sessionUser.lineUserId) || (existingHold && existingHold.lineUserId) || null;
    const userOptInStatus = options.userOptInStatus || (sessionUser && (sessionUser.userOptInStatus || sessionUser.optInStatus)) || (recipientLineUserId ? 'OPTED_IN' : 'OPTED_OUT');
    const pilotWhitelist = options.serverPilotWhitelist || options.pilotWhitelist || [];
    const simulatedApiError = Boolean(options.simulatedApiError);

    let policyFn = null;
    try {
      policyFn = require("../rules/allocation-rules.js").evaluateLineNotificationPolicy;
    } catch (e) {
      if (typeof global !== 'undefined' && typeof global.evaluateLineNotificationPolicy === 'function') {
        policyFn = global.evaluateLineNotificationPolicy;
      }
    }

    let policyResult = { success: true, bypassed: true, failureCode: 'NOTIFICATION_BYPASSED' };
    if (typeof policyFn === 'function') {
      policyResult = policyFn({
        notificationBypassed: notificationBypassedReq,
        operatorRole: userContext ? userContext.role : '',
        recipientLineUserId,
        userOptInStatus,
        tokenConfigured: options.tokenConfigured !== undefined ? options.tokenConfigured : true,
        adapterInjected: options.adapterInjected !== undefined ? options.adapterInjected : true,
        simulatedApiError,
        pilotWhitelist,
        reservationNumber,
        intent: 'CANCEL_RELEASE'
      });
    }

    const notificationSent = policyResult.success === true && policyResult.delivered === true;
    const notificationBypassed = !notificationSent;

    return {
      ok: true,
      reservationNumber,
      remainingQuantity: 0,
      releasedQuantity: quantity,
      status: "CANCELLED",
      ledgerRow,
      notificationBypassed,
      notificationSent,
      lineUserId: notificationSent ? recipientLineUserId : null,
      notificationMessage,
      notificationDetails: {
        reservationNumber,
        customerName,
        item,
        releasedQuantity: quantity,
        status: "CANCELLED"
      },
      policyResult,
      message: "劃扣保留取消與庫存釋放成功"
    };
  }

  /**
   * readbackAuditAction(data, options)
   * Dispatches reservation audit & readback query returning redacted outputs.
   */
  readbackAuditAction(data, options = {}) {
    const dataObj = data || {};
    const userContext = dataObj.userContext || dataObj.user || (options && options.userContext) || null;

    const authCheck = AllocationEndpointDispatcher.evaluateEndpointSessionAuth(userContext);
    if (!authCheck.ok) {
      return authCheck;
    }

    const queryPayload = dataObj.queryPayload || dataObj;
    const reservationNumber = (queryPayload && queryPayload.reservationNumber) || "";

    if (!reservationNumber) {
      return {
        ok: false,
        errorCode: "INVALID_QUERY_PAYLOAD",
        message: "查詢單號無效"
      };
    }

    let record = null;
    let found = false;

    if (this.sheetAdapter && typeof this.sheetAdapter.queryHoldByReservationNumber === 'function') {
      const queryResult = this.sheetAdapter.queryHoldByReservationNumber(reservationNumber);
      if (queryResult && queryResult.found) {
        found = true;
        const rawRec = queryResult.record || {};
        record = {
          id: rawRec.id || reservationNumber,
          reservationNumber,
          storeName: rawRec.storeName || "",
          item: rawRec.item || "",
          quantity: Number(rawRec.quantity || 0),
          remainingQuantity: Number(rawRec.remainingQuantity || 0),
          status: rawRec.status || "ACTIVE"
        };
      }
    } else {
      return {
        ok: false,
        errorCode: "READBACK_ADAPTER_MISSING",
        message: "劃扣讀回資料轉接器缺失"
      };
    }

    if (!found) {
      return {
        ok: true,
        found: false,
        reservationNumber,
        record: null,
        readbackRedacted: true
      };
    }

    return {
      ok: true,
      found: true,
      reservationNumber,
      record,
      readbackRedacted: true
    };
  }
}

module.exports = {
  AllocationEndpointDispatcher
};
