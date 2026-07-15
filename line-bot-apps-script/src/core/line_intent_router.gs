// LINE dual-mode intent router. Inventory intents return false so the existing
// inventory pipeline remains the single source of query behavior.

var LINE_STAFF_ROLES = {
  retailSales: true,
  showroomSales: true,
  assistant: true,
  boss: true,
  admin: true,
  // Backward-compatible roles already used by the current Users sheet.
  sales: true,
  retail: true
};

function normalizeLineText(text) {
  return String(text || "")
    .trim()
    .replace(/[ \u3000]+/g, "")
    .toLowerCase();
}

function normalizeLineModelText(text) {
  return normalizeLineText(text).replace(/[^a-z0-9\u3400-\u9fff]/g, "");
}

function isStaffUser(user) {
  if (!user) return false;
  var status = String(user.status || "").trim().toLowerCase();
  if (status === "停用" || status === "disabled" || status === "inactive") return false;
  return LINE_STAFF_ROLES[String(user.role || "").trim()] === true;
}

function getLineUserContext(lineUserId) {
  var fallback = {
    ok: true,
    mode: "customer",
    userId: "",
    lineUserId: String(lineUserId || ""),
    username: "",
    displayName: "",
    role: "customer",
    salesOwner: "",
    status: ""
  };

  try {
    if (typeof JingyangAssistant_readUsers_ !== "function") return fallback;
    var users = JingyangAssistant_readUsers_() || [];
    for (var i = 0; i < users.length; i++) {
      var user = users[i] || {};
      if (String(user.lineUserId || "").trim() !== String(lineUserId || "").trim()) continue;

      if (!isStaffUser(user)) return fallback;
      return {
        ok: true,
        mode: "staff",
        userId: String(user.id || ""),
        lineUserId: String(lineUserId || ""),
        username: String(user.username || ""),
        displayName: String(user.displayName || ""),
        role: String(user.role || ""),
        salesOwner: String(user.salesOwner || ""),
        status: String(user.status || "")
      };
    }
  } catch (err) {
    Logger.log("[LINE_MODE] context lookup failed: " + String(err));
  }

  return fallback;
}

function isInventoryLikeText(text) {
  var normalized = normalizeLineText(text);
  var modelText = normalizeLineModelText(text);
  if (!normalized) return false;

  if (/(庫存|商品|型號|編號|尺寸|促銷|預留|保留)/.test(normalized)) return true;
  if (/\d{2,3}[x×＊*]\d{2,3}/i.test(String(text || ""))) return true;
  if (/^(eq|kk)[a-z0-9]+$/i.test(modelText)) return true;
  if (/^[a-z]{1,8}\d[a-z0-9]{2,}$/i.test(modelText)) return true;
  if (/^\d+[a-z]+\d*$/i.test(modelText)) return true;
  return false;
}

function isStaffCommand(text) {
  var value = normalizeLineText(text);
  return /^(選單|menu|工作選單|員工選單|今日|今日工作|工作|今天工作|新增工作|新增|建立工作|交辦|記一件事|待處理|助理|助理工作|加工送貨|今日總覽|主管總覽|老闆總覽|異常提醒|業務進度|今日門市|今日摘要|工作中心)$/.test(value);
}

function isCustomerCommand(text) {
  return /^(客服|聯絡客服|型錄|官網|說明|幫助|帮助|help|instructions?|歡迎|欢迎)$/.test(normalizeLineText(text));
}

function detectLineIntent(text, userContext) {
  var rawText = String(text || "");
  var normalizedText = normalizeLineText(rawText);
  var mode = userContext && userContext.mode === "staff" ? "staff" : "customer";
  var role = String(userContext && userContext.role || "customer");
  var result = {
    intent: "unknown",
    mode: mode,
    confidence: 0.3,
    rawText: rawText,
    normalizedText: normalizedText
  };

  if (isInventoryLikeText(rawText)) {
    result.intent = "inventory";
    result.confidence = 0.9;
    return result;
  }

  if (isCustomerCommand(rawText)) {
    result.intent = "customer_help";
    result.confidence = 1;
    return result;
  }

  if (mode !== "staff") {
    // Internal commands remain unknown in Customer Mode and therefore receive
    // the customer-only fallback instead of reaching an internal handler.
    if (isStaffCommand(rawText)) return result;
    // Existing inventory search accepts Chinese series and product keywords.
    // Preserve that broad behavior instead of narrowing it in the router.
    if (normalizedText) {
      result.intent = "inventory";
      result.confidence = 0.5;
    }
    return result;
  }

  if (/^(選單|menu|工作選單|員工選單)$/.test(normalizedText)) {
    result.intent = "staff_menu";
    result.confidence = 1;
  } else if (/^(今日|今日工作|工作|今天工作|今日門市|今日摘要|工作中心)$/.test(normalizedText)) {
    result.intent = "work_today";
    result.confidence = (normalizedText === "今日門市" || normalizedText === "今日摘要" || normalizedText === "工作中心") ? 0.9 : 1;
  } else if (/^(新增工作|新增|建立工作|交辦|記一件事)$/.test(normalizedText)) {
    result.intent = "work_create";
    result.confidence = 1;
  } else if (/^(待處理|助理|助理工作|助理中心|加工送貨)$/.test(normalizedText)) {
    if (/^(assistant|admin|boss)$/.test(role)) {
      result.intent = "assistant_center";
      result.confidence = 1;
    } else if (/^(retailSales|showroomSales)$/.test(role)) {
      result.intent = "work_today";
      result.confidence = 1;
    }
  } else if (/^(查看異常|助理異常)$/.test(normalizedText) &&
             /^(assistant|admin|boss)$/.test(role)) {
    result.intent = "assistant_abnormal";
    result.confidence = 1;
  } else if (/^(今日總覽|主管總覽|老闆總覽|異常提醒|業務進度)$/.test(normalizedText) &&
             /^(boss|admin)$/.test(role)) {
    result.intent = "boss_overview";
    result.confidence = 1;
  } else if (!isStaffCommand(rawText) && normalizedText) {
    // Staff can query the same free-form product keywords without switching mode.
    result.intent = "inventory";
    result.confidence = 0.5;
  }

  return result;
}

function buildCustomerLineFallback() {
  return "您好，您可以輸入商品型號或關鍵字查詢庫存，例如 EQ-1721。也可以點選下方選單查看官網、型錄或聯絡客服。";
}

function buildStaffLineFallback() {
  return "我可以協助你：\n" +
    "1. 查庫存：直接輸入型號，例如 EQ-1721\n" +
    "2. 今日工作：輸入「今日摘要」或「今日工作」\n" +
    "3. 新增工作：輸入「新增工作」\n" +
    "4. 選單：輸入「選單」";
}

function replyStaffRoleMenu(user) {
  var lines = [
    "工作選單",
    "1. 查庫存：直接輸入商品型號",
    "2. 今日工作：輸入「今日摘要」或「今日工作」",
    "3. 新增工作：輸入「新增工作」"
  ];
  if (/^(assistant|admin|boss)$/.test(String(user && user.role || ""))) {
    lines.push("4. 助理中心：輸入「待處理」");
  }
  if (/^(boss|admin)$/.test(String(user && user.role || ""))) {
    lines.push("5. 主管總覽：輸入「今日總覽」");
  }
  return lines.join("\n");
}

function replyMyTasks(user) {
  var name = String(user && (user.displayName || user.username) || "同仁");
  var role = String(user && user.role || "");
  var roleLabel = "";
  if (role === "retailSales" || role === "retail" || role === "sales") {
    roleLabel = "零售業務";
  } else if (role === "showroomSales" || role === "showroom") {
    roleLabel = "門市業務";
  } else if (role === "assistant") {
    roleLabel = "助理";
  } else if (role === "boss" || role === "admin" || role === "manager") {
    roleLabel = "主管";
  }

  var lines = [
    "您好，" + name + "。" + (roleLabel ? " (角色：" + roleLabel + ")" : ""),
    "您的工作中心與今日摘要已準備好，請開啟下方連結查看：",
    LineIntent_getWorkCenterUrl_("tasks"),
    "",
    "可在工作中心查看：",
    "・今日工作摘要",
    "・最近任務動態",
    "・任務清單與篩選",
    "・一鍵複製摘要"
  ];
  return lines.join("\n");
}

function startWorkCaptureFlow(user) {
  return "請開啟工作中心新增工作：\n" + LineIntent_getWorkCenterUrl_("tasks");
}

function replyAssistantCenter(user) {
  var tasks = getAssistantTasks_();
  var counts = {
    orderInput: 0,
    reservationConfirm: 0,
    processingArrange: 0,
    deliveryArrange: 0,
    stockReply: 0,
    faxHandling: 0,
    blocked: 0
  };

  tasks.forEach(function(t) {
    if (t.assignedRole !== "assistant") return;
    if (t.status === "Finished" || t.status === "Cancelled") return;
    if (t.status === "Blocked") {
      counts.blocked++;
      return;
    }
    
    var type = t.type;
    if (type === "orderInput") counts.orderInput++;
    else if (type === "reservationConfirm" || type === "reservation") counts.reservationConfirm++;
    else if (type === "processingArrange" || type === "processing") counts.processingArrange++;
    else if (type === "deliveryArrange" || type === "delivery") counts.deliveryArrange++;
    else if (type === "stockReply" || type === "reminder") counts.stockReply++;
    else if (type === "faxHandling") counts.faxHandling++;
  });

  var flexContents = {
    "type": "bubble",
    "body": {
      "type": "box",
      "layout": "vertical",
      "contents": [
        {
          "type": "text",
          "text": "今天待處理工作摘要",
          "weight": "bold",
          "size": "md",
          "color": "#111111"
        },
        {
          "type": "separator",
          "margin": "sm"
        },
        {
          "type": "box",
          "layout": "vertical",
          "margin": "md",
          "spacing": "xs",
          "contents": [
            { "type": "text", "text": "📄 待打訂單：" + counts.orderInput + " 筆", "size": "sm" },
            { "type": "text", "text": "📦 待確認保留：" + counts.reservationConfirm + " 筆", "size": "sm" },
            { "type": "text", "text": "🏭 待安排加工：" + counts.processingArrange + " 筆", "size": "sm" },
            { "type": "text", "text": "🚚 待安排送貨：" + counts.deliveryArrange + " 筆", "size": "sm" },
            { "type": "text", "text": "☎️ 待回覆問貨：" + counts.stockReply + " 筆", "size": "sm" },
            { "type": "text", "text": "⚠️ 異常待確認：" + counts.blocked + " 筆", "size": "sm", "color": counts.blocked > 0 ? "#ff0000" : "#555555" }
          ]
        }
      ]
    }
  };

  return {
    "type": "flex",
    "altText": "今天待處理工作摘要",
    "contents": flexContents,
    "quickReply": {
      "items": [
        {
          "type": "action",
          "action": {
            "type": "postback",
            "label": "開始處理",
            "data": "action=assistant_start_flow",
            "displayText": "開始處理"
          }
        },
        {
          "type": "action",
          "action": {
            "type": "uri",
            "label": "查看全部",
            "uri": LineIntent_getWorkCenterUrl_("holds")
          }
        },
        {
          "type": "action",
          "action": {
            "type": "uri",
            "label": "只看緊急",
            "uri": LineIntent_getWorkCenterUrl_("holds") + "&filter=urgent"
          }
        },
        {
          "type": "action",
          "action": {
            "type": "postback",
            "label": "查看異常",
            "data": "action=assistant_show_abnormal",
            "displayText": "查看異常"
          }
        }
      ]
    }
  };
}

function replyAssistantAbnormal(user) {
  var tasks = getAssistantTasks_();
  var blockedTasks = tasks.filter(function(t) {
    return t.assignedRole === "assistant" && t.status === "Blocked";
  });
  if (blockedTasks.length === 0) {
    return "目前沒有異常待確認的工作，太棒了！";
  }
  var lines = ["⚠️ 異常待確認工作："];
  blockedTasks.forEach(function(t, idx) {
    var typeLabel = mapTypeToChinese_(t.type);
    lines.push((idx + 1) + ". 【" + typeLabel + "】" + t.title + " (" + (t.blockedReason || "未說明原因") + ")");
  });
  return lines.join("\n");
}

function replyBossOverview(user) {
  return "請開啟主管工作中心查看今日總覽：\n" + LineIntent_getWorkCenterUrl_("dashboard");
}

function replyCustomerHelp(user) {
  return "您好，您可以直接輸入商品型號查詢庫存，例如 EQ-1721。\n" +
    "需要型錄、官網或人工協助時，請使用下方選單聯絡客服。";
}

function LineIntent_getWorkCenterUrl_(view) {
  if (typeof JingyangAssistant_buildAppViewUrl_ === "function") {
    return JingyangAssistant_buildAppViewUrl_(view);
  }
  if (typeof JINGYANG_ASSISTANT_DEFAULT_APP_URL !== "undefined") {
    return JINGYANG_ASSISTANT_DEFAULT_APP_URL;
  }
  return "https://brown-phi.vercel.app/";
}

function LineIntent_defaultHandlers_() {
  return {
    inventory: function() { return false; },
    replyStaffRoleMenu: replyStaffRoleMenu,
    replyMyTasks: replyMyTasks,
    startWorkCaptureFlow: startWorkCaptureFlow,
    replyAssistantCenter: replyAssistantCenter,
    replyAssistantAbnormal: replyAssistantAbnormal,
    replyBossOverview: replyBossOverview,
    replyCustomerHelp: replyCustomerHelp,
    customerFallback: buildCustomerLineFallback,
    staffFallback: buildStaffLineFallback
  };
}

function routeLineIntent(intentResult, userContext, event, handlers) {
  handlers = handlers || LineIntent_defaultHandlers_();
  var intent = intentResult && intentResult.intent || "unknown";
  var handlerName = "";
  var response;

  if (intent === "inventory") {
    handlerName = "inventory";
    LineIntent_logRoute_(intent, handlerName);
    return handlers.inventory ? handlers.inventory(intentResult, userContext, event) : false;
  }

  if (intent === "staff_menu") handlerName = "replyStaffRoleMenu";
  else if (intent === "work_today") handlerName = "replyMyTasks";
  else if (intent === "work_create") handlerName = "startWorkCaptureFlow";
  else if (intent === "assistant_center") handlerName = "replyAssistantCenter";
  else if (intent === "assistant_abnormal") handlerName = "replyAssistantAbnormal";
  else if (intent === "boss_overview") handlerName = "replyBossOverview";
  else if (intent === "customer_help") handlerName = "replyCustomerHelp";
  else handlerName = userContext && userContext.mode === "staff" ? "staffFallback" : "customerFallback";

  LineIntent_logRoute_(intent, handlerName);
  response = handlers[handlerName](userContext, intentResult, event);
  if (event && event.replyToken && typeof replyToLine === "function") {
    replyToLine(event.replyToken, response, userContext && userContext.mode === "staff");
  }
  return true;
}

function LineIntent_logDetection_(lineUserId, userContext, intentResult) {
  Logger.log("[LINE_MODE] " + [lineUserId, userContext.mode, userContext.role].join(", "));
  Logger.log("[LINE_INTENT] " + [
    intentResult.rawText,
    intentResult.normalizedText,
    intentResult.intent,
    intentResult.confidence
  ].join(", "));
}

function LineIntent_logRoute_(intent, handlerName) {
  Logger.log("[LINE_ROUTE] " + intent + ", " + handlerName);
}

function LineIntent_tryHandleTextEvent(event) {
  if (!event || event.type !== "message" || !event.message || event.message.type !== "text") return false;
  var lineUserId = event.source && event.source.userId ? event.source.userId : "";
  var userContext = getLineUserContext(lineUserId);
  var intentResult = detectLineIntent(event.message.text, userContext);
  LineIntent_logDetection_(lineUserId, userContext, intentResult);
  return routeLineIntent(intentResult, userContext, event);
}

function getAssistantTasks_() {
  try {
    var ssId = JingyangAssistant_getSpreadsheetId_();
    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName("工作任務");
    if (!sheet) return [];
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) return [];
    var headers = values[0].map(function(h) { return String(h || "").trim(); });
    return values.slice(1).map(function(row) {
      return headers.reduce(function(obj, header, index) {
        obj[header] = row[index];
        return obj;
      }, {});
    });
  } catch (err) {
    Logger.log("getAssistantTasks_ failed: " + err.toString());
    return [];
  }
}

function mapTypeToChinese_(type) {
  var m = {
    orderInput: "待打訂單",
    reservationConfirm: "待確認保留",
    reservation: "待確認保留",
    processingArrange: "待安排加工",
    processing: "待安排加工",
    deliveryArrange: "待安排送貨",
    delivery: "待安排送貨",
    stockReply: "待回覆問貨",
    reminder: "待回覆問貨",
    faxHandling: "待處理傳真",
    complaintSupport: "待客訴處理",
    other: "其他"
  };
  return m[type] || type;
}
