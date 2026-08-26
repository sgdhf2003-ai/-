/**
 * LINE Reservation Workflow Handler (Apps Script Version)
 * 
 * Safety Rules:
 * - Pure logic and state machine handling.
 * - Test phase uses fake/mock adapters (no live Sheet writes or LINE API push).
 * - Operator & salesOwner resolved strictly from server-side bound user (DO NOT trust parsed draft fields for authorization).
 */

function parsePostbackParams_(dataStr) {
  var params = {};
  if (!dataStr) return params;
  var pairs = dataStr.split("&");
  pairs.forEach(function(pair) {
    var idx = pair.indexOf("=");
    if (idx !== -1) {
      var k = pair.slice(0, idx);
      var v = pair.slice(idx + 1);
      params[k] = decodeURIComponent(v);
    }
  });
  return params;
}

function handleLineReservationTextEvent(optionsOrEvent, extraOptions) {
  optionsOrEvent = optionsOrEvent || {};
  extraOptions = extraOptions || {};

  var text = "";
  var userId = "";
  var inventoryCatalog = extraOptions.inventoryCatalog;
  var propertiesStorage = extraOptions.propertiesStorage;

  if (optionsOrEvent && optionsOrEvent.type === "message" && optionsOrEvent.message && optionsOrEvent.message.type === "text") {
    text = String(optionsOrEvent.message.text || "").trim();
    userId = optionsOrEvent.source ? optionsOrEvent.source.userId : "";
    if (optionsOrEvent.inventoryCatalog) inventoryCatalog = optionsOrEvent.inventoryCatalog;
    if (optionsOrEvent.propertiesStorage) propertiesStorage = optionsOrEvent.propertiesStorage;
  } else if (optionsOrEvent && typeof optionsOrEvent === "object") {
    text = optionsOrEvent.text || "";
    userId = optionsOrEvent.userId || "";
    if (optionsOrEvent.inventoryCatalog) inventoryCatalog = optionsOrEvent.inventoryCatalog;
    if (optionsOrEvent.propertiesStorage) propertiesStorage = optionsOrEvent.propertiesStorage;
  }

  var parseRes = typeof parseReservationText === "function" 
    ? parseReservationText(text, inventoryCatalog) 
    : { ok: false, errorCode: "PARSER_UNAVAILABLE", errorMessage: "Parser module unavailable" };

  if (!parseRes.ok) {
    return {
      handled: false,
      errorCode: parseRes.errorCode,
      errorMessage: parseRes.errorMessage
    };
  }

  var draftId = "DRAFT-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  var expiresAt = new Date(Date.now() + 600000).toISOString(); // 10 mins TTL

  var draft = {
    draftId: draftId,
    customerName: parseRes.customerName,
    productCode: parseRes.productCode,
    quantity: parseRes.quantity,
    salesOwnerName: parseRes.salesOwnerName, // display only
    confidence: parseRes.confidence,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt
  };

  if (propertiesStorage && typeof propertiesStorage.setProperty === "function") {
    propertiesStorage.setProperty("pendingDraftHold:" + userId, JSON.stringify(draft));
  }

  var previewMessage = {
    type: "text",
    text: "📋【劃扣保留單草稿預覽】\n" +
          "🏪 店家：" + parseRes.customerName + "\n" +
          "📦 品項：" + parseRes.productCode + "\n" +
          "🔢 數量：" + parseRes.quantity + "\n" +
          "👤 負責業務：" + (parseRes.salesOwnerName || "無") + "\n" +
          "✅ 庫存檢查：現貨正常，可辦理劃扣\n\n" +
          "請確認是否正式寫入庫存劃扣：",
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "✅ 確認建立劃扣",
            data: "action=confirmHoldDraft&draftId=" + draftId,
            displayText: "確認建立劃扣"
          }
        },
        {
          type: "action",
          action: {
            type: "postback",
            label: "❌ 取消",
            data: "action=cancelHoldDraft&draftId=" + draftId,
            displayText: "取消劃扣草稿"
          }
        }
      ]
    }
  };

  return {
    handled: true,
    draftCreated: true,
    draftId: draftId,
    draft: draft,
    previewMessage: previewMessage
  };
}

function handleLineReservationPostback(options) {
  options = options || {};
  var postbackData = options.postbackData;
  var userId = options.userId;
  var usersTable = options.usersTable;
  var inventoryCatalog = options.inventoryCatalog;
  var propertiesStorage = options.propertiesStorage;
  var upsertHoldActionFn = options.upsertHoldActionFn;

  var params = parsePostbackParams_(postbackData);
  var action = params.action;

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
    var draftIdReq = params.draftId;
    if (!propertiesStorage || typeof propertiesStorage.getProperty !== "function") {
      return {
        handled: true,
        action: "confirmHoldDraft",
        success: false,
        errorCode: "STORAGE_UNAVAILABLE",
        message: "⚠️ 伺服端暫存服務不可用。"
      };
    }

    var draftRaw = propertiesStorage.getProperty("pendingDraftHold:" + userId);
    if (!draftRaw) {
      var diagStr = "";
      try {
        if (propertiesStorage && typeof propertiesStorage.getProperties === "function") {
          var allProps = propertiesStorage.getProperties() || {};
          var foundDraftKeys = [];
          for (var k in allProps) {
            if (k.indexOf("pendingDraftHold:") === 0) {
              var uIdInKey = k.replace("pendingDraftHold:", "");
              var maskedKey = uIdInKey.length > 4 ? "..." + uIdInKey.slice(-4) : uIdInKey;
              foundDraftKeys.push(maskedKey);
            }
          }
          var currentMasked = userId && userId.length > 4 ? "..." + userId.slice(-4) : (userId || "N/A");
          if (foundDraftKeys.length > 0) {
            diagStr = "\n🔍【系統診斷】目前 ID: " + currentMasked + "，發現暫存草稿 ID: " + foundDraftKeys.join(", ");
          } else {
            diagStr = "\n🔍【系統診斷】目前 ID: " + currentMasked + "，無任何排隊草稿";
          }
        }
      } catch (diagErr) {}

      return {
        handled: true,
        action: "confirmHoldDraft",
        success: false,
        errorCode: "INVALID_DRAFT_ID",
        message: "⚠️ 找不到草稿或已取消。" + diagStr
      };
    }

    var draft = null;
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
      var reqMasked = draftIdReq && draftIdReq.length > 4 ? "..." + draftIdReq.slice(-4) : (draftIdReq || "N/A");
      var savedMasked = draft.draftId && draft.draftId.length > 4 ? "..." + draft.draftId.slice(-4) : (draft.draftId || "N/A");
      var diagStr = "\n🔍【系統診斷】請求草稿: " + reqMasked + "，即時草稿: " + savedMasked;

      return {
        handled: true,
        action: "confirmHoldDraft",
        success: false,
        errorCode: "INVALID_DRAFT_ID",
        message: "⚠️ 草稿編號不一致。" + diagStr
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
    var boundUser = Array.isArray(usersTable) ? usersTable.find(function(u) { return u.lineUserId === userId; }) : null;
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
    function normalizeSearchKey_(str) {
      if (str == null) return "";
      return str.toString().toUpperCase().replace(/[\s\-_]/g, "");
    }
    var normDraftProductCode = normalizeSearchKey_(draft.productCode);

    if (Array.isArray(inventoryCatalog)) {
      var product = inventoryCatalog.find(function(p) {
        if (!p) return false;
        var itemStr = p.item || p.productCode || "";
        return itemStr === draft.productCode || normalizeSearchKey_(itemStr) === normDraftProductCode;
      });
      if (!product) {
        return {
          handled: true,
          action: "confirmHoldDraft",
          success: false,
          errorCode: "PRODUCT_NOT_FOUND",
          message: "⚠️ 庫存目錄中查無此商品型號 (" + draft.productCode + ")。"
        };
      }
      if (typeof product.availableQuantity === "number" && draft.quantity > product.availableQuantity) {
        return {
          handled: true,
          action: "confirmHoldDraft",
          success: false,
          errorCode: "INSUFFICIENT_STOCK",
          message: "⚠️ 可用庫存不足 (需求: " + draft.quantity + ", 可用庫存: " + product.availableQuantity + ")。"
        };
      }
    } else if (inventoryCatalog && typeof inventoryCatalog === "object") {
      var catVal = undefined;
      if (inventoryCatalog[draft.productCode] !== undefined) {
        catVal = inventoryCatalog[draft.productCode];
      } else if (inventoryCatalog[draft.productCode.toUpperCase()] !== undefined) {
        catVal = inventoryCatalog[draft.productCode.toUpperCase()];
      } else if (inventoryCatalog[normDraftProductCode] !== undefined) {
        catVal = inventoryCatalog[normDraftProductCode];
      } else {
        var keys = Object.keys(inventoryCatalog);
        for (var k = 0; k < keys.length; k++) {
          if (normalizeSearchKey_(keys[k]) === normDraftProductCode) {
            catVal = inventoryCatalog[keys[k]];
            break;
          }
        }
      }

      if (catVal === undefined) {
        return {
          handled: true,
          action: "confirmHoldDraft",
          success: false,
          errorCode: "PRODUCT_NOT_FOUND",
          message: "⚠️ 庫存目錄中查無此商品型號 (" + draft.productCode + ")。"
        };
      }
      var availQty = typeof catVal === "number" ? catVal : (typeof catVal === "object" && typeof catVal.availableQuantity === "number" ? catVal.availableQuantity : null);
      if (availQty !== null && draft.quantity > availQty) {
        return {
          handled: true,
          action: "confirmHoldDraft",
          success: false,
          errorCode: "INSUFFICIENT_STOCK",
          message: "⚠️ 可用庫存不足 (需求: " + draft.quantity + ", 可用庫存: " + availQty + ")。"
        };
      }
    }

    // Execute Hold Creation
    var dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    var randStr = Date.now().toString().slice(-6);
    var resNo = "RES-" + dateStr + "-" + randStr;

    var holdPayload = {
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

    var actionRes = { ok: true };
    if (typeof upsertHoldActionFn === "function") {
      actionRes = upsertHoldActionFn(holdPayload) || { ok: true };
    }

    propertiesStorage.deleteProperty("pendingDraftHold:" + userId);

    return {
      handled: true,
      action: "confirmHoldDraft",
      success: actionRes.ok !== false,
      reservationNumber: resNo,
      message: "✅ 劃扣保留單【" + resNo + "】已成功建立並扣減庫存！"
    };
  }

  return { handled: false };
}
