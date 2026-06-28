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
  users: ["id", "username", "displayName", "password", "role", "salesOwner", "status", "note", "createdAt", "updatedAt"],
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
    const data = parseBody(e);
    const action = data.action || "readAll";
    if (action === "setup") return jsonOutput(setupBackend(data));
    if (action === "login") return jsonOutput(loginUser(data));
    if (action === "readAll") return jsonOutput(readAll());
    if (action === "snapshot") return jsonOutput(saveSnapshot(data));
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
  if (Array.isArray(data.stores)) upsertStores(data.stores);
  if (Array.isArray(data.holds)) upsertHolds(data.holds);
  if (Array.isArray(data.projects)) upsertProjects(data.projects);
  if (Array.isArray(data.samples)) upsertSamples(data.samples);
  if (Array.isArray(data.complaints)) upsertComplaints(data.complaints);
  return { ok: true, message: "目前資料已同步到 Google Sheet" };
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

  const user = readObjects(SHEETS.users, HEADERS.users).find((item) => {
    return normalizeLoginValue(item.username) === username || normalizeLoginValue(item.displayName) === username;
  });
  if (!user) throw new Error("帳號或密碼錯誤");
  if (String(user.status || "").trim() !== "啟用") throw new Error("此帳號已停用，請聯絡管理員");
  if (String(user.password || "") !== password) throw new Error("帳號或密碼錯誤");

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

function upsertStores(stores) {
  upsertObjects(SHEETS.stores, HEADERS.stores, stores.filter(Boolean).map((store) => ({
    ...store,
    ownerEdited: normalizeBooleanValue(store.ownerEdited),
    updatedAt: new Date().toISOString(),
  })));
  return { ok: true, message: "店家資料已同步" };
}

function upsertHolds(holds) {
  const storesById = makeLookup(readObjects(SHEETS.stores, HEADERS.stores), "id");
  const existingHolds = makeLookup(readObjects(SHEETS.holds, HEADERS.holds), "id");
  const rows = holds.filter(Boolean).map((hold) => {
    const store = storesById[hold.storeId] || {};
    const isNew = !existingHolds[hold.id];

    if (isNew) {
      const storeName = hold.storeName || store.name || "未知店家";
      const owner = hold.salesOwner || store.salesOwner || "無";
      const title = "新保留物品提醒 🔔";
      const body = "店家 " + storeName + " 已新增保留：" + hold.item + " (" + (hold.quantity || "1") + ")";
      sendOneSignalPush(owner, title, body);
    }

    return {
      ...hold,
      storeName: hold.storeName || store.name || "",
      salesOwner: hold.salesOwner || store.salesOwner || "",
      updatedAt: new Date().toISOString(),
    };
  });
  upsertObjects(SHEETS.holds, HEADERS.holds, rows);
  return { ok: true, message: "保留物品已同步" };
}

function upsertPhotos(photos) {
  upsertObjects(SHEETS.photos, HEADERS.photos, photos.filter(Boolean));
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

function upsertProjects(projects) {
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
  upsertObjects(SHEETS.projects, HEADERS.projects, rows);
  return { ok: true, message: "案場報備已同步" };
}

function upsertSamples(samples) {
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
  upsertObjects(SHEETS.samples, HEADERS.samples, rows);
  return { ok: true, message: "樣品與展架已同步" };
}

function upsertComplaints(complaints) {
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
  upsertObjects(SHEETS.complaints, HEADERS.complaints, rows);
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
