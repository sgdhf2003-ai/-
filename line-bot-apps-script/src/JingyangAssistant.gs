// 勁揚業務管家 LINE 外掛模組
// 原則：只處理明確的業務管家指令，不改寫原本庫存機器人的查詢流程。

var JINGYANG_ASSISTANT_DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw/exec";
var JINGYANG_ASSISTANT_DEFAULT_APP_URL = "https://brown-phi.vercel.app/";
var JINGYANG_ASSISTANT_MENU_IMAGE_URL = "https://brown-phi.vercel.app/sales_rich_menu.jpg";
var JINGYANG_ASSISTANT_MENU_NAME = "Jingyang Business Manager Menu v3";
var JINGYANG_ASSISTANT_SPREADSHEET_ID = "1BtroF_mFVlC3mXyw7vO09H244636Vc6nVseW_0qS2Ss";

function JingyangAssistant_tryHandleLineEvent(event) {
  if (!event || event.type !== "message" || !event.message || event.message.type !== "text") return false;

  var text = String(event.message.text || "").trim();
  var command = JingyangAssistant_parseCommand_(text);
  if (!command) return false;

  var replyToken = event.replyToken;
  var userId = event.source && event.source.userId ? event.source.userId : "";

  try {
    var replyText = JingyangAssistant_buildReply_(command, userId);
    replyToLine(replyToken, replyText, true);
    if (typeof writeLogToSheet === "function") {
      writeLogToSheet(text, replyText, "業務管家模組已回覆", "");
    }
  } catch (err) {
    var errorText = "業務管家目前讀取資料時發生問題，原本庫存機器人不受影響。\n錯誤：" + JingyangAssistant_safeText_(err && err.message ? err.message : err);
    replyToLine(replyToken, errorText, true);
    if (typeof writeLogToSheet === "function") {
      writeLogToSheet(text, errorText, "業務管家模組錯誤", "");
    }
  }

  return true;
}

function JingyangAssistant_parseCommand_(text) {
  var value = String(text || "").trim();
  if (!value) return null;

  if (/^(業務管家|業務管家說明|業務管家 help)$/i.test(value)) {
    return { type: "help" };
  }

  if (/^(建立業務管家選單|更新業務管家選單|設定業務管家選單)$/i.test(value)) {
    return { type: "setupMenu" };
  }

  if (/^(綁定|綁定業務管家|業務管家綁定)$/i.test(value)) {
    return { type: "bind" };
  }

  if (/^(我的保留|全部保留)$/i.test(value)) {
    return { type: "holds", mode: "all" };
  }

  if (/^(今日保留|查詢保留|保留查詢|即期保留|保留提醒)$/i.test(value)) {
    return { type: "holds", mode: "due" };
  }

  var storeMatch = value.match(/^(查詢店家|店家查詢|查詢|店家)\s+(.+)$/i);
  if (storeMatch && storeMatch[2]) {
    return { type: "store", keyword: storeMatch[2].trim() };
  }

  return null;
}

function JingyangAssistant_buildReply_(command, lineUserId) {
  if (command.type === "help") return JingyangAssistant_helpText_();
  if (command.type === "bind") return JingyangAssistant_bindText_(lineUserId);

  if (command.type === "setupMenu") {
    var setupUser = JingyangAssistant_findUserByLineId_({ users: JingyangAssistant_readUsers_() }, lineUserId);
    return JingyangAssistant_setupMenuReply_(setupUser, lineUserId);
  }

  var data = JingyangAssistant_readAll_();
  var user = JingyangAssistant_findUserByLineId_(data, lineUserId);
  if (command.type === "holds") return JingyangAssistant_buildHoldsReply_(data, user, command.mode);
  if (command.type === "store") return JingyangAssistant_buildStoreReply_(data, user, command.keyword);

  return JingyangAssistant_helpText_();
}

function JingyangAssistant_helpText_() {
  return "勁揚業務管家可用指令：\n" +
    "- 綁定業務管家：取得登入綁定連結\n" +
    "- 我的保留：查看名下保留項目\n" +
    "- 今日保留：查看即將到期保留\n" +
    "- 查詢 店家關鍵字：查店家電話、地址與保留\n" +
    "- 建立業務管家選單：建立並綁定 LINE 圖文選單";
}

function JingyangAssistant_bindText_(lineUserId) {
  var appUrl = JingyangAssistant_getAppUrl_();
  var sep = appUrl.indexOf("?") === -1 ? "?" : "&";
  var bindUrl = appUrl + sep + "lineUserId=" + encodeURIComponent(lineUserId || "");
  return "請開啟以下連結登入「勁揚業務管家」，即可完成 LINE 綁定：\n" + bindUrl;
}

function JingyangAssistant_buildHoldsReply_(data, user, mode) {
  if (!user) return JingyangAssistant_unboundText_();

  var storesById = JingyangAssistant_makeLookup_(data.stores || [], "id");
  var holds = JingyangAssistant_visibleHolds_(data.holds || [], user);
  if (mode === "due") {
    var today = JingyangAssistant_startOfDay_(new Date());
    var sevenDays = JingyangAssistant_addDays_(today, 7);
    holds = holds.filter(function(hold) {
      var due = JingyangAssistant_getHoldDueDate_(hold);
      return due && due <= sevenDays;
    });
  }

  holds.sort(function(a, b) {
    var da = JingyangAssistant_getHoldDueDate_(a);
    var db = JingyangAssistant_getHoldDueDate_(b);
    return (da ? da.getTime() : 9999999999999) - (db ? db.getTime() : 9999999999999);
  });

  if (!holds.length) {
    return mode === "due" ? "目前沒有一週內即將到期的保留提醒。" : "目前沒有未結案的保留項目。";
  }

  var title = mode === "due" ? "即將到期保留" : "我的保留";
  var lines = holds.slice(0, 15).map(function(hold) {
    var store = storesById[hold.storeId] || {};
    var storeName = hold.storeName || store.name || "未指定店家";
    var due = JingyangAssistant_getHoldDueDate_(hold);
    return "- " + storeName + "\n  保留：" + (hold.item || "未填物品") + " / " + (hold.quantity || "1") + "\n  時間：" + JingyangAssistant_formatDate_(hold.holdDate) + " 至 " + JingyangAssistant_formatDate_(due) + "\n  業務：" + (hold.salesOwner || store.salesOwner || "未填");
  });

  var more = holds.length > 15 ? "\n\n僅顯示前 15 筆，其餘請開啟 App 查看。" : "";
  return "勁揚業務管家 - " + title + "\n\n" + lines.join("\n\n") + more;
}

function JingyangAssistant_buildStoreReply_(data, user, keyword) {
  if (!user) return JingyangAssistant_unboundText_();

  var key = JingyangAssistant_normalize_(keyword);
  if (!key) return "請輸入店家名稱或客戶編號，例如：查詢 寶鴻";

  var stores = data.stores || [];
  if (user.role !== "admin") {
    stores = stores.filter(function(store) {
      return String(store.salesOwner || "") === String(user.salesOwner || "");
    });
  }

  var matches = stores.filter(function(store) {
    var haystack = [
      store.customerCode,
      store.name,
      store.shortName,
      store.phone,
      store.phone2,
      store.mobile,
      store.address,
      store.contactName
    ].join(" ");
    return JingyangAssistant_normalize_(haystack).indexOf(key) !== -1;
  }).slice(0, 5);

  if (!matches.length) return "找不到符合「" + keyword + "」的店家。";

  var openHolds = JingyangAssistant_visibleHolds_(data.holds || [], user);
  var holdsByStore = {};
  openHolds.forEach(function(hold) {
    if (!holdsByStore[hold.storeId]) holdsByStore[hold.storeId] = [];
    holdsByStore[hold.storeId].push(hold);
  });

  var lines = matches.map(function(store) {
    var holds = holdsByStore[store.id] || [];
    var holdLine = holds.length
      ? "保留：" + holds.slice(0, 3).map(function(h) { return (h.item || "未填物品") + "x" + (h.quantity || "1"); }).join("、")
      : "保留：目前無未結案";
    return (store.customerCode ? store.customerCode + " | " : "") + (store.name || "未命名店家") + "\n" +
      "業務：" + (store.salesOwner || "未填") + "\n" +
      "電話：" + JingyangAssistant_joinNonEmpty_([store.phone, store.phone2, store.mobile], " / ") + "\n" +
      "地址：" + (store.address || "未填") + "\n" +
      holdLine;
  });

  return "店家查詢結果\n\n" + lines.join("\n\n");
}

function JingyangAssistant_setupMenuReply_(user, lineUserId) {
  if (!user) return JingyangAssistant_unboundText_();
  if (user.role !== "admin" && user.role !== "sales" && user.role !== "retail") {
    return "此帳號沒有建立業務管家選單的權限。";
  }

  var menuId = JingyangAssistant_ensureRichMenu_();
  JingyangAssistant_linkRichMenuToUser_(lineUserId, menuId);
  return "業務管家圖文選單已建立並綁定完成。\n下方選單會提供：查詢保留、查詢庫存、上傳照片。";
}

function JingyangAssistant_ensureRichMenu_() {
  var token = JingyangAssistant_getLineTokenOrNull_();
  var authorizationHeader = JingyangAssistant_getLineAuthorizationHeaderOrNull_(token, "JingyangAssistant_ensureRichMenu_");
  if (!authorizationHeader) {
    throw new Error("LINE_TOKEN_MISSING");
  }

  var existingId = JingyangAssistant_findRichMenuByName_(token, JINGYANG_ASSISTANT_MENU_NAME);
  if (existingId) return existingId;

  var menuConfig = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: JINGYANG_ASSISTANT_MENU_NAME,
    chatBarText: "業務管家",
    areas: [
      { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: "message", label: "查詢保留", text: "今日保留" } },
      { bounds: { x: 833, y: 0, width: 833, height: 843 }, action: { type: "uri", label: "查詢庫存", uri: JingyangAssistant_buildAppViewUrl_("inventory") } },
      { bounds: { x: 1666, y: 0, width: 834, height: 843 }, action: { type: "uri", label: "上傳照片", uri: JingyangAssistant_buildAppViewUrl_("samples") } }
    ]
  };

  var createRes = UrlFetchApp.fetch("https://api.line.me/v2/bot/richmenu", {
    method: "post",
    headers: {
      "Authorization": authorizationHeader,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(menuConfig),
    muteHttpExceptions: true
  });

  if (createRes.getResponseCode() !== 200) {
    throw new Error("建立 Rich Menu 失敗：" + createRes.getContentText());
  }

  var menuId = JSON.parse(createRes.getContentText()).richMenuId;
  JingyangAssistant_uploadRichMenuImage_(token, menuId);
  return menuId;
}

function JingyangAssistant_findRichMenuByName_(token, menuName) {
  var authorizationHeader = JingyangAssistant_getLineAuthorizationHeaderOrNull_(token, "JingyangAssistant_findRichMenuByName_");
  if (!authorizationHeader) return "";

  var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/richmenu/list", {
    method: "get",
    headers: { "Authorization": authorizationHeader },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) return "";

  var body = JSON.parse(res.getContentText() || "{}");
  var menus = body.richmenus || [];
  for (var i = 0; i < menus.length; i++) {
    if (menus[i].name === menuName) return menus[i].richMenuId;
  }
  return "";
}

function JingyangAssistant_uploadRichMenuImage_(token, menuId) {
  var authorizationHeader = JingyangAssistant_getLineAuthorizationHeaderOrNull_(token, "JingyangAssistant_uploadRichMenuImage_");
  if (!authorizationHeader) return false;

  var imageRes = UrlFetchApp.fetch(JINGYANG_ASSISTANT_MENU_IMAGE_URL, { muteHttpExceptions: true });
  if (imageRes.getResponseCode() < 200 || imageRes.getResponseCode() >= 300) {
    throw new Error("讀取選單圖片失敗 HTTP " + imageRes.getResponseCode());
  }

  var uploadRes = UrlFetchApp.fetch("https://api-data.line.me/v2/bot/richmenu/" + menuId + "/content", {
    method: "post",
    headers: {
      "Authorization": authorizationHeader,
      "Content-Type": "image/jpeg"
    },
    payload: imageRes.getBlob().getBytes(),
    muteHttpExceptions: true
  });

  if (uploadRes.getResponseCode() !== 200) {
    throw new Error("上傳 Rich Menu 圖片失敗：" + uploadRes.getContentText());
  }
}

function JingyangAssistant_linkRichMenuToUser_(lineUserId, menuId) {
  var authorizationHeader = JingyangAssistant_getLineAuthorizationHeaderOrNull_(
    JingyangAssistant_getLineTokenOrNull_(),
    "JingyangAssistant_linkRichMenuToUser_"
  );
  if (!authorizationHeader) return false;
  if (!lineUserId || !menuId) throw new Error("缺少 LINE 使用者或選單 ID");

  var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/user/" + lineUserId + "/richmenu/" + menuId, {
    method: "post",
    headers: { "Authorization": authorizationHeader },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error("綁定 Rich Menu 失敗：" + res.getContentText());
  }
}

function JingyangAssistant_readAll_() {
  var apiUrl = JingyangAssistant_getApiUrl_();
  var sep = apiUrl.indexOf("?") === -1 ? "?" : "&";
  var response = UrlFetchApp.fetch(apiUrl + sep + "action=readAll", { muteHttpExceptions: true });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error("API 回應失敗 HTTP " + code);

  var data = JSON.parse(response.getContentText() || "{}");
  if (!data.ok) throw new Error(data.error || "API 回傳 ok=false");

  data.users = JingyangAssistant_readUsersFromSpreadsheet_(data.spreadsheetId);
  return data;
}

function JingyangAssistant_readUsers_() {
  return JingyangAssistant_readUsersFromSpreadsheet_(JingyangAssistant_getSpreadsheetId_());
}

function JingyangAssistant_readUsersFromSpreadsheet_(spreadsheetId) {
  if (!spreadsheetId) return [];
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName("Users");
    if (!sheet) return [];
    return JingyangAssistant_sheetToObjects_(sheet);
  } catch (err) {
    return [];
  }
}

function JingyangAssistant_sheetToObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  var headers = values[0].map(function(h) { return String(h || "").trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    var hasValue = false;
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = values[r][c];
      if (values[r][c] !== "" && values[r][c] != null) hasValue = true;
    }
    if (hasValue) rows.push(obj);
  }
  return rows;
}

function JingyangAssistant_findUserByLineId_(data, lineUserId) {
  var users = data.users || [];
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].lineUserId || "").trim() === String(lineUserId || "").trim()) {
      return users[i];
    }
  }
  return null;
}

function JingyangAssistant_visibleHolds_(holds, user) {
  var filtered = holds.filter(function(hold) {
    var status = String(hold.status || "").trim();
    return status !== "done" && status !== "已完成" && status !== "結案" && status !== "deleted";
  });

  if (user && user.role !== "admin") {
    filtered = filtered.filter(function(hold) {
      return String(hold.salesOwner || "") === String(user.salesOwner || "");
    });
  }

  return filtered;
}

function JingyangAssistant_getHoldDueDate_(hold) {
  var explicit = JingyangAssistant_parseDate_(hold.expiresAt);
  if (explicit) return explicit;

  var start = JingyangAssistant_parseDate_(hold.holdDate) || JingyangAssistant_parseDate_(hold.createdAt);
  if (!start) return null;

  var text = [hold.note, hold.item, hold.reservationStatus].join(" ");
  if (text.indexOf("一週") !== -1 || text.indexOf("保留一週") !== -1) {
    return JingyangAssistant_addDays_(start, 7);
  }

  return JingyangAssistant_addMonths_(start, 2);
}

function JingyangAssistant_parseDate_(value) {
  return DateHelper_parseDate(value);
}

function JingyangAssistant_formatDate_(value) {
  return DateHelper_formatDate(value, "Asia/Taipei", "yyyy/MM/dd", "未填");
}

function JingyangAssistant_startOfDay_(date) {
  return DateHelper_startOfDay(date);
}

function JingyangAssistant_addDays_(date, days) {
  return DateHelper_addDays(date, days);
}

function JingyangAssistant_addMonths_(date, months) {
  return DateHelper_addMonths(date, months);
}

function JingyangAssistant_makeLookup_(items, key) {
  var lookup = {};
  (items || []).forEach(function(item) {
    if (item && item[key]) lookup[item[key]] = item;
  });
  return lookup;
}

function JingyangAssistant_joinNonEmpty_(items, glue) {
  return (items || []).filter(function(item) {
    return String(item || "").trim() !== "";
  }).join(glue || " ");
}

function JingyangAssistant_normalize_(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function JingyangAssistant_safeText_(value) {
  return String(value || "").replace(/\s+/g, " ").slice(0, 300);
}

function JingyangAssistant_unboundText_() {
  return "此 LINE 尚未綁定業務管家帳號。\n請先輸入「綁定業務管家」，再用您的帳號密碼登入完成綁定。";
}

function JingyangAssistant_getApiUrl_() {
  return PropertiesService.getScriptProperties().getProperty("JINGYANG_MANAGER_API_URL") || JINGYANG_ASSISTANT_DEFAULT_API_URL;
}

function JingyangAssistant_getSpreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty("JINGYANG_MANAGER_SPREADSHEET_ID") || JINGYANG_ASSISTANT_SPREADSHEET_ID;
}

function JingyangAssistant_getAppUrl_() {
  return PropertiesService.getScriptProperties().getProperty("JINGYANG_MANAGER_APP_URL") || JINGYANG_ASSISTANT_DEFAULT_APP_URL;
}

function JingyangAssistant_buildAppViewUrl_(view) {
  var appUrl = JingyangAssistant_getAppUrl_();
  var sep = appUrl.indexOf("?") === -1 ? "?" : "&";
  return appUrl + sep + "view=" + encodeURIComponent(view);
}

function JingyangAssistant_getLineTokenOrNull_() {
  var token = PropertiesService.getScriptProperties().getProperty("JINGYANG_LINE_CHANNEL_ACCESS_TOKEN") ||
    PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_ACCESS_TOKEN") ||
    (typeof CHANNEL_ACCESS_TOKEN !== "undefined" ? CHANNEL_ACCESS_TOKEN : "");
  token = String(token || "").trim();
  return token ? token : null;
}

function JingyangAssistant_logLineSecurityError_(code, context) {
  var safeCode = String(code || "LINE_SECURITY_ERROR");
  var safeContext = String(context || "jingyang-assistant").replace(/[^A-Za-z0-9_.:-]/g, "_").substring(0, 80);
  Logger.log("[LINE_SECURITY] " + safeCode + " context=" + safeContext);
}

function JingyangAssistant_getLineAuthorizationHeaderOrNull_(token, context) {
  token = String(token || "").trim();
  if (!token) {
    JingyangAssistant_logLineSecurityError_("LINE_TOKEN_MISSING", context);
    return null;
  }
  return "Bearer " + token;
}

function JingyangAssistant_getLineToken_() {
  return JingyangAssistant_getLineTokenOrNull_() || "";
}
