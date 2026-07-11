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
  tasks: "工作任務",
  auditLogs: "操作紀錄",
};

const HEADERS = {
  stores: ["id", "customerCode", "name", "shortName", "salesOwner", "phone", "phone2", "mobile", "address", "region", "contactName", "taxId", "note", "createdAt", "updatedAt", "ownerEdited"],
  holds: ["id", "storeId", "storeName", "salesOwner", "item", "quantity", "reservationStatus", "holdAddress", "holdDate", "expiresAt", "reminderAt", "note", "status", "createdAt", "updatedAt"],
  projects: ["id", "storeId", "storeName", "salesOwner", "projectName", "projectAddress", "tileDetails", "expectedDeliveryDate", "status", "note", "createdAt", "updatedAt"],
  samples: ["id", "storeId", "storeName", "salesOwner", "itemType", "modelName", "quantity", "status", "driveUrl", "fileId", "note", "createdAt", "updatedAt"],
  complaints: ["id", "storeId", "storeName", "salesOwner", "issueDescription", "category", "driveUrl", "fileId", "status", "coordinationLog", "createdAt", "updatedAt"],
  users: ["id", "username", "displayName", "password", "role", "salesOwner", "status", "note", "createdAt", "updatedAt", "lineUserId"],
  settings: ["key", "value", "updatedAt"],
  tasks: ["id", "type", "title", "description", "customerId", "customerName", "productName", "quantity", "assignedTo", "assignedRole", "status", "priority", "dueDate", "source", "createdBy", "createdAt", "updatedAt", "completedAt", "note", "workflowStage", "parentWorkId", "sourceRole", "sourceUser", "blockedReason", "startedAt", "updatedBy"],
  auditLogs: ["id", "workId", "action", "operator", "operatorRole", "fromStatus", "toStatus", "details", "createdAt"],
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
    if (action === "listMyTasks") return jsonOutput(listMyTasks(data));
    if (action === "createTask") return jsonOutput(createTask(data));
    if (action === "updateTaskStatus") return jsonOutput(updateTaskStatus(data));
    if (action === "appendTaskNote") return jsonOutput(appendTaskNote(data));
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
  if (Array.isArray(data.tasks)) upsertTasks(data.tasks, true);
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
    tasks: readObjects(SHEETS.tasks, HEADERS.tasks),
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
  const isBossOrAdmin = user.role === "admin" || user.role === "boss";
  return {
    canViewAllStores: isBossOrAdmin,
    canManageUsers: isAdmin,
    canManageSettings: isAdmin,
    canUploadPhotos: true,
    canManageHolds: true,
    visibleSalesOwner: isBossOrAdmin ? "全部" : user.salesOwner,
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

function upsertTasks(tasks, isSnapshot) {
  const storesById = makeLookup(readObjects(SHEETS.stores, HEADERS.stores), "id");
  const rows = tasks.filter(Boolean).map((t) => {
    const store = storesById[t.customerId] || {};
    return {
      ...t,
      customerName: t.customerName || store.name || "",
      updatedAt: new Date().toISOString(),
    };
  });
  if (isSnapshot) {
    overwriteObjects(SHEETS.tasks, HEADERS.tasks, rows);
  } else {
    upsertObjects(SHEETS.tasks, HEADERS.tasks, rows);
  }
  return { ok: true, message: "工作任務已同步" };
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

const DEFAULT_CHANNEL_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '';

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
  
  const isInternal = ["admin", "sales", "retailSales", "showroomSales", "assistant", "boss"].includes(role);
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
    
    // 1. POSTBACK EVENT HANDLER
    if (event.type === "postback") {
      const dataStr = event.postback.data || "";
      const params = parsePostbackData(dataStr);
      const userId = event.source.userId;
      const replyToken = event.replyToken;
      
      if (params.action === "taskDone") {
        updateTaskStatus({ id: params.id, status: "done" });
        replyLineMessage(replyToken, "✅ 任務已標記為【已完成】！");
      }
      else if (params.action === "taskDelay") {
        updateTaskStatus({ id: params.id, status: "delayed" });
        PropertiesService.getScriptProperties().setProperty("pendingTask:" + userId, params.id);
        replyLineMessage(replyToken, "🕒 任務已標記為【已延後】。\n請直接回覆您想追加的備註內容，系統會自動記錄。");
      }
      else if (params.action === "taskBlock") {
        updateTaskStatus({ id: params.id, status: "blocked" });
        replyLineMessage(replyToken, "⚠️ 任務已標記為【異常/受阻】！主管與助理可於今日總覽的「異常提醒」查看此任務。");
      }
      else if (params.action === "taskAssignAssistant") {
        const tasks = readObjects(SHEETS.tasks, HEADERS.tasks);
        const task = tasks.find(t => t.id === params.id);
        if (task) {
          task.assignedRole = "assistant";
          task.status = "open";
          task.updatedAt = new Date().toISOString();
          upsertObjects(SHEETS.tasks, HEADERS.tasks, [task]);
        }
        replyLineMessage(replyToken, "👤 任務已成功轉交給【助理】處理。");
      }
      else if (params.action === "taskNote") {
        PropertiesService.getScriptProperties().setProperty("pendingTask:" + userId, params.id);
        replyLineMessage(replyToken, "📝 請直接回覆您的備註文字內容，系統會自動將它追加到該任務的備註中：");
      }
      else if (params.action === "workTransition") {
        const toStatus = params.to;
        const id = params.id;
        
        const tasks = readObjects(SHEETS.tasks, HEADERS.tasks);
        const task = tasks.find(t => t.id === id);
        if (!task) {
          replyLineMessage(replyToken, "⚠️ 找不到該工作項目。");
          return;
        }
        
        task.status = toStatus;
        task.updatedAt = new Date().toISOString();
        if (toStatus === "Finished") {
          task.completedAt = new Date().toISOString();
        }
        upsertObjects(SHEETS.tasks, HEADERS.tasks, [task]);
        
        if (toStatus === "Finished") {
          if (task.type === "reservation" || task.type === "reservationFollow") {
            const msg1 = {
              type: "text",
              text: "🎉 工作已完成！此保留工作已結束。需要通知助理處理後續訂單嗎？",
              quickReply: {
                items: [
                  { type: "action", action: { type: "postback", label: "需要通知助理 (YES)", data: "action=assistantHook&id=" + task.id + "&notify=yes", displayText: "是，通知助理" } },
                  { type: "action", action: { type: "postback", label: "不需要 (NO)", data: "action=assistantHook&id=" + task.id + "&notify=no", displayText: "否，不需要" } }
                ]
              }
            };
            replyLineCustomMessage(replyToken, [msg1]);
            return;
          } else {
            const contextData = { customerId: task.customerId || "", customerName: task.customerName || "" };
            PropertiesService.getScriptProperties().setProperty("pendingNextWorkContext:" + userId, JSON.stringify(contextData));
            
            const msg2 = {
              type: "text",
              text: "🎉 工作已完成！下一步？今天有沒有新的需求？",
              quickReply: {
                items: [
                  { type: "action", action: { type: "message", label: "沒有", text: "沒有其他需求" } },
                  { type: "action", action: { type: "message", label: "要保留", text: "🚚下一步：📦保留" } },
                  { type: "action", action: { type: "message", label: "要樣品", text: "🚚下一步：🧱送樣" } },
                  { type: "action", action: { type: "message", label: "要報價", text: "🚚下一步：📄報價" } },
                  { type: "action", action: { type: "message", label: "客訴", text: "🚚下一步：⚠客訴" } },
                  { type: "action", action: { type: "message", label: "其他", text: "🚚下一步：📝其他" } }
                ]
              }
            };
            replyLineCustomMessage(replyToken, [msg2]);
            return;
          }
        }
        
        const statusMap = {
          Created: "已建立",
          Started: "執行中",
          Waiting: "等待中",
          Finished: "已完成",
          Blocked: "有異常",
          Cancelled: "已取消"
        };
        replyLineMessage(replyToken, "✅ 工作狀態已變更為【" + (statusMap[toStatus] || toStatus) + "】！");
        return;
      }
      else if (params.action === "assistantHook") {
        const notify = params.notify;
        const id = params.id;
        
        if (notify === "yes") {
          const tasks = readObjects(SHEETS.tasks, HEADERS.tasks);
          const task = tasks.find(t => t.id === id);
          const customerName = task ? task.customerName : "";
          const customerId = task ? task.customerId : "";
          
          const assistantWork = {
            id: "work-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000),
            type: "other",
            title: "【助理待辦】處理保留出貨訂單 (" + (customerName || "未知客戶") + ")",
            description: "業務標記保留完成，請協助處理出貨流程。",
            customerId: customerId,
            customerName: customerName,
            assignedTo: "",
            assignedRole: "assistant",
            status: "Created",
            priority: "high",
            dueDate: new Date().toISOString().slice(0, 10),
            source: "ASSISTANT_HOOK",
            createdBy: "SYSTEM",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            note: ""
          };
          
          createTask({ task: assistantWork });
          replyLineMessage(replyToken, "👤 已成功通知助理！工作項目【助理待辦：處理保留出貨訂單】已建立。");
        } else {
          replyLineMessage(replyToken, "👍 好的，已結束此保留工作。");
        }
        return;
      }
      return;
    }
    
    // 2. MESSAGE TEXT EVENT HANDLER
    if (event.type === "message" && event.message.type === "text") {
      const text = String(event.message.text).trim();
      const normalizedText = text.replace(/[\s\u3000]+/g, "").toLowerCase();
      const userId = event.source.userId;
      const replyToken = event.replyToken;
      
      // 雙模式 Intent Router：內部明確指令在其它流程與 fallback 前處理
      if (typeof LineIntent_tryHandleTextEvent === "function") {
        const routed = LineIntent_tryHandleTextEvent(event);
        if (routed && routed.handled) {
          return;
        }
      }
      
      // Step 1: Bind Command Interception
      if (normalizedText === "綁定") {
        const bindUrl = "https://brown-phi.vercel.app/?lineUserId=" + userId;
        const msg = "請點擊以下連結開啟「勁揚業務管家」並登入您的帳號，即可完成 LINE 身分綁定：\n" + bindUrl;
        replyLineMessage(replyToken, msg);
        return;
      }
      
      // Step 2: Load and Verify User
      const user = readObjects(SHEETS.users, HEADERS.users).find(u => u.lineUserId === userId);
      if (!user) {
        replyLineMessage(replyToken, "⚠️ 您的 LINE 帳號尚未完成內部人員身分綁定，請輸入「綁定」進行設定。");
        return;
      }
      
      // Step 3: Pending Note Check
      const pendingTaskId = PropertiesService.getScriptProperties().getProperty("pendingTask:" + userId);
      if (pendingTaskId) {
        appendTaskNote({ id: pendingTaskId, note: text });
        PropertiesService.getScriptProperties().deleteProperty("pendingTask:" + userId);
        replyLineMessage(replyToken, "📝 備註已成功記錄到該任務中！");
        return;
      }
      
      // Step 4: Workflow Command Interception (Priority #1)
      let matchedCommand = null;
      if (normalizedText === "選單" || normalizedText === "menu") {
        matchedCommand = "選單";
      } else if (normalizedText === "今日" || normalizedText === "今日工作" || normalizedText === "工作") {
        matchedCommand = "今日工作";
      } else if (normalizedText === "待處理") {
        matchedCommand = "待處理";
      } else if (normalizedText === "今日門市") {
        matchedCommand = "今日門市";
      } else if (normalizedText === "今日總覽") {
        matchedCommand = "今日總覽";
      } else if (normalizedText === "異常提醒") {
        matchedCommand = "異常提醒";
      } else if (normalizedText === "業務進度") {
        matchedCommand = "業務進度";
      }
      
      console.log("[LINE_TEXT_COMMAND]", text, normalizedText, matchedCommand);
      logDebug("[LINE_TEXT_COMMAND] Raw: " + text + " | Normalized: " + normalizedText + " | Matched: " + matchedCommand);
      
      if (matchedCommand) {
        PropertiesService.getScriptProperties().deleteProperty("pendingWorkStep:" + userId);
        PropertiesService.getScriptProperties().deleteProperty("pendingWorkData:" + userId);
        
        if (matchedCommand === "選單") {
          replyRoleMenu(replyToken, user);
        } else if (matchedCommand === "今日工作") {
          replyMyTasks(replyToken, userId);
        } else if (matchedCommand === "待處理") {
          replyAssistantTasks(replyToken, userId);
        } else if (matchedCommand === "今日門市") {
          replyShowroomTasks(replyToken, userId);
        } else if (matchedCommand === "今日總覽") {
          replyBossOverview(replyToken);
        } else if (matchedCommand === "異常提醒") {
          replyAbnormalTasks(replyToken);
        } else if (matchedCommand === "業務進度") {
          replyBusinessProgress(replyToken);
        }
        return;
      }
      
      // Step 4a: Workflow Next Step Hook Interception
      if (normalizedText.startsWith("🚚下一步：")) {
        const cleanOpt = normalizedText.slice(5).replace(/[^\w\u4e00-\u9fa5]/g, "");
        const typeMapClean = {
          "送貨": "delivery",
          "保留": "reservation",
          "加工": "processing",
          "回電": "reminder",
          "拜訪": "visit",
          "報價": "quote",
          "客訴": "complaint",
          "收退貨": "return",
          "送樣": "sample",
          "其他": "other"
        };
        const nextType = typeMapClean[cleanOpt] || "other";
        
        const contextStr = PropertiesService.getScriptProperties().getProperty("pendingNextWorkContext:" + userId);
        const context = contextStr ? JSON.parse(contextStr) : { customerId: "", customerName: "" };
        
        const data = {
          type: nextType,
          customerId: context.customerId,
          customerName: context.customerName
        };
        
        PropertiesService.getScriptProperties().setProperty("pendingWorkData:" + userId, JSON.stringify(data));
        
        const msg = {
          type: "text",
          text: "好的，已為您帶入同一個客戶。請選擇新工作期限：",
          quickReply: {
            items: [
              { type: "action", action: { type: "message", label: "今天 (Today)", text: "今天" } },
              { type: "action", action: { type: "message", label: "明天 (Tomorrow)", text: "明天" } },
              { type: "action", action: { type: "message", label: "三天內 (In 3 Days)", text: "三天內" } },
              { type: "action", action: { type: "message", label: "下週一 (Next Mon)", text: "下週一" } }
            ]
          }
        };
        
        PropertiesService.getScriptProperties().setProperty("pendingWorkStep:" + userId, "3");
        replyLineCustomMessage(replyToken, [msg]);
        return;
      }
      
      // Step 4b: Work creation command Interception
      if (normalizedText === "新增工作" || normalizedText === "新增回報") {
        const msg = {
          type: "text",
          text: "今天要做什麼？請選擇工作類別：",
          quickReply: {
            items: [
              { type: "action", action: { type: "message", label: "🚚 送貨", text: "🚚送貨" } },
              { type: "action", action: { type: "message", label: "📦 保留", text: "📦保留" } },
              { type: "action", action: { type: "message", label: "🏭 加工", text: "🏭加工" } },
              { type: "action", action: { type: "message", label: "☎ 回電", text: "☎回電" } },
              { type: "action", action: { type: "message", label: "👤 拜訪", text: "👤拜訪" } },
              { type: "action", action: { type: "message", label: "📄 報價", text: "📄報價" } },
              { type: "action", action: { type: "message", label: "⚠ 客訴", text: "⚠客訴" } },
              { type: "action", action: { type: "message", label: "🚛 收退貨", text: "🚛收退貨" } },
              { type: "action", action: { type: "message", label: "🧱 送樣", text: "🧱送樣" } },
              { type: "action", action: { type: "message", label: "📝 其他", text: "📝其他" } }
            ]
          }
        };
        PropertiesService.getScriptProperties().setProperty("pendingWorkStep:" + userId, "1");
        PropertiesService.getScriptProperties().deleteProperty("pendingWorkData:" + userId);
        
        replyLineCustomMessage(replyToken, [msg]);
        return;
      }
      
      // Step 4c: Voice ready interception
      if (normalizedText === "🎤語音輸入" || normalizedText === "🎤語音回報" || normalizedText === "🎤語音") {
        replyLineMessage(replyToken, "🎙️ 勁揚 AI 語音助理已就緒！\n請直接點擊 LINE 內建麥克風並傳送您的語音訊息，AI 將會自動分析您的意圖、辨識店家、商品並自動建立工作流程！\n\n(語音分析與實時流程對接功能將於 Capability Package 2 推出，目前為 Voice Ready 介面演示)");
        return;
      }
      
      // Step 4d: Create workflow wizard state machine
      const pendingWorkStep = PropertiesService.getScriptProperties().getProperty("pendingWorkStep:" + userId);
      if (pendingWorkStep === "1") {
        const cleanInput = text.replace(/[^\w\u4e00-\u9fa5]/g, "");
        const typeMapClean = {
          "送貨": "delivery",
          "保留": "reservation",
          "加工": "processing",
          "回電": "reminder",
          "拜訪": "visit",
          "報價": "quote",
          "客訴": "complaint",
          "收退貨": "return",
          "送樣": "sample",
          "其他": "other"
        };
        const type = typeMapClean[cleanInput];
        if (!type) {
          replyLineMessage(replyToken, "⚠️ 請點選 Quick Reply 選項來選擇工作類別，勿自行輸入文字。");
          return;
        }
        
        const data = { type: type };
        PropertiesService.getScriptProperties().setProperty("pendingWorkData:" + userId, JSON.stringify(data));
        
        const recentStores = getSalespersonStores(user.salesOwner);
        const quickReplyItems = recentStores.map(s => {
          return { type: "action", action: { type: "message", label: s.shortName || s.name, text: s.shortName || s.name } };
        });
        quickReplyItems.push({ type: "action", action: { type: "message", label: "無/其他客戶", text: "無" } });
        
        const msg = {
          type: "text",
          text: "請選擇客戶/店家：",
          quickReply: { items: quickReplyItems }
        };
        
        PropertiesService.getScriptProperties().setProperty("pendingWorkStep:" + userId, "2");
        replyLineCustomMessage(replyToken, [msg]);
        return;
      }
      
      if (pendingWorkStep === "2") {
        const storeName = text;
        const dataStr = PropertiesService.getScriptProperties().getProperty("pendingWorkData:" + userId);
        const data = dataStr ? JSON.parse(dataStr) : {};
        
        if (storeName === "無" || storeName === "無/其他客戶" || storeName === "其他") {
          data.customerId = "";
          data.customerName = "";
        } else {
          const stores = readObjects(SHEETS.stores, HEADERS.stores);
          const matchedStore = stores.find(s => s.shortName === storeName || s.name === storeName);
          if (matchedStore) {
            data.customerId = matchedStore.id;
            data.customerName = matchedStore.shortName || matchedStore.name;
          } else {
            data.customerId = "";
            data.customerName = storeName;
          }
        }
        
        PropertiesService.getScriptProperties().setProperty("pendingWorkData:" + userId, JSON.stringify(data));
        
        const msg = {
          type: "text",
          text: "請選擇工作到期日：",
          quickReply: {
            items: [
              { type: "action", action: { type: "message", label: "今天 (Today)", text: "今天" } },
              { type: "action", action: { type: "message", label: "明天 (Tomorrow)", text: "明天" } },
              { type: "action", action: { type: "message", label: "三天內 (In 3 Days)", text: "三天內" } },
              { type: "action", action: { type: "message", label: "下週一 (Next Mon)", text: "下週一" } }
            ]
          }
        };
        
        PropertiesService.getScriptProperties().setProperty("pendingWorkStep:" + userId, "3");
        replyLineCustomMessage(replyToken, [msg]);
        return;
      }
      
      if (pendingWorkStep === "3") {
        const dateOpt = text;
        const dataStr = PropertiesService.getScriptProperties().getProperty("pendingWorkData:" + userId);
        const data = dataStr ? JSON.parse(dataStr) : {};
        
        let dueDateStr = new Date().toISOString().slice(0, 10);
        const now = new Date();
        
        if (dateOpt === "今天") {
          dueDateStr = now.toISOString().slice(0, 10);
        } else if (dateOpt === "明天") {
          const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          dueDateStr = tomorrow.toISOString().slice(0, 10);
        } else if (dateOpt === "三天內") {
          const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
          dueDateStr = threeDays.toISOString().slice(0, 10);
        } else if (dateOpt === "下週一") {
          const day = now.getDay();
          const daysToAdd = (day === 0) ? 1 : (8 - day);
          const nextMon = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
          dueDateStr = nextMon.toISOString().slice(0, 10);
        } else {
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateOpt)) {
            dueDateStr = dateOpt;
          }
        }
        
        const typeMapEmoji = {
          delivery: "🚚送貨",
          reservation: "📦保留",
          processing: "🏭加工",
          reminder: "☎回電",
          visit: "👤拜訪",
          quote: "📄報價",
          complaint: "⚠客訴",
          return: "🚛收退貨",
          sample: "🧱送樣",
          other: "📝其他"
        };
        
        const typeLabel = typeMapEmoji[data.type] || "📝工作";
        const title = typeLabel + (data.customerName ? " - " + data.customerName : "");
        
        const workItem = {
          id: "work-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000),
          type: data.type,
          title: title,
          description: "",
          customerId: data.customerId || "",
          customerName: data.customerName || "",
          assignedTo: user.salesOwner,
          assignedRole: user.role,
          status: "Created",
          priority: "normal",
          dueDate: dueDateStr,
          source: "LINE_BOT",
          createdBy: user.displayName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          note: ""
        };
        
        createTask({ task: workItem });
        
        PropertiesService.getScriptProperties().deleteProperty("pendingWorkStep:" + userId);
        PropertiesService.getScriptProperties().deleteProperty("pendingWorkData:" + userId);
        
        const msg = {
          type: "text",
          text: "🎉 工作已成功建立！\n\n" +
                "📋 項目：" + title + "\n" +
                "📅 期限：" + dueDateStr + "\n" +
                "狀態：已建立 (Created)\n\n" +
                "是否要立即開始執行此工作？",
          quickReply: {
            items: [
              { type: "action", action: { type: "postback", label: "開始執行", data: "action=workTransition&to=Started&id=" + workItem.id, displayText: "開始執行" } },
              { type: "action", action: { type: "message", label: "暫不執行", text: "暫不執行" } }
            ]
          }
        };
        
        replyLineCustomMessage(replyToken, [msg]);
        return;
      }
      
      // Step 5: Role-Specific command checks
      if (user.role === "assistant") {
        if (normalizedText === "保留訂單") {
          replyLineMessage(replyToken, "⏳ 助理您好，請至 App「保留」模組中確認各業務送出的收訂保留提醒。");
          return;
        } else if (normalizedText === "加工送貨") {
          replyLineMessage(replyToken, "⚙️ 助理您好，請至 App「案場/客訴」確認是否有即將出貨或售後加工的需求。");
          return;
        } else if (normalizedText === "回報主管") {
          replyLineMessage(replyToken, "📝 請在 LINE 輸入「回報：[內容]」或者在異常任務卡片中補充備註，主管便能即時收到您的通知。");
          return;
        }
      }
      
      if (user.role === "showroomSales") {
        if (normalizedText === "客戶追蹤") {
          replyLineMessage(replyToken, "🔍 請輸入客戶名稱或直接到 App「保留/案場」模組中點選追蹤狀態。");
          return;
        } else if (normalizedText === "報價加工") {
          replyLineMessage(replyToken, "💵 請前往 App「報價試算」模組，或者輸入指令如「加工」進行查詢。");
          return;
        }
      }
      
      if (user.role === "retailSales" || user.role === "sales") {
        if (normalizedText === "查詢資料") {
          replyLineMessage(replyToken, "🔍 請輸入要查詢的「系列」或「編號」來為您即時搜尋樣品或保留資料。");
          return;
        }
      }
      
      if (normalizedText === "問ai" || normalizedText === "問ai助理" || normalizedText === "問 AI") {
        replyLineMessage(replyToken, "🤖 AI 助理功能準備中，目前可使用今日工作、查詢資料、新增工作。");
        return;
      }
      
      // Step 6: Inventory check commands
      if (normalizedText === "查詢庫存" || normalizedText === "查詢保留" || normalizedText === "今日保留" || normalizedText === "庫存") {
        if (normalizedText === "查詢保留" || normalizedText === "今日保留") {
          replyMyTasks(replyToken, userId);
        } else {
          replyLineMessage(replyToken, "🔍 庫存查詢功能：\n請輸入要查詢的「系列」或「編號」來為您即時搜尋試算表中的樣品/展架庫存。");
        }
        return;
      }
      
      // Step 7: Sample Search Keyword checks
      let keyword = text;
      let isExplicit = false;
      if (normalizedText.startsWith("庫存")) {
        keyword = text.slice(2).trim();
        isExplicit = true;
      }
      
      const normalizedKeyword = keyword.replace(/[\s\u3000]+/g, "").toLowerCase();
      if (normalizedKeyword) {
        const samples = readObjects(SHEETS.samples, HEADERS.samples);
        const matches = samples.filter(s => {
          return String(s.modelName || "").replace(/[\s\u3000]+/g, "").toLowerCase().indexOf(normalizedKeyword) !== -1 || 
                 String(s.itemType || "").replace(/[\s\u3000]+/g, "").toLowerCase().indexOf(normalizedKeyword) !== -1 ||
                 String(s.storeName || "").replace(/[\s\u3000]+/g, "").toLowerCase().indexOf(normalizedKeyword) !== -1;
        });
        
        if (matches.length > 0) {
          const list = matches.slice(0, 10).map(s => "- 樣品: " + (s.modelName || s.itemType) + "\n  店家: " + s.storeName + "\n  數量: " + (s.quantity || "0") + "\n  位置: " + (s.note || "現場")).join("\n\n");
          replyLineMessage(replyToken, "📦 庫存搜尋結果 (最多顯示10筆)：\n\n" + list);
          return;
        } else if (isExplicit) {
          replyLineMessage(replyToken, "ℹ️ 找不到包含「" + keyword + "」的庫存/樣品資料。");
          return;
        }
      }
      
      replyLineMessage(replyToken, "🤖 AI 助理功能準備中，目前可使用今日工作、查詢資料、新增工作。");
    }
  });
}
function parsePostbackData(dataStr) {
  const params = {};
  const parts = dataStr.split("&");
  parts.forEach(part => {
    const pair = part.split("=");
    if (pair.length === 2) {
      params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
    }
  });
  return params;
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

function listMyTasks(data) {
  const spreadsheet = ensureSpreadsheet();
  ensureAllSheets(spreadsheet);
  
  const tasks = readObjects(SHEETS.tasks, HEADERS.tasks);
  
  let user = null;
  if (data.lineUserId) {
    const users = readObjects(SHEETS.users, HEADERS.users);
    user = users.find(u => u.lineUserId === data.lineUserId);
  }
  
  if (!user && data.userContext) {
    user = data.userContext;
  }
  
  if (!user) {
    user = {
      role: data.role || "",
      salesOwner: data.salesOwner || "",
      username: data.username || ""
    };
  }
  
  const role = user.role;
  const username = user.username || "";
  const salesOwner = user.salesOwner || "";
  const displayName = user.displayName || "";
  
  const filtered = tasks.filter(task => {
    if (!["open", "inProgress", "delayed", "blocked"].includes(task.status)) {
      return false;
    }
    
    if (role === "admin" || role === "boss") {
      return true;
    }
    
    if (role === "assistant") {
      return (
        task.assignedRole === "assistant" ||
        task.assignedTo === username ||
        task.assignedTo === displayName ||
        task.assignedTo === salesOwner
      );
    }
    
    if (role === "retailSales" || role === "showroomSales" || role === "sales") {
      return (
        task.assignedTo === username ||
        task.assignedTo === displayName ||
        task.assignedTo === salesOwner ||
        task.assignedRole === role ||
        (role === "sales" && (task.assignedRole === "retailSales" || task.assignedRole === "showroomSales"))
      );
    }
    
    return (
      task.assignedTo === username ||
      task.assignedTo === displayName ||
      task.assignedTo === salesOwner
    );
  });
  
  const todayStr = new Date().toISOString().slice(0, 10);
  filtered.sort((a, b) => {
    const dateA = a.dueDate || "9999-12-31";
    const dateB = b.dueDate || "9999-12-31";
    
    const isDueA = dateA <= todayStr;
    const isDueB = dateB <= todayStr;
    
    if (isDueA && !isDueB) return -1;
    if (!isDueA && isDueB) return 1;
    
    return dateA.localeCompare(dateB);
  });
  
  return {
    ok: true,
    tasks: filtered
  };
}

function createTask(data) {
  const spreadsheet = ensureSpreadsheet();
  ensureAllSheets(spreadsheet);
  
  const userContext = data.userContext || null;
  if (!userContext || !userContext.role) {
    return { ok: false, message: "權限不足" };
  }
  
  const inputTask = data.task || {};
  
  // 1. Validate payload
  const title = sanitizeTaskText_(inputTask.title, 100);
  if (!title) {
    return { ok: false, message: "標題為必填且不可為空" };
  }
  
  const type = inputTask.type;
  if (!type || !isValidTaskType_(type)) {
    return { ok: false, message: "任務類別不合法" };
  }
  
  const priority = inputTask.priority || "normal";
  if (!isValidTaskPriority_(priority)) {
    return { ok: false, message: "優先權不合法" };
  }
  
  const assignedRole = inputTask.assignedRole ? sanitizeTaskText_(inputTask.assignedRole, 50) : "";
  if (assignedRole && !isValidAssignedRole_(assignedRole)) {
    return { ok: false, message: "指派角色不合法" };
  }
  
  const assignedTo = inputTask.assignedTo ? sanitizeTaskText_(inputTask.assignedTo, 100) : "";
  if (!assignedRole && !assignedTo) {
    return { ok: false, message: "必須指定指派角色或指派人員" };
  }
  
  const dueDate = inputTask.dueDate ? String(inputTask.dueDate).trim() : "";
  if (dueDate && !isValidDueDate_(dueDate)) {
    return { ok: false, message: "到期日格式應為 YYYY-MM-DD" };
  }
  
  // 2. Validate permissions
  if (!canUserCreateTask_(userContext, assignedRole, assignedTo)) {
    return { ok: false, message: "無權指派給該對象或角色" };
  }
  
  // 3. Assemble task
  const taskId = "task-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000);
  const operatorName = getTaskOperatorName_(userContext);
  
  const quantity = inputTask.quantity ? sanitizeTaskText_(inputTask.quantity, 50) : "";
  const customerId = inputTask.customerId ? sanitizeTaskText_(inputTask.customerId, 50) : "";
  const customerName = inputTask.customerName ? sanitizeTaskText_(inputTask.customerName, 100) : "";
  const productName = inputTask.productName ? sanitizeTaskText_(inputTask.productName, 100) : "";
  const description = inputTask.description ? sanitizeTaskText_(inputTask.description, 500) : "";
  
  const task = {
    id: taskId,
    type: type,
    title: title,
    description: description,
    customerId: customerId,
    customerName: customerName,
    productName: productName,
    quantity: quantity,
    assignedTo: assignedTo,
    assignedRole: assignedRole,
    status: "Created",
    priority: priority,
    dueDate: dueDate,
    source: "pwa",
    createdBy: operatorName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: "",
    note: "",
    workflowStage: "",
    parentWorkId: inputTask.parentWorkId ? sanitizeTaskText_(inputTask.parentWorkId, 50) : "",
    sourceRole: userContext.role || "",
    sourceUser: operatorName,
    blockedReason: "",
    startedAt: "",
    updatedBy: operatorName
  };
  
  // 4. Write Audit Log
  appendAuditLog_({
    workId: taskId,
    action: "pwa_create_task",
    operator: operatorName,
    operatorRole: userContext.role || "",
    fromStatus: "",
    toStatus: "Created",
    details: "建立任務：" + title
  });
  
  upsertObjects(SHEETS.tasks, HEADERS.tasks, [task]);
  return { ok: true, message: "任務已建立", task };
}

function sanitizeTaskText_(text, maxLength) {
  if (text === undefined || text === null) return "";
  let s = String(text).trim();
  if (s.startsWith("=") || s.startsWith("+") || s.startsWith("-") || s.startsWith("@")) {
    s = "'" + s;
  }
  if (s.length > maxLength) {
    s = s.substring(0, maxLength);
  }
  return s;
}

function isValidTaskType_(type) {
  const allowed = ["general", "customer", "product", "delivery", "inventory", "reservation", "sample", "other"];
  return allowed.indexOf(type) !== -1;
}

function isValidTaskPriority_(priority) {
  const allowed = ["low", "normal", "high", "urgent"];
  return allowed.indexOf(priority) !== -1;
}

function isValidAssignedRole_(role) {
  const allowed = ["assistant", "sales", "retail", "showroom", "retailSales", "showroomSales", "boss", "admin"];
  return allowed.indexOf(role) !== -1;
}

function isValidDueDate_(dueDate) {
  if (!dueDate) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(dueDate);
}

function canUserCreateTask_(userContext, targetRole, targetAssignee) {
  if (!userContext || !userContext.role) return false;
  const role = userContext.role;
  const username = userContext.username || "";
  const displayName = userContext.displayName || "";
  const salesOwner = userContext.salesOwner || "";
  
  if (role === "admin" || role === "boss") {
    return true;
  }
  if (role === "assistant") {
    if (!targetRole) return true;
    const isTargetSales = (targetRole === "sales" || targetRole === "retail" || targetRole === "showroom" || targetRole === "retailSales" || targetRole === "showroomSales" || targetRole === "assistant");
    return isTargetSales;
  }
  if (role === "retailSales" || role === "showroomSales" || role === "sales") {
    if (!targetRole) {
      if (targetAssignee === username || targetAssignee === displayName || targetAssignee === salesOwner) return true;
      return false;
    }
    return (targetRole === "assistant" || targetRole === role || targetRole === "sales");
  }
  return false;
}

function updateTaskStatus(data) {
  const spreadsheet = ensureSpreadsheet();
  ensureAllSheets(spreadsheet);
  
  const id = data.id;
  const status = data.status;
  const note = data.note;
  const userContext = data.userContext || null;
  
  if (!id) throw new Error("缺少任務 ID");
  if (!status) throw new Error("缺少狀態代碼");
  
  // 1. 權限檢查
  if (!userContext || !userContext.role) {
    return { ok: false, message: "權限不足" };
  }
  
  const tasks = readObjects(SHEETS.tasks, HEADERS.tasks);
  const taskIndex = tasks.findIndex(t => t.id === id);
  if (taskIndex === -1) throw new Error("找不到該任務");
  
  const task = tasks[taskIndex];
  
  if (!canUserUpdateTask_(task, userContext)) {
    return { ok: false, message: "權限不足" };
  }
  
  // 1.5. 狀態原因白名單校驗
  if (status === "Blocked" || status === "Waiting") {
    const reason = getTaskStatusReason_(data);
    if (!reason || !isAllowedTaskStatusReason_(status, reason)) {
      const errMsg = status === "Blocked" ? "異常原因不合法" : "補資料原因不合法";
      return { ok: false, message: errMsg };
    }
  }
  
  // 2. 欄位一致性與狀態更新
  const fromStatus = task.status;
  task.status = status;
  task.updatedAt = new Date().toISOString();
  
  const operatorName = getTaskOperatorName_(userContext);
  task.updatedBy = operatorName;
  
  if (status === "Finished" || status === "done") {
    task.completedAt = new Date().toISOString();
  }
  
  if (status === "Blocked" || status === "Waiting") {
    const reason = getTaskStatusReason_(data);
    if (reason) {
      task.blockedReason = reason;
    }
  }
  
  if (note !== undefined && note !== "") {
    if (task.note) {
      task.note += "\n" + note;
    } else {
      task.note = note;
    }
  }
  
  // 3. 寫入 Audit Log
  const detailsStr = (data.reason || note || "");
  appendAuditLog_({
    workId: task.id,
    action: "pwa_update_status",
    operator: operatorName,
    operatorRole: userContext.role || "",
    fromStatus: fromStatus || "",
    toStatus: status || "",
    details: detailsStr
  });
  
  upsertObjects(SHEETS.tasks, HEADERS.tasks, [task]);
  return { ok: true, message: "任務狀態已更新", task };
}

function appendTaskNote(data) {
  const spreadsheet = ensureSpreadsheet();
  ensureAllSheets(spreadsheet);
  
  const id = data.id;
  const note = data.note ? String(data.note).trim() : "";
  const userContext = data.userContext || null;
  
  if (!id) throw new Error("缺少任務 ID");
  if (!note) throw new Error("備註內容不可為空");
  
  // 1. 權限檢查
  if (!userContext || !userContext.role) {
    return { ok: false, message: "權限不足" };
  }
  
  const tasks = readObjects(SHEETS.tasks, HEADERS.tasks);
  const taskIndex = tasks.findIndex(t => t.id === id);
  if (taskIndex === -1) throw new Error("找不到該任務");
  
  const task = tasks[taskIndex];
  
  const role = userContext.role;
  const username = userContext.username || "";
  const displayName = userContext.displayName || "";
  const salesOwner = userContext.salesOwner || "";
  
  // 2. Validate note permissions
  let allowed = false;
  if (role === "admin" || role === "boss") {
    allowed = true;
  } else {
    // Normal users cannot append notes to Finished or Cancelled tasks
    const s = String(task.status || "").toLowerCase();
    if (s === "finished" || s === "done" || s === "cancelled") {
      return { ok: false, message: "任務已封存，非主管無法新增備註" };
    }
    
    if (role === "assistant") {
      allowed = (
        task.assignedRole === "assistant" ||
        task.assignedTo === username ||
        task.assignedTo === displayName ||
        task.assignedTo === salesOwner ||
        task.createdBy === username ||
        task.createdBy === displayName ||
        task.createdBy === salesOwner
      );
    } else if (role === "retailSales" || role === "showroomSales" || role === "sales") {
      allowed = (
        task.assignedTo === username ||
        task.assignedTo === displayName ||
        task.assignedTo === salesOwner ||
        task.createdBy === username ||
        task.createdBy === displayName ||
        task.createdBy === salesOwner
      );
    }
  }
  
  if (!allowed) {
    return { ok: false, message: "權限不足" };
  }
  
  // 3. Append-only note sanitation
  const sanitizedNote = sanitizeTaskText_(note, 200);
  const operatorName = getTaskOperatorName_(userContext);
  
  // Format: [YYYY-MM-DD HH:mm Operator(Role)] noteContent
  const timestamp = new Date();
  const year = timestamp.getFullYear();
  const month = String(timestamp.getMonth() + 1).padStart(2, '0');
  const day = String(timestamp.getDate()).padStart(2, '0');
  const hour = String(timestamp.getHours()).padStart(2, '0');
  const min = String(timestamp.getMinutes()).padStart(2, '0');
  const prefix = "[" + year + "-" + month + "-" + day + " " + hour + ":" + min + " " + operatorName + "(" + (role === "sales" ? "業務" : (role === "assistant" ? "助理" : role)) + ")] ";
  
  const fullNoteText = prefix + sanitizedNote;
  
  if (task.note) {
    task.note += "\n" + fullNoteText;
  } else {
    task.note = fullNoteText;
  }
  
  task.updatedAt = new Date().toISOString();
  task.updatedBy = operatorName;
  
  // 4. Write Audit Log
  appendAuditLog_({
    workId: task.id,
    action: "pwa_append_note",
    operator: operatorName,
    operatorRole: userContext.role || "",
    fromStatus: task.status || "",
    toStatus: task.status || "",
    details: sanitizedNote
  });
  
  upsertObjects(SHEETS.tasks, HEADERS.tasks, [task]);
  return { ok: true, message: "備註已新增", task };
}

function getTaskOperatorName_(userContext) {
  if (!userContext) return "unknown";
  return userContext.displayName || userContext.username || userContext.salesOwner || userContext.lineUserId || "unknown";
}

function canUserUpdateTask_(task, userContext) {
  if (!userContext) return false;
  const role = userContext.role;
  const username = userContext.username || "";
  const displayName = userContext.displayName || "";
  const salesOwner = userContext.salesOwner || "";
  
  if (role === "admin" || role === "boss") {
    return true;
  }
  
  if (role === "assistant") {
    return (
      task.assignedRole === "assistant" ||
      task.assignedTo === username ||
      task.assignedTo === displayName ||
      task.assignedTo === salesOwner
    );
  }
  
  if (role === "retailSales" || role === "showroomSales" || role === "sales") {
    const isAssignedToMe = (
      task.assignedTo && (
        task.assignedTo === username ||
        task.assignedTo === displayName ||
        task.assignedTo === salesOwner
      )
    );
    const isCreatedByMe = (
      task.createdBy && (
        task.createdBy === username ||
        task.createdBy === displayName ||
        task.createdBy === salesOwner
      )
    );
    return isAssignedToMe || isCreatedByMe;
  }
  
  return false;
}

function replyLineCustomMessage(replyToken, messagesArray) {
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
      messages: messagesArray
    }),
    muteHttpExceptions: true
  });
}

function replyRoleMenu(replyToken, user) {
  let text = "📋 您好 " + user.displayName + "，已為您載入工作中心選單。請選擇功能：";
  let items = [];
  
  const role = user.role;
  if (role === "showroomSales") {
    text = "📋 您好 " + user.displayName + "，已為您載入【門市業務】工作選單：";
    items = [
      { type: "action", action: { type: "message", label: "今日門市", text: "今日工作" } },
      { type: "action", action: { type: "message", label: "客戶追蹤", text: "客戶追蹤" } },
      { type: "action", action: { type: "message", label: "報價加工", text: "報價加工" } },
      { type: "action", action: { type: "message", label: "🎤 語音輸入", text: "🎤 語音輸入" } },
      { type: "action", action: { type: "message", label: "問 AI", text: "問 AI" } }
    ];
  } else if (role === "assistant") {
    text = "📋 您好 " + user.displayName + "，已為您載入【助理】工作選單：";
    items = [
      { type: "action", action: { type: "message", label: "待處理", text: "今日工作" } },
      { type: "action", action: { type: "message", label: "保留訂單", text: "保留訂單" } },
      { type: "action", action: { type: "message", label: "加工送貨", text: "加工送貨" } },
      { type: "action", action: { type: "message", label: "回報主管", text: "回報主管" } },
      { type: "action", action: { type: "message", label: "🎤 語音輸入", text: "🎤 語音輸入" } }
    ];
  } else if (role === "boss") {
    text = "📋 您好 " + user.displayName + "，已為您載入【老闆】監控選單：";
    items = [
      { type: "action", action: { type: "message", label: "今日總覽", text: "今日總覽" } },
      { type: "action", action: { type: "message", label: "異常提醒", text: "異常提醒" } },
      { type: "action", action: { type: "message", label: "業務進度", text: "業務進度" } },
      { type: "action", action: { type: "message", label: "問 AI", text: "問 AI" } }
    ];
  } else {
    text = "📋 您好 " + user.displayName + "，已為您載入【零售業務】工作選單：";
    items = [
      { type: "action", action: { type: "message", label: "今日工作", text: "今日工作" } },
      { type: "action", action: { type: "message", label: "查詢資料", text: "查詢資料" } },
      { type: "action", action: { type: "message", label: "新增工作", text: "新增工作" } },
      { type: "action", action: { type: "message", label: "🎤 語音輸入", text: "🎤 語音輸入" } },
      { type: "action", action: { type: "message", label: "問 AI", text: "問 AI" } }
    ];
  }
  
  const message = {
    type: "text",
    text: text,
    quickReply: { items: items }
  };
  
  replyLineCustomMessage(replyToken, [message]);
}

function replyMyTasks(replyToken, userId) {
  const result = listMyTasks({ lineUserId: userId });
  if (!result.ok || !result.tasks || !result.tasks.length) {
    replyLineMessage(replyToken, "🎉 您好！目前沒有需要處理的待辦工作任務。工作滿分！");
    return;
  }
  
  const bubbles = result.tasks.slice(0, 10).map(makeFlexTaskBubble);
  const flexMessage = {
    type: "flex",
    altText: "您的今日工作任務",
    contents: {
      type: "carousel",
      bubbles: bubbles
    }
  };
  
  replyLineCustomMessage(replyToken, [flexMessage]);
}

function replyBossOverview(replyToken) {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = readObjects(SHEETS.tasks, HEADERS.tasks);
  const holds = readObjects(SHEETS.holds, HEADERS.holds);
  const complaints = readObjects(SHEETS.complaints, HEADERS.complaints);
  
  const todayTasks = tasks.filter(t => t.dueDate === today);
  const total = todayTasks.length;
  const completed = todayTasks.filter(t => t.status === "done").length;
  const pending = todayTasks.filter(t => ["open", "inProgress"].includes(t.status)).length;
  const delayed = tasks.filter(t => t.status === "delayed").length;
  const blocked = tasks.filter(t => t.status === "blocked").length;
  
  const newHolds = holds.filter(h => h.createdAt && h.createdAt.slice(0, 10) === today).length;
  const openComplaints = complaints.filter(c => c.status !== "已結案").length;
  const openProcessing = tasks.filter(t => t.type === "processing" && t.status !== "done").length;
  
  const text = "📊 【今日業務總覽】(" + today + ")\n\n" +
    "🔹 今日任務統計：\n" +
    "  - 今日任務總數: " + total + " 筆\n" +
    "  - 已完成: " + completed + " 筆\n" +
    "  - 未完成: " + pending + " 筆\n" +
    "  - 延後處理: " + delayed + " 筆\n" +
    "  - 異常/受阻: " + blocked + " 筆\n\n" +
    "🔸 即時業務狀態：\n" +
    "  - 今日新增保留: " + newHolds + " 筆\n" +
    "  - 客訴待處理: " + openComplaints + " 筆\n" +
    "  - 加工待處理: " + openProcessing + " 筆\n\n" +
    "💡 點選「異常提醒」或「業務進度」可以查看更詳細的清單。";
    
  replyLineMessage(replyToken, text);
}

function replyBlockedTasks(replyToken) {
  const tasks = readObjects(SHEETS.tasks, HEADERS.tasks);
  const blocked = tasks.filter(t => t.status === "blocked");
  if (!blocked.length) {
    replyLineMessage(replyToken, "🎉 太棒了！目前沒有被標記為異常（受阻）的任務。");
    return;
  }
  
  const bubbles = blocked.slice(0, 10).map(makeFlexTaskBubble);
  replyLineCustomMessage(replyToken, [{
    type: "flex",
    altText: "異常受阻任務提醒",
    contents: { type: "carousel", bubbles: bubbles }
  }]);
}

function replyAllProgressTasks(replyToken) {
  const tasks = readObjects(SHEETS.tasks, HEADERS.tasks);
  const active = tasks.filter(t => ["open", "inProgress"].includes(t.status));
  if (!active.length) {
    replyLineMessage(replyToken, "ℹ️ 目前所有業務任務皆已處理完畢。");
    return;
  }
  const list = active.slice(0, 15).map(t => "- [" + (t.assignedTo || "未指派") + "] " + (t.title || t.description || "") + " (" + (t.status === "inProgress" ? "處理中" : "待處理") + ")").join("\n");
  replyLineMessage(replyToken, "📈 目前業務執行中任務 (前15筆)：\n\n" + list);
}

function makeFlexTaskBubble(task) {
  const typeMap = {
    delivery: "🚚 送貨",
    sampleDelivery: "📦 送樣",
    returnPickup: "↩️ 收退貨",
    reservationFollow: "⏳ 保留追蹤",
    complaintFollow: "⚠️ 客訴追蹤",
    visit: "🤝 拜訪",
    quoteFollow: "💵 報價追蹤",
    processing: "⚙️ 加工",
    orderInput: "📝 打訂單",
    stockReply: "📞 問貨回覆",
    other: "📋 其他"
  };
  const typeLabel = typeMap[task.type] || "📋 任務";
  
  const priorityColor = task.priority === "urgent" ? "#ff4d4f" : (task.priority === "high" ? "#faad14" : "#1890ff");
  const priorityLabel = task.priority === "urgent" ? "緊急" : (task.priority === "high" ? "重要" : "普通");

  const statusMap = {
    open: "待處理",
    inProgress: "處理中",
    done: "已完成",
    delayed: "已延後",
    blocked: "有異常",
    cancelled: "已取消"
  };
  const statusLabel = statusMap[task.status] || task.status;

  const contentFields = [
    {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: "客戶：", size: "sm", color: "#aaaaaa", flex: 2 },
        { type: "text", text: task.customerName || "無", size: "sm", color: "#333333", flex: 5, wrap: true }
      ]
    },
    {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: "產品：", size: "sm", color: "#aaaaaa", flex: 2 },
        { type: "text", text: task.productName || "無", size: "sm", color: "#333333", flex: 5, wrap: true }
      ]
    },
    {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: "數量：", size: "sm", color: "#aaaaaa", flex: 2 },
        { type: "text", text: String(task.quantity || "無"), size: "sm", color: "#333333", flex: 5 }
      ]
    },
    {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: "期限：", size: "sm", color: "#aaaaaa", flex: 2 },
        { type: "text", text: task.dueDate || "無", size: "sm", color: "#333333", flex: 5 }
      ]
    },
    {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: "狀態：", size: "sm", color: "#aaaaaa", flex: 2 },
        { type: "text", text: statusLabel, size: "sm", color: task.status === "done" ? "#52c41a" : (task.status === "blocked" ? "#ff4d4f" : "#333333"), weight: "bold", flex: 5 }
      ]
    }
  ];

  if (task.description) {
    contentFields.push({
      type: "text",
      text: "說明：" + task.description,
      size: "xs",
      color: "#666666",
      wrap: true,
      margin: "sm"
    });
  }

  if (task.note) {
    contentFields.push({
      type: "text",
      text: "備註：" + task.note,
      size: "xs",
      color: "#fa8c16",
      wrap: true,
      margin: "xs"
    });
  }

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: typeLabel, weight: "bold", size: "lg", color: "#ffffff" },
        { type: "text", text: priorityLabel, weight: "bold", size: "sm", color: "#ffffff", align: "end", gravity: "center" }
      ],
      backgroundColor: priorityColor
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: task.title || "無標題", weight: "bold", size: "md", wrap: true },
        { type: "separator", margin: "md" },
        { type: "box", layout: "vertical", margin: "md", spacing: "sm", contents: contentFields }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#52c41a",
              height: "sm",
              action: { type: "postback", label: "完成", data: "action=taskDone&id=" + task.id }
            },
            {
              type: "button",
              style: "secondary",
              height: "sm",
              action: { type: "postback", label: "延後", data: "action=taskDelay&id=" + task.id }
            }
          ]
        },
        {
          type: "box",
          layout: "horizontal",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "link",
              color: "#ff4d4f",
              height: "sm",
              action: { type: "postback", label: "異常", data: "action=taskBlock&id=" + task.id }
            },
            {
              type: "button",
              style: "link",
              height: "sm",
              action: { type: "postback", label: "備註", data: "action=taskNote&id=" + task.id }
            }
          ]
        },
        {
          type: "button",
          style: "link",
          color: "#1890ff",
          height: "sm",
          action: { type: "postback", label: "轉交助理", data: "action=taskAssignAssistant&id=" + task.id }
        }
      ]
    }
  };
}

function replyAssistantTasks(replyToken, userId) {
  replyMyTasks(replyToken, userId);
}

function replyShowroomTasks(replyToken, userId) {
  replyMyTasks(replyToken, userId);
}

function replyAbnormalTasks(replyToken) {
  replyBlockedTasks(replyToken);
}

function replyBusinessProgress(replyToken) {
  replyAllProgressTasks(replyToken);
}

function getSalespersonStores(salesOwner) {
  const stores = readObjects(SHEETS.stores, HEADERS.stores);
  if (!salesOwner || salesOwner === "全部" || salesOwner === "all") {
    return stores.slice(0, 9);
  }
  const filtered = stores.filter(s => s.salesOwner === salesOwner);
  return filtered.slice(0, 9);
}

function appendAuditLog_(payload) {
  try {
    const spreadsheet = ensureSpreadsheet();
    const sheet = ensureSheet(spreadsheet, SHEETS.auditLogs, HEADERS.auditLogs);
    const row = HEADERS.auditLogs.map((header) => {
      if (header === "id") return payload.id || "audit-" + Utilities.getUuid();
      if (header === "createdAt") return payload.createdAt || Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd HH:mm:ss");
      return payload[header] ?? "";
    });
    sheet.appendRow(row);
    return { ok: true };
  } catch (err) {
    console.error("appendAuditLog_ failed: " + err.toString());
    return { ok: false, error: err.toString() };
  }
}

function getTaskStatusReason_(data) {
  return data.reason || data.note || "";
}

function isAllowedTaskStatusReason_(status, reason) {
  const allowed = getAllowedTaskStatusReasons_(status);
  if (!allowed) return true;
  return allowed.indexOf(reason) !== -1;
}

function getAllowedTaskStatusReasons_(status) {
  if (status === "Blocked" || status === "blocked") {
    return ["庫存不足", "保留衝突", "商品型號疑似錯誤", "交期無法確認", "客戶資料不完整"];
  }
  if (status === "Waiting" || status === "delayed") {
    return ["缺客戶資料", "缺商品型號", "缺數量", "缺送貨資訊", "缺價格確認"];
  }
  return null;
}
