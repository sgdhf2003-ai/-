const ROOT_FOLDER_ID = "1eOqcHag3qUO_Cd7n2Hv4A4Q3K8NKgXvB";
const SPREADSHEET_NAME = "勁揚業務管家後台";
const SHEETS = {
  stores: "店家資料",
  holds: "保留物品",
  projects: "案場報備",
  samples: "樣品與展示架",
  complaints: "售後客訴",
  users: "Users",
  settings: "系統設定",
};

const HEADERS = {
  stores: ["id", "customerCode", "name", "shortName", "salesOwner", "phone", "phone2", "mobile", "address", "region", "contactName", "taxId", "note", "createdAt", "updatedAt", "ownerEdited"],
  holds: ["id", "storeId", "storeName", "salesOwner", "item", "quantity", "reservationStatus", "holdAddress", "holdDate", "expiresAt", "reminderAt", "note", "status", "createdAt", "updatedAt"],
  projects: ["id", "storeId", "storeName", "salesOwner", "projectName", "projectAddress", "tileDetails", "expectedDeliveryDate", "status", "note", "createdAt", "updatedAt"],
  samples: ["id", "storeId", "storeName", "salesOwner", "itemType", "modelName", "quantity", "status", "driveUrl", "fileId", "note", "createdAt", "updatedAt"],
  complaints: ["id", "storeId", "storeName", "salesOwner", "issueDescription", "category", "driveUrl", "fileId", "status", "coordinationLog", "createdAt", "updatedAt"],
  users: ["id", "username", "displayName", "password", "role", "salesOwner", "status", "note", "createdAt", "updatedAt", "lineUserId"],
  settings: ["key", "value", "updatedAt"],
};

function doGet(e) {
  try {
    const data = parseQuery(e);
    const action = data.action || "readAll";
    if (action === "setup") return jsonOutput(setupBackend(data));
    if (action === "login") return jsonOutput(loginUser(data));
    if (action === "testLineNotify") return jsonOutput(testLineNotifyAction(data));
    return jsonOutput(readAll());
  } catch (error) {
    return jsonOutput({ ok: false, error: error.message || String(error) });
  }
}

function doPost(e) {
  try {
    const contents = e && e.postData && e.postData.contents ? e.postData.contents : "";
    if (contents.indexOf('"events"') !== -1) {
      handleLineWebhook(JSON.parse(contents));
      return HtmlService.createHtmlOutput("OK");
    }

    const data = JSON.parse(contents || "{}");
    const action = data.action || "readAll";
    if (action === "setup") return jsonOutput(setupBackend(data));
    if (action === "login") return jsonOutput(loginUser(data));
    if (action === "readAll") return jsonOutput(readAll());
    if (action === "snapshot") return jsonOutput(saveSnapshot(data));
    if (action === "readLogs") {
      const sheet = ensureSpreadsheet().getSheetByName("Logs");
      if (!sheet) return jsonOutput({ ok: true, logs: [] });
      const values = sheet.getDataRange().getValues();
      return jsonOutput({ ok: true, logs: values });
    }
    if (action === "upsertStore") return jsonOutput(upsertStores([data.store]));
    if (action === "upsertHold") return jsonOutput(upsertHolds([data.hold]));
    if (action === "upsertProject") return jsonOutput(upsertProjects([data.project]));
    if (action === "upsertSample") return jsonOutput(upsertSamples([data.sample]));
    if (action === "upsertComplaint") return jsonOutput(upsertComplaints([data.complaint]));
    if (action === "uploadPhoto") return jsonOutput(uploadPhoto(data));
    if (action === "saveSetting") return jsonOutput(saveSettingAction(data));
    if (action === "testLineNotify") return jsonOutput(testLineNotifyAction(data));
    throw new Error("Unknown action: " + action);
  } catch (error) {
    return jsonOutput({ ok: false, error: error.message || String(error) });
  }
}

function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function parseQuery(e) {
  return e && e.parameter ? e.parameter : {};
}

function setupBackend(data) {
  const spreadsheet = ensureSpreadsheet();
  ensureAllSheets(spreadsheet);
  ensureDefaultUsers();
  if (Array.isArray(data.stores) && data.stores.length) upsertStores(data.stores);
  setSetting("driveFolderId", getRootFolderId(data));
  setSetting("spreadsheetId", spreadsheet.getId());
  setSetting("spreadsheetUrl", spreadsheet.getUrl());
  return {
    ok: true,
    message: "Google 後台已建立",
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    driveFolderId: getRootFolderId(data),
  };
}

function saveSnapshot(data) {
  ensureAllSheets(ensureSpreadsheet());
  const userContext = data.userContext || null;
  if (Array.isArray(data.stores)) upsertStores(data.stores, true);
  if (Array.isArray(data.holds)) upsertHolds(data.holds, true, userContext);
  if (Array.isArray(data.projects)) upsertProjects(data.projects, true);
  if (Array.isArray(data.samples)) upsertSamples(data.samples, true);
  if (Array.isArray(data.complaints)) upsertComplaints(data.complaints, true);
  if (Array.isArray(data.photos)) upsertPhotos(data.photos, true);
  return { ok: true, message: "目前資料已同步到 Google Sheet" };
}

function overwriteObjects(sheetName, headers, objects) {
  const sheet = ensureSheet(ensureSpreadsheet(), sheetName, headers);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  }
  
  const validObjects = (objects || []).filter(Boolean);
  if (!validObjects.length) return;
  
  const rows = validObjects.map((object) => {
    return headers.map((header) => object[header] ?? "");
  });
  
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function readAll() {
  const spreadsheet = ensureSpreadsheet();
  ensureAllSheets(spreadsheet);
  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    driveFolderId: ROOT_FOLDER_ID,
    stores: readObjects(SHEETS.stores, HEADERS.stores),
    holds: readObjects(SHEETS.holds, HEADERS.holds),
    projects: readObjects(SHEETS.projects, HEADERS.projects),
    samples: readObjects(SHEETS.samples, HEADERS.samples),
    complaints: readObjects(SHEETS.complaints, HEADERS.complaints),
    settings: readObjects(SHEETS.settings, HEADERS.settings),
  };
}

function loginUser(data) {
  ensureAllSheets(ensureSpreadsheet());
  ensureDefaultUsers();
  const username = normalizeLoginValue(data.username || data.name || data.account);
  const password = String(data.password || "");
  if (!username || !password) throw new Error("請輸入帳號與密碼");

  const usersSheet = ensureSheet(ensureSpreadsheet(), SHEETS.users, HEADERS.users);
  const users = readObjects(SHEETS.users, HEADERS.users);
  
  let userIndex = -1;
  const user = users.find((item, index) => {
    const match = normalizeLoginValue(item.username) === username || normalizeLoginValue(item.displayName) === username;
    if (match) userIndex = index;
    return match;
  });
  if (!user) throw new Error("帳號或密碼錯誤");
  if (String(user.status || "").trim() !== "啟用") throw new Error("此帳號已停用，請聯絡管理員");
  if (String(user.password || "") !== password) throw new Error("帳號或密碼錯誤");

  // Save lineUserId to the user row in the spreadsheet if provided
  if (data.lineUserId && String(data.lineUserId).trim().startsWith("U")) {
    const lineUserId = String(data.lineUserId).trim();
    user.lineUserId = lineUserId;
    const rowNum = userIndex + 2;
    const colIndex = HEADERS.users.indexOf("lineUserId") + 1;
    if (colIndex > 0) {
      usersSheet.getRange(rowNum, colIndex).setValue(lineUserId);
    }
    
    // Bind the LINE Salesperson Rich Menu dynamically
    linkLineRichMenu(lineUserId, user.role);
    
    // Send a push confirmation message via the LINE bot
    sendLinePushMessage(lineUserId, "🎉 帳號綁定成功！\n您的 LINE 帳號已成功綁定為業務「" + user.displayName + "」，選單已切換為業務專用選單。");
  }

  const safeUser = sanitizeUser(user);
  return {
    ok: true,
    message: "登入成功",
    user: safeUser,
    permissions: getUserPermissions(safeUser),
  };
}

function uploadPhoto(data) {
  const spreadsheet = ensureSpreadsheet();
  ensureAllSheets(spreadsheet);
  const photo = data.photo || {};
  const imageDataUrl = data.imageDataUrl || "";
  const targetTable = data.targetTable || "photos";
  if (!photo.id) throw new Error("Missing photo id");
  if (!imageDataUrl.startsWith("data:image/")) throw new Error("Missing image data");

  const root = DriveApp.getFolderById(getRootFolderId(data));
  const storeFolder = getOrCreateFolder(root, sanitizeName(photo.storeName || photo.storeId || "未指定店家"));
  const createdAt = photo.createdAt ? new Date(photo.createdAt) : new Date();
  const timestamp = Utilities.formatDate(createdAt, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
  
  const prefix = targetTable === "samples" ? (photo.itemType || "樣品") : targetTable === "complaints" ? (photo.category || "客訴") : (photo.category || "照片");
  const fileName = sanitizeName(timestamp + "-" + prefix + "-" + (photo.storeName || "店家")) + ".jpg";
  const blob = dataUrlToBlob(imageDataUrl, fileName);
  const file = storeFolder.createFile(blob);
  const updatedAt = new Date().toISOString();
  
  const savedPhoto = {
    id: photo.id,
    storeId: photo.storeId,
    storeName: photo.storeName,
    salesOwner: photo.salesOwner,
    driveUrl: file.getUrl(),
    fileId: file.getId(),
    createdAt: photo.createdAt || updatedAt,
    updatedAt,
    ...photo
  };
  
  if (targetTable === "samples") {
    upsertSamples([savedPhoto]);
  } else if (targetTable === "complaints") {
    upsertComplaints([savedPhoto]);
  }
  return { ok: true, message: "照片已上傳 Google Drive", ...savedPhoto };
}

function upsertStores(stores, isSnapshot) {
  const rows = stores.filter(Boolean).map((store) => ({
    ...store,
    ownerEdited: normalizeBooleanValue(store.ownerEdited),
    updatedAt: new Date().toISOString(),
  }));
  if (isSnapshot) {
    overwriteObjects(SHEETS.stores, HEADERS.stores, rows);
  } else {
    upsertObjects(SHEETS.stores, HEADERS.stores, rows);
  }
  return { ok: true, message: "店家資料已同步" };
}

function upsertHolds(holds, isSnapshot, userContext) {
  logDebug("upsertHolds called with holds count: " + (holds ? holds.length : 0) + ", isSnapshot: " + isSnapshot + ", userContext: " + JSON.stringify(userContext));
  const storesById = makeLookup(readObjects(SHEETS.stores, HEADERS.stores), "id");
  const existingHolds = makeLookup(readObjects(SHEETS.holds, HEADERS.holds), "id");
  
  // If isSnapshot is true, check for deleted holds to send deduction notifications
  if (isSnapshot) {
    const incomingIds = new Set(holds.filter(Boolean).map(h => h.id));
    const deletedHolds = Object.values(existingHolds).filter(h => h && h.id && !incomingIds.has(h.id));
    logDebug("Detected deleted holds count: " + deletedHolds.length);
    
    deletedHolds.forEach((hold) => {
      const store = storesById[hold.storeId] || {};
      const storeName = hold.storeName || store.name || "未知店家";
      const owner = hold.salesOwner || store.salesOwner || "無";
      
      let msg = "🗑️ 保留項目扣除通知\n";
      msg += "━━━━━━━━━━━━━━━\n";
      msg += "🏬 店家：" + storeName + "\n";
      msg += "📦 項目：" + hold.item + " (" + (hold.quantity || "1") + ")\n";
      msg += "📅 原保留日：" + (hold.holdDate || "未設定") + "\n";
      msg += "📍 原保留地：" + (hold.holdAddress || "未填寫") + "\n";
      msg += "📝 備註：" + (hold.note || "無") + "\n";
      
      if (userContext && userContext.role === "admin") {
        // Admin deleted the hold -> Notify the local sales rep
        msg += "👤 扣除人員：管理員";
        logDebug("Admin deleted hold. Notifying owner: " + owner);
        sendOneSignalPush(owner, "保留扣除通知 🗑️", msg);
        sendLinePushToOwner(owner, msg);
      } else {
        // Sales rep deleted the hold -> Notify the admin (target "全部")
        const displayName = (userContext && userContext.displayName) || "業務";
        msg += "👤 扣除人員：業務 " + displayName;
        logDebug("Sales rep deleted hold. Notifying admins.");
        sendOneSignalPush("全部", "保留扣除通知 🗑️", msg);
        sendLinePushToOwner("全部", msg);
      }
    });
  }

  const rows = holds.filter(Boolean).map((hold) => {
    const store = storesById[hold.storeId] || {};
    const isNew = !existingHolds[hold.id];

    if (isNew) {
      const storeName = hold.storeName || store.name || "未知店家";
      const owner = hold.salesOwner || store.salesOwner || "無";
      
      let msg = "🔔 新保留物品提醒\n";
      msg += "━━━━━━━━━━━━━━━\n";
      msg += "🏬 店家：" + storeName + "\n";
      msg += "📦 項目：" + hold.item + " (" + (hold.quantity || "1") + ")\n";
      msg += "📅 日期：" + (hold.holdDate || "未設定") + " 至 " + (hold.expiresAt || "未設定") + "\n";
      msg += "📍 地點：" + (hold.holdAddress || "未填寫") + "\n";
      msg += "📝 備註：" + (hold.note || "無");
      
      logDebug("New hold created. Store: " + storeName + ", Owner: " + owner + ", Item: " + hold.item);
      sendOneSignalPush(owner, "新保留提醒 🔔", msg);
      sendLinePushToOwner(owner, msg);
    }

    return {
      ...hold,
      storeName: hold.storeName || store.name || "",
      salesOwner: hold.salesOwner || store.salesOwner || "",
      updatedAt: new Date().toISOString(),
    };
  });
  if (isSnapshot) {
    overwriteObjects(SHEETS.holds, HEADERS.holds, rows);
  } else {
    upsertObjects(SHEETS.holds, HEADERS.holds, rows);
  }
  return { ok: true, message: "保留物品已同步" };
}

function upsertPhotos(photos, isSnapshot) {
  const rows = photos.filter(Boolean);
  if (isSnapshot) {
    overwriteObjects(SHEETS.photos, HEADERS.photos, rows);
  } else {
    upsertObjects(SHEETS.photos, HEADERS.photos, rows);
  }
  return { ok: true, message: "照片紀錄已同步" };
}

function ensureDefaultUsers() {
  const existing = readObjects(SHEETS.users, HEADERS.users);
  if (existing.length) return;
  const now = new Date().toISOString();
  upsertObjects(SHEETS.users, HEADERS.users, [
    { id: "user-admin", username: "admin", displayName: "管理員", password: "admin123", role: "admin", salesOwner: "全部", status: "啟用", note: "預設管理員，請登入後到 Sheet 修改密碼", createdAt: now, updatedAt: now },
    { id: "user-cai", username: "cai", displayName: "蔡", password: "cai123", role: "sales", salesOwner: "蔡", status: "啟用", note: "預設業務帳號，請修改密碼", createdAt: now, updatedAt: now },
    { id: "user-lun", username: "lun", displayName: "倫", password: "lun123", role: "sales", salesOwner: "倫", status: "啟用", note: "預設業務帳號，請修改密碼", createdAt: now, updatedAt: now },
    { id: "user-hao", username: "hao", displayName: "豪", password: "hao123", role: "sales", salesOwner: "豪", status: "啟用", note: "預設業務帳號，請修改密碼", createdAt: now, updatedAt: now },
    { id: "user-sales001", username: "sales001", displayName: "業務001", password: "sales001", role: "sales", salesOwner: "業務001", status: "停用", note: "備用帳號，可改名後啟用", createdAt: now, updatedAt: now },
    { id: "user-sales002", username: "sales002", displayName: "業務002", password: "sales002", role: "sales", salesOwner: "業務002", status: "停用", note: "備用帳號，可改名後啟用", createdAt: now, updatedAt: now },
  ]);
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    salesOwner: user.salesOwner,
    status: user.status,
  };
}

function getUserPermissions(user) {
  const isAdmin = user.role === "admin";
  return {
    canViewAllStores: isAdmin,
    canManageUsers: isAdmin,
    canManageSettings: isAdmin,
    canUploadPhotos: true,
    canManageHolds: true,
    visibleSalesOwner: isAdmin ? "全部" : user.salesOwner,
  };
}

function normalizeLoginValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeBooleanValue(value) {
  return value === true || String(value || "").toLowerCase() === "true" || String(value || "") === "1";
}

function ensureSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty("SPREADSHEET_ID");
  if (existingId) return SpreadsheetApp.openById(existingId);

  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const files = root.getFilesByName(SPREADSHEET_NAME);
  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
      props.setProperty("SPREADSHEET_ID", file.getId());
      return SpreadsheetApp.openById(file.getId());
    }
  }

  const spreadsheet = SpreadsheetApp.create(SPREADSHEET_NAME);
  const file = DriveApp.getFileById(spreadsheet.getId());
  root.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  props.setProperty("SPREADSHEET_ID", spreadsheet.getId());
  return spreadsheet;
}

function ensureAllSheets(spreadsheet) {
  Object.keys(SHEETS).forEach((key) => ensureSheet(spreadsheet, SHEETS[key], HEADERS[key]));
}

function ensureSheet(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const currentWidth = Math.max(sheet.getLastColumn(), headers.length);
  const current = sheet.getRange(1, 1, 1, currentWidth).getValues()[0].filter(String);
  const samePrefix = current.length && current.every((header, index) => header === headers[index]);
  if (current.join("") !== headers.join("")) {
    if (samePrefix) {
      const missing = headers.slice(current.length);
      if (missing.length) {
        sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
      }
    } else if (sheet.getLastRow() <= 1) {
      sheet.clear();
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      throw new Error("Sheet header mismatch: " + name + "，請先確認欄位後再同步，避免清空資料。");
    }
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readObjects(sheetName, headers) {
  const sheet = ensureSheet(ensureSpreadsheet(), sheetName, headers);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values
    .map((row) => headers.reduce((object, header, index) => ({ ...object, [header]: row[index] }), {}))
    .filter((object) => object.id || object.key);
}

function upsertObjects(sheetName, headers, objects) {
  const sheet = ensureSheet(ensureSpreadsheet(), sheetName, headers);
  const existing = readObjects(sheetName, headers);
  const rowById = {};
  existing.forEach((object, index) => {
    const key = object.id || object.key;
    if (key) rowById[key] = index + 2;
  });
  objects.forEach((object) => {
    const key = object.id || object.key;
    if (!key) return;
    const row = headers.map((header) => object[header] ?? "");
    if (rowById[key]) sheet.getRange(rowById[key], 1, 1, headers.length).setValues([row]);
    else sheet.appendRow(row);
  });
}

function setSetting(key, value) {
  upsertObjects(SHEETS.settings, HEADERS.settings, [{ key, value, updatedAt: new Date().toISOString() }]);
}

function getRootFolderId(data) {
  return data.driveFolderId || ROOT_FOLDER_ID;
}

function getOrCreateFolder(parent, name) {
  const folders = parent.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(name);
}

function dataUrlToBlob(dataUrl, fileName) {
  const parts = dataUrl.split(",");
  const contentType = parts[0].match(/data:(.*);base64/)[1] || "image/jpeg";
  const bytes = Utilities.base64Decode(parts[1]);
  return Utilities.newBlob(bytes, contentType, fileName);
}

function sanitizeName(value) {
  return String(value || "未命名").replace(/[\\/:*?"<>|#%{}~&]/g, "-").slice(0, 120);
}

function makeLookup(items, key) {
  return items.reduce((lookup, item) => {
    lookup[item[key]] = item;
    return lookup;
  }, {});
}

function upsertProjects(projects, isSnapshot) {
  const storesById = makeLookup(readObjects(SHEETS.stores, HEADERS.stores), "id");
  const rows = projects.filter(Boolean).map((proj) => {
    const store = storesById[proj.storeId] || {};
    return {
      ...proj,
      storeName: proj.storeName || store.name || "",
      salesOwner: proj.salesOwner || store.salesOwner || "",
      updatedAt: new Date().toISOString(),
    };
  });
  if (isSnapshot) {
    overwriteObjects(SHEETS.projects, HEADERS.projects, rows);
  } else {
    upsertObjects(SHEETS.projects, HEADERS.projects, rows);
  }
  return { ok: true, message: "案場報備已同步" };
}

function upsertSamples(samples, isSnapshot) {
  const storesById = makeLookup(readObjects(SHEETS.stores, HEADERS.stores), "id");
  const rows = samples.filter(Boolean).map((item) => {
    const store = storesById[item.storeId] || {};
    return {
      ...item,
      storeName: item.storeName || store.name || "",
      salesOwner: item.salesOwner || store.salesOwner || "",
      updatedAt: new Date().toISOString(),
    };
  });
  if (isSnapshot) {
    overwriteObjects(SHEETS.samples, HEADERS.samples, rows);
  } else {
    upsertObjects(SHEETS.samples, HEADERS.samples, rows);
  }
  return { ok: true, message: "樣品與展架已同步" };
}

function upsertComplaints(complaints, isSnapshot) {
  const storesById = makeLookup(readObjects(SHEETS.stores, HEADERS.stores), "id");
  const rows = complaints.filter(Boolean).map((comp) => {
    const store = storesById[comp.storeId] || {};
    return {
      ...comp,
      storeName: comp.storeName || store.name || "",
      salesOwner: comp.salesOwner || store.salesOwner || "",
      updatedAt: new Date().toISOString(),
    };
  });
  if (isSnapshot) {
    overwriteObjects(SHEETS.complaints, HEADERS.complaints, rows);
  } else {
    upsertObjects(SHEETS.complaints, HEADERS.complaints, rows);
  }
  return { ok: true, message: "客訴紀錄已同步" };
}

function getSetting(key) {
  try {
    const settings = readObjects(SHEETS.settings, HEADERS.settings);
    const setting = settings.find((s) => s.key === key);
    return setting ? setting.value : "";
  } catch (e) {
    console.error("Read setting error:", e);
    return "";
  }
}

const DEFAULT_ONESIGNAL_APP_ID = 'eb4c23ab-9624-45f4-b5ef-0a8236b6fb22';

function sendOneSignalPush(salesperson, title, body) {
  const appId = getSetting("oneSignalAppId") || DEFAULT_ONESIGNAL_APP_ID;
  const apiKey = getSetting("oneSignalApiKey");
  if (!appId || !apiKey) return;

  const url = "https://onesignal.com/api/v1/notifications";
  const payload = {
    app_id: appId,
    include_aliases: {
      external_id: [salesperson]
    },
    target_channel: "push",
    contents: {
      en: body,
      zh: body
    },
    headings: {
      en: title,
      zh: title
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": "Key " + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  try {
    const response = UrlFetchApp.fetch(url, options);
    console.log("OneSignal push response: " + response.getContentText());
  } catch (e) {
    console.error("OneSignal push failed:", e);
  }
}

function saveSettingAction(data) {
  setSetting(data.key, data.value);
  return { ok: true, message: "設定已儲存" };
}

function testLineNotifyAction(data) {
  data = data || {};
  const appId = data.appId || getSetting("oneSignalAppId") || DEFAULT_ONESIGNAL_APP_ID;
  const apiKey = data.apiKey || getSetting("oneSignalApiKey");
  if (!appId || !apiKey) return { ok: false, error: "未設定 OneSignal App ID 或 REST API Key" };
  
  const url = "https://onesignal.com/api/v1/notifications";
  const payload = {
    app_id: appId,
    included_segments: ["Subscribed Users"],
    contents: {
      en: "測試推播成功！感謝您使用勁揚業務工作管家推播服務。🔔",
      zh: "測試推播成功！感謝您使用勁揚業務工作管家推播服務。🔔"
    },
    headings: {
      en: "勁揚業務管家測試通知",
      zh: "勁揚業務管家測試通知"
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": "Key " + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const resText = response.getContentText();
    const resObj = JSON.parse(resText);
    if (response.getResponseCode() === 200) {
      return { ok: true, message: "測試成功！OneSignal 已發送廣播推播。" };
    } else {
      return { ok: false, error: "OneSignal 推送失敗: " + (resObj.errors ? resObj.errors.join(", ") : resText) };
    }
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

function jsonOutput(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function triggerAuth() {
  UrlFetchApp.fetch("https://onesignal.com");
}

const DEFAULT_CHANNEL_ACCESS_TOKEN = 'LmKTad2eoLMSvaTu/WisCm25ONjqkbAj9me4cCcYijIPE1JyFMKL2TTTcYjPb2JI+Qb4t4yZUCdvNlaVd4gCy4TzzPgtwctDMFBdcba9KBdYVH4XmckKkwnkIbwFdhTxzWDX90GRauwvwWhVVrgGhQdB04t89/1O/w1cDnyilFU=';

function sendLinePushMessage(targetId, message) {
  logDebug("sendLinePushMessage called. targetId: " + targetId + ", message: " + message);
  if (!targetId) return;
  const token = getSetting("lineChannelAccessToken") || DEFAULT_CHANNEL_ACCESS_TOKEN;
  if (!token) return;

  const url = "https://api.line.me/v2/bot/message/push";
  const options = {
    method: "post",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({
      to: targetId,
      messages: [{ type: "text", text: message }]
    }),
    muteHttpExceptions: true
  };
  try {
    const res = UrlFetchApp.fetch(url, options);
    logDebug("LINE Push Response: " + res.getResponseCode() + " - " + res.getContentText());
  } catch (e) {
    logDebug("LINE Messaging API push failed: " + e.toString());
    console.error("LINE Messaging API push failed:", e);
  }
}

function sendLinePushToOwner(ownerName, message) {
  logDebug("sendLinePushToOwner called. ownerName: " + ownerName + ", message: " + message);
  if (!ownerName || ownerName === "無") return;
  
  if (ownerName === "全部" || ownerName === "管理員") {
    const admins = readObjects(SHEETS.users, HEADERS.users).filter(u => u.role === "admin" && u.lineUserId);
    logDebug("Found admins to push: " + admins.map(a => a.displayName).join(", "));
    admins.forEach(admin => {
      sendLinePushMessage(admin.lineUserId, message);
    });
  } else {
    const user = readObjects(SHEETS.users, HEADERS.users).find(u => u.salesOwner === ownerName && u.lineUserId);
    if (user && user.lineUserId) {
      logDebug("Found owner for push: " + user.displayName + ", lineUserId: " + user.lineUserId);
      sendLinePushMessage(user.lineUserId, message);
    } else {
      logDebug("No bound user found for owner: " + ownerName);
    }
  }
}

function linkLineRichMenu(lineUserId, role) {
  const token = getSetting("lineChannelAccessToken") || DEFAULT_CHANNEL_ACCESS_TOKEN;
  if (!token || !lineUserId) return;
  
  const isInternal = role === "admin" || role === "sales" || role === "retail";
  const richMenuCustomerId = getSetting("lineRichMenuCustomer");
  
  if (isInternal) {
    const richMenuSalesId = ensureJingyangBusinessRichMenu(token);
    setSetting("lineRichMenuSales", richMenuSalesId);
    UrlFetchApp.fetch("https://api.line.me/v2/bot/user/" + lineUserId + "/richmenu/" + richMenuSalesId, {
      method: "post",
      headers: { "Authorization": "Bearer " + token },
      muteHttpExceptions: true
    });
  } else if (richMenuCustomerId) {
    UrlFetchApp.fetch("https://api.line.me/v2/bot/user/" + lineUserId + "/richmenu/" + richMenuCustomerId, {
      method: "post",
      headers: { "Authorization": "Bearer " + token },
      muteHttpExceptions: true
    });
  }
}

function ensureJingyangBusinessRichMenu(token) {
  const menuName = "Jingyang Business Manager Menu v3";
  const existingId = findLineRichMenuByName(token, menuName);
  if (existingId) return existingId;

  const menuConfig = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: menuName,
    chatBarText: "業務管家",
    areas: [
      { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: "message", label: "查詢保留", text: "今日保留" } },
      { bounds: { x: 833, y: 0, width: 833, height: 843 }, action: { type: "uri", label: "查詢庫存", uri: "https://brown-phi.vercel.app/?view=inventory" } },
      { bounds: { x: 1666, y: 0, width: 834, height: 843 }, action: { type: "uri", label: "上傳照片", uri: "https://brown-phi.vercel.app/?view=samples" } }
    ]
  };

  const createRes = UrlFetchApp.fetch("https://api.line.me/v2/bot/richmenu", {
    method: "post",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(menuConfig),
    muteHttpExceptions: true
  });
  if (createRes.getResponseCode() !== 200) {
    throw new Error("建立業務選單失敗：" + createRes.getContentText());
  }

  const richMenuId = JSON.parse(createRes.getContentText()).richMenuId;
  uploadJingyangBusinessRichMenuImage(token, richMenuId);
  return richMenuId;
}

function findLineRichMenuByName(token, menuName) {
  const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/richmenu/list", {
    method: "get",
    headers: { "Authorization": "Bearer " + token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return "";

  const menus = JSON.parse(res.getContentText() || "{}").richmenus || [];
  const matched = menus.find(menu => menu.name === menuName);
  return matched ? matched.richMenuId : "";
}

function uploadJingyangBusinessRichMenuImage(token, richMenuId) {
  const imageUrl = "https://brown-phi.vercel.app/sales_rich_menu.jpg";
  const imageRes = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true });
  if (imageRes.getResponseCode() < 200 || imageRes.getResponseCode() >= 300) {
    throw new Error("讀取業務選單圖片失敗 HTTP " + imageRes.getResponseCode());
  }

  const uploadRes = UrlFetchApp.fetch("https://api-data.line.me/v2/bot/richmenu/" + richMenuId + "/content", {
    method: "post",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "image/jpeg"
    },
    payload: imageRes.getBlob().getBytes(),
    muteHttpExceptions: true
  });
  if (uploadRes.getResponseCode() !== 200) {
    throw new Error("上傳業務選單圖片失敗：" + uploadRes.getContentText());
  }
}

function setupLine() {
  return setupLineRichMenus();
}

function setupLineRichMenus() {
  const token = getSetting("lineChannelAccessToken") || DEFAULT_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE Channel Access Token is not set");

  // 1. Delete all existing rich menus
  const listUrl = "https://api.line.me/v2/bot/richmenu/list";
  try {
    const listRes = UrlFetchApp.fetch(listUrl, {
      method: "get",
      headers: { "Authorization": "Bearer " + token },
      muteHttpExceptions: true
    });
    if (listRes.getResponseCode() === 200) {
      const listObj = JSON.parse(listRes.getContentText());
      if (listObj.richmenus) {
        listObj.richmenus.forEach((menu) => {
          UrlFetchApp.fetch("https://api.line.me/v2/bot/richmenu/" + menu.richMenuId, {
            method: "delete",
            headers: { "Authorization": "Bearer " + token },
            muteHttpExceptions: true
          });
        });
      }
    }
  } catch (e) {
    console.error("Listing rich menus failed:", e);
  }

  // 2. Define Customer Rich Menu Layout (Compact)
  const customerMenuConfig = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: "Customer Version Rich Menu",
    chatBarText: "精選選單",
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: "uri", label: "公司官網", uri: "http://www.macarena.com.tw/zh-tw/index.php" }
      },
      {
        bounds: { x: 833, y: 0, width: 833, height: 843 },
        action: { type: "uri", label: "聯絡客服", uri: "https://line.me/ti/p/w5RBglOOph" }
      },
      {
        bounds: { x: 1666, y: 0, width: 834, height: 843 },
        action: { type: "uri", label: "最新型錄", uri: "https://drive.google.com/file/d/1bmTK4_nWz4Hrs0Qe88yKul-d8VtXfFB1/view?usp=sharing" }
      }
    ]
  };

  // 3. Define Salesperson Rich Menu Layout (Compact)
  const salesMenuConfig = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: "Salesperson Version Rich Menu",
    chatBarText: "業務專用選單",
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: "message", label: "查詢保留", text: "今日保留" }
      },
      {
        bounds: { x: 833, y: 0, width: 833, height: 843 },
        action: { type: "uri", label: "查詢庫存", uri: "https://brown-phi.vercel.app/?view=inventory" }
      },
      {
        bounds: { x: 1666, y: 0, width: 834, height: 843 },
        action: { type: "uri", label: "上傳照片", uri: "https://brown-phi.vercel.app/?view=samples" }
      }
    ]
  };

  // 4. Create Rich Menus helper
  const createMenu = (config, imageUrl) => {
    const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/richmenu", {
      method: "post",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      payload: JSON.stringify(config),
      muteHttpExceptions: true
    });
    
    if (res.getResponseCode() !== 200) {
      throw new Error("Failed to create Rich Menu: " + res.getContentText());
    }
    
    const richMenuId = JSON.parse(res.getContentText()).richMenuId;

    // Upload Image
    const imgBlob = UrlFetchApp.fetch(imageUrl).getBlob();
    const uploadRes = UrlFetchApp.fetch("https://api-data.line.me/v2/bot/richmenu/" + richMenuId + "/content", {
      method: "post",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "image/jpeg"
      },
      payload: imgBlob.getBytes(),
      muteHttpExceptions: true
    });
    
    if (uploadRes.getResponseCode() !== 200) {
      throw new Error("Failed to upload Rich Menu image: " + uploadRes.getContentText());
    }

    return richMenuId;
  };

  const customerMenuId = createMenu(customerMenuConfig, "https://brown-phi.vercel.app/customer_rich_menu.jpg");
  const salesMenuId = createMenu(salesMenuConfig, "https://brown-phi.vercel.app/sales_rich_menu.jpg");

  // 5. Set Customer Menu as default
  UrlFetchApp.fetch("https://api.line.me/v2/bot/user/all/richmenu/" + customerMenuId, {
    method: "post",
    headers: { "Authorization": "Bearer " + token },
    muteHttpExceptions: true
  });

  // 6. Save settings
  setSetting("lineRichMenuCustomer", customerMenuId);
  setSetting("lineRichMenuSales", salesMenuId);

  return { ok: true, message: "LINE 圖文選單建立成功，客戶選單已設為預設。" };
}

function handleLineWebhook(payload) {
  if (!payload || !payload.events) return;
  
  payload.events.forEach((event) => {
    logDebug("LINE Webhook Event: " + JSON.stringify(event));
    if (event.type === "message" && event.message.type === "text") {
      const text = String(event.message.text).trim();
      const userId = event.source.userId;
      
      if (text === "綁定") {
        const replyToken = event.replyToken;
        const bindUrl = "https://brown-phi.vercel.app/?lineUserId=" + userId;
        const msg = "請點擊以下連結開啟「勁揚業務管家」並登入您的帳號，即可完成 LINE 身分綁定：\n" + bindUrl;
        replyLineMessage(replyToken, msg);
      }
      else if (text === "查詢庫存" || text === "查詢保留" || text === "今日保留" || text === "庫存") {
        const user = readObjects(SHEETS.users, HEADERS.users).find(u => u.lineUserId === userId);
        if (!user || (user.role !== "admin" && user.role !== "sales" && user.role !== "retail")) {
          replyLineMessage(event.replyToken, "⚠️ 您的 LINE 帳號尚未完成內部業務人員身分綁定，無法使用此查詢功能。");
          return;
        }
        
        if (text === "查詢保留" || text === "今日保留") {
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
          const allHolds = readObjects(SHEETS.holds, HEADERS.holds).filter(h => h.status !== "done");
          const visibleHolds = user.role === "admin" ? allHolds : allHolds.filter(h => h.salesOwner === user.salesOwner);
          const holds = visibleHolds.filter(h => {
            const rawDate = h.expiresAt || h.holdDate || h.createdAt;
            const due = rawDate ? new Date(rawDate) : null;
            return due && !isNaN(due.getTime()) && due <= sevenDays;
          });
          
          if (!holds.length) {
            replyLineMessage(event.replyToken, "ℹ️ 目前沒有一週內即將到期的保留提醒。");
          } else {
            const list = holds.map(h => "- 店家: " + h.storeName + "\n  保留: " + h.item + " (" + (h.quantity || "1") + ")\n  到期: " + (h.expiresAt || "無")).join("\n\n");
            replyLineMessage(event.replyToken, "📋 您好 " + user.displayName + "，目前有以下保留項目：\n\n" + list);
          }
        } else {
          replyLineMessage(event.replyToken, "🔍 庫存查詢功能：\n請輸入要查詢的「系列」或「編號」來為您即時搜尋試算表中的樣品/展架庫存。");
        }
      }
      else {
        // Any other message - check if it is a keyword query
        const user = readObjects(SHEETS.users, HEADERS.users).find(u => u.lineUserId === userId);
        if (!user || (user.role !== "admin" && user.role !== "sales" && user.role !== "retail")) {
          return;
        }
        
        let keyword = text;
        let isExplicit = false;
        
        if (text.startsWith("庫存 ")) {
          keyword = text.slice(3).trim();
          isExplicit = true;
        }
        
        if (!keyword) {
          replyLineMessage(event.replyToken, "🔍 庫存查詢功能：\n請輸入要查詢的「系列」或「編號」來為您即時搜尋試算表中的樣品/展架庫存。");
          return;
        }
        
        const samples = readObjects(SHEETS.samples, HEADERS.samples);
        const matches = samples.filter(s => {
          return String(s.modelName || "").indexOf(keyword) !== -1 || 
                 String(s.itemType || "").indexOf(keyword) !== -1 ||
                 String(s.storeName || "").indexOf(keyword) !== -1;
        });
        
        if (matches.length > 0) {
          const list = matches.slice(0, 10).map(s => "- 樣品: " + (s.modelName || s.itemType) + "\n  店家: " + s.storeName + "\n  數量: " + (s.quantity || "0") + "\n  位置: " + (s.note || "現場")).join("\n\n");
          replyLineMessage(event.replyToken, "📦 庫存搜尋結果 (最多顯示10筆)：\n\n" + list);
        } else if (isExplicit) {
          replyLineMessage(event.replyToken, "ℹ️ 找不到包含「" + keyword + "」的庫存/樣品資料。");
        }
      }
    }
  });
}

function replyLineMessage(replyToken, text) {
  const token = getSetting("lineChannelAccessToken") || DEFAULT_CHANNEL_ACCESS_TOKEN;
  if (!token) return;
  
  const url = "https://api.line.me/v2/bot/message/reply";
  UrlFetchApp.fetch(url, {
    method: "post",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: "text", text: text }]
    }),
    muteHttpExceptions: true
  });
}

function logDebug(message) {
  try {
    const ss = ensureSpreadsheet();
    let sheet = ss.getSheetByName("Logs");
    if (!sheet) {
      sheet = ss.insertSheet("Logs");
      sheet.appendRow(["Timestamp", "Message"]);
    }
    sheet.appendRow([new Date().toISOString(), message]);
  } catch (e) {
    // ignore
  }
}
