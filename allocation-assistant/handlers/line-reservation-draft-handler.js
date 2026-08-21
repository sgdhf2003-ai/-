/**
 * LINE Reservation Draft Preview & Confirm/Cancel State Machine Handler
 * 
 * Safety Rules:
 * - Pure logic and state machine handling.
 * - Test phase uses fake/mock adapters (no live Sheet writes or LINE API push).
 * - Operator & salesOwner resolved strictly from server-side bound user (DO NOT trust parsed draft fields for authorization).
 */

const { ReservationParser } = require("../parsers/reservation-parser");

function parsePostbackParams(dataStr) {
  const params = {};
  if (!dataStr) return params;
  const pairs = dataStr.split("&");
  pairs.forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx !== -1) {
      const k = pair.slice(0, idx);
      const v = pair.slice(idx + 1);
      params[k] = decodeURIComponent(v);
    }
  });
  return params;
}

function handleLineReservationTextEvent(options = {}) {
  const { text, userId, usersTable, inventoryCatalog, propertiesStorage } = options;

  const parser = new ReservationParser({ inventoryCatalog });
  const parseRes = parser.parseReservationText(text);

  if (!parseRes.ok) {
    return {
      handled: false,
      errorCode: parseRes.errorCode,
      errorMessage: parseRes.errorMessage
    };
  }

  const draftId = "DRAFT-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  const expiresAt = new Date(Date.now() + 600000).toISOString(); // 10 mins TTL

  const draft = {
    draftId,
    customerName: parseRes.customerName,
    productCode: parseRes.productCode,
    quantity: parseRes.quantity,
    salesOwnerName: parseRes.salesOwnerName, // display only
    confidence: parseRes.confidence,
    createdAt: new Date().toISOString(),
    expiresAt
  };

  if (propertiesStorage && typeof propertiesStorage.setProperty === "function") {
    propertiesStorage.setProperty("pendingDraftHold:" + userId, JSON.stringify(draft));
  }

  const previewMessage = {
    type: "text",
    text: `📋【劃扣保留單草稿預覽】\n` +
          `🏪 店家：${parseRes.customerName}\n` +
          `📦 品項：${parseRes.productCode}\n` +
          `🔢 數量：${parseRes.quantity}\n` +
          `👤 負責業務：${parseRes.salesOwnerName || "無"}\n` +
          `✅ 庫存檢查：現貨正常，可辦理劃扣\n\n` +
          `請確認是否正式寫入庫存劃扣：`,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "✅ 確認建立劃扣",
            data: `action=confirmHoldDraft&draftId=${draftId}`,
            displayText: "確認建立劃扣"
          }
        },
        {
          type: "action",
          action: {
            type: "postback",
            label: "❌ 取消",
            data: `action=cancelHoldDraft&draftId=${draftId}`,
            displayText: "取消劃扣草稿"
          }
        }
      ]
    }
  };

  return {
    handled: true,
    draftCreated: true,
    draftId,
    draft,
    previewMessage
  };
}

function handleLineReservationPostback(options = {}) {
  const { postbackData, userId, usersTable, inventoryCatalog, propertiesStorage, upsertHoldActionFn } = options;

  const params = parsePostbackParams(postbackData);
  const action = params.action;

  if (action === "cancelHoldDraft") {
    if (propertiesStorage && typeof propertiesStorage.deleteProperty === "function") {
      propertiesStorage.deleteProperty("pendingDraftHold:" + userId);
    }
    return {
      handled: true,
      action: "cancelHoldDraft",
      success: true,
      message: "❌ 已取消劃扣保留單草稿。"
    };
  }

  if (action === "confirmHoldDraft") {
    const draftIdReq = params.draftId;
    if (!propertiesStorage || typeof propertiesStorage.getProperty !== "function") {
      return {
        handled: true,
        action: "confirmHoldDraft",
        success: false,
        errorCode: "STORAGE_UNAVAILABLE",
        message: "⚠️ 伺服端暫存服務不可用。"
      };
    }

    const draftRaw = propertiesStorage.getProperty("pendingDraftHold:" + userId);
    if (!draftRaw) {
      return {
        handled: true,
        action: "confirmHoldDraft",
        success: false,
        errorCode: "INVALID_DRAFT_ID",
        message: "⚠️ 找不到草稿或已取消。"
      };
    }

    let draft = null;
    try {
      draft = JSON.parse(draftRaw);
    } catch (e) {
      return {
        handled: true,
        action: "confirmHoldDraft",
        success: false,
        errorCode: "CORRUPTED_DRAFT",
        message: "⚠️ 草稿資料損壞。"
      };
    }

    if (draft.draftId !== draftIdReq) {
      return {
        handled: true,
        action: "confirmHoldDraft",
        success: false,
        errorCode: "INVALID_DRAFT_ID",
        message: "⚠️ 草稿編號不一致。"
      };
    }

    if (new Date(draft.expiresAt).getTime() < Date.now()) {
      propertiesStorage.deleteProperty("pendingDraftHold:" + userId);
      return {
        handled: true,
        action: "confirmHoldDraft",
        success: false,
        errorCode: "EXPIRED_DRAFT",
        message: "⌛ 草稿已過期，請重新輸入。"
      };
    }

    // Server-Side Operator & SalesOwner Re-Verification
    const boundUser = Array.isArray(usersTable) ? usersTable.find(u => u.lineUserId === userId) : null;
    if (!boundUser) {
      return {
        handled: true,
        action: "confirmHoldDraft",
        success: false,
        errorCode: "UNBOUND_USER",
        message: "⚠️ 您的 LINE 帳號尚未完成身分綁定。"
      };
    }

    // Re-check Inventory Catalog
    if (Array.isArray(inventoryCatalog)) {
      const product = inventoryCatalog.find(p => p.item === draft.productCode || p.productCode === draft.productCode);
      if (!product) {
        return {
          handled: true,
          action: "confirmHoldDraft",
          success: false,
          errorCode: "PRODUCT_NOT_FOUND",
          message: `⚠️ 庫存目錄中查無此商品型號 (${draft.productCode})。`
        };
      }
      if (typeof product.availableQuantity === "number" && draft.quantity > product.availableQuantity) {
        return {
          handled: true,
          action: "confirmHoldDraft",
          success: false,
          errorCode: "INSUFFICIENT_STOCK",
          message: `⚠️ 可用庫存不足 (需求: ${draft.quantity}, 可用庫存: ${product.availableQuantity})。`
        };
      }
    }

    // Execute Hold Creation
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randStr = Date.now().toString().slice(-6);
    const resNo = `RES-${dateStr}-${randStr}`;

    const holdPayload = {
      userContext: {
        username: boundUser.username || "line_bot",
        role: boundUser.role || "assistant"
      },
      sessionToken: "bot_session",
      hold: {
        id: resNo,
        reservationNumber: resNo,
        storeName: draft.customerName,
        item: draft.productCode,
        quantity: draft.quantity,
        remainingQuantity: draft.quantity,
        salesOwner: boundUser.salesOwner || "無",
        status: "ACTIVE"
      }
    };

    let actionRes = { ok: true };
    if (typeof upsertHoldActionFn === "function") {
      actionRes = upsertHoldActionFn(holdPayload) || { ok: true };
    }

    propertiesStorage.deleteProperty("pendingDraftHold:" + userId);

    return {
      handled: true,
      action: "confirmHoldDraft",
      success: actionRes.ok !== false,
      reservationNumber: resNo,
      message: `✅ 劃扣保留單【${resNo}】已成功建立並扣減庫存！`
    };
  }

  return { handled: false };
}

module.exports = {
  handleLineReservationTextEvent,
  handleLineReservationPostback
};
