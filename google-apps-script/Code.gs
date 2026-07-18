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
    if (action === "updateTaskFields") return jsonOutput(updateTaskFields(data));
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
  let users = readObjects(SHEETS.users, HEADERS.users);

  let userIndex = -1;
  let user = users.find((item, index) => {
    const match = normalizeLoginValue(item.username) === username || normalizeLoginValue(item.displayName) === username;
    if (match) userIndex = index;
    return match;
  });
  if (!user) throw new Error("帳號或密碼錯誤");
  if (String(user.status || "").trim() !== "啟用") throw new Error("此帳號已停用，請聯絡管理員");
  if (String(user.password || "") !== password) throw new Error("帳號或密碼錯誤");

  // Validate and normalize lineUserId if provided
  let inputLineUserId = data.lineUserId;
  let hasValidLineUserId = false;
  if (inputLineUserId !== undefined && inputLineUserId !== null && String(inputLineUserId).trim() !== "") {
    let normalized = String(inputLineUserId).trim();
    if (normalized.length > 0 && (normalized[0] === 'u' || normalized[0] === 'U')) {
      normalized = 'U' + normalized.substring(1);
    }
    const lineUserIdRegex = /^U[a-fA-F0-9]{32}$/;
    if (!lineUserIdRegex.test(normalized)) {
      throw new Error("LINE 登入資訊無效，請重新從 LINE 機器人開啟登入連結");
    }
    inputLineUserId = normalized;
    hasValidLineUserId = true;
  }

  let bindActionCompleted = false;
  let alreadyBound = false;
  let apiDeferredActions = null;

  if (hasValidLineUserId) {
    const lock = LockService.getScriptLock();
    const lockAcquired = lock.tryLock(10000); // 10 seconds timeout
    if (!lockAcquired) {
      throw new Error("系統繁忙，請稍後再試");
    }

    try {
      // Re-read users inside lock to avoid race conditions
      users = readObjects(SHEETS.users, HEADERS.users);
      userIndex = -1;
      user = users.find((item, index) => {
        const match = normalizeLoginValue(item.username) === username || normalizeLoginValue(item.displayName) === username;
        if (match) userIndex = index;
        return match;
      });

      if (!user) throw new Error("帳號不存在或已被刪除");
      if (String(user.status || "").trim() !== "啟用") throw new Error("此帳號已停用，請聯絡管理員");
      if (String(user.password || "") !== password) throw new Error("帳號或密碼錯誤");

      const existingLineUserId = String(user.lineUserId || "").trim();

      // Case B: Same LINE ID already bound to this account
      if (existingLineUserId === inputLineUserId) {
        alreadyBound = true;
      } else {
        // Case C: Target account already bound to a different LINE ID
        if (existingLineUserId !== "") {
          throw new Error("此帳號已綁定其他 LINE，請聯絡管理員協助更換");
        }

        // Scan full sheet for inputLineUserId duplicates
        let matchCount = 0;
        for (let i = 0; i < users.length; i++) {
          const u = users[i];
          const uLineId = String(u.lineUserId || "").trim();
          if (uLineId === inputLineUserId) {
            matchCount++;
          }
        }

        // Case E: Existing data conflict (multiple rows share the same LINE ID)
        if (matchCount > 1) {
          console.error("DATA_CONFLICT: lineUserId matches multiple rows: " + matchCount);
          throw new Error("LINE 綁定資料異常，請聯絡管理員");
        }

        // Case D: LINE ID already bound to another employee account
        if (matchCount === 1) {
          throw new Error("此 LINE 帳號已綁定其他員工帳號，請聯絡管理員");
        }

        // Case A: Normal first-time binding
        const rowNum = userIndex + 2;
        const colIndex = HEADERS.users.indexOf("lineUserId") + 1;
        if (colIndex > 0) {
          usersSheet.getRange(rowNum, colIndex).setValue(inputLineUserId);
        }
        user.lineUserId = inputLineUserId;
        bindActionCompleted = true;
      }

      // Defer external network operations
      apiDeferredActions = {
        lineUserId: inputLineUserId,
        role: user.role,
        displayName: user.displayName,
        isNewBind: bindActionCompleted
      };

    } finally {
      lock.releaseLock();
    }
  }

  let richMenuSuccess = true;
  let pushNotificationSuccess = true;

  if (apiDeferredActions) {
    const targetLineId = apiDeferredActions.lineUserId;
    const targetRole = apiDeferredActions.role;
    const targetDisplayName = apiDeferredActions.displayName;

    try {
      linkLineRichMenu(targetLineId, targetRole);
    } catch (e) {
      richMenuSuccess = false;
      console.warn("Deferred rich menu link failed: " + e.toString());
    }

    if (apiDeferredActions.isNewBind) {
      try {
        const pushOk = sendLinePushMessage(
          targetLineId,
          "🎉 帳號綁定成功！\n您的 LINE 帳號已成功綁定為業務「" + targetDisplayName + "」，選單已切換為業務專用選單。"
        );
        if (!pushOk) {
          pushNotificationSuccess = false;
        }
      } catch (e) {
        pushNotificationSuccess = false;
        console.warn("Deferred push notification failed: " + e.toString());
      }
    }
  }

  const safeUser = sanitizeUser(user);
  return {
    ok: true,
    message: "登入成功",
    user: safeUser,
    permissions: getUserPermissions(safeUser),
    bindSuccess: bindActionCompleted,
    alreadyBound: alreadyBound,
    richMenuSuccess: richMenuSuccess,
    pushNotificationSuccess: pushNotificationSuccess
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
  if (!targetId) return false;
  const token = getSetting("lineChannelAccessToken") || DEFAULT_CHANNEL_ACCESS_TOKEN;
  if (!token) return false;

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
    return res.getResponseCode() === 200;
  } catch (e) {
    logDebug("LINE Messaging API push failed: " + e.toString());
    console.error("LINE Messaging API push failed:", e);
    return false;
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

function updateTaskFields(data) {
  const spreadsheet = ensureSpreadsheet();
  ensureAllSheets(spreadsheet);

  const id = data.id;
  const fields = data.fields;
  const payloadUpdatedAt = data.updatedAt;
  const userContext = data.userContext || null;

  if (!id) throw new Error("缺少任務 ID");
  if (!fields || typeof fields !== "object") {
    return { ok: false, message: "沒有可更新的欄位" };
  }

  // 1. 權限與身分檢查
  if (!userContext || !userContext.role) {
    return { ok: false, message: "權限不足，無法編輯此任務" };
  }

  // 2. 檢索任務
  const tasks = readObjects(SHEETS.tasks, HEADERS.tasks);
  const taskIndex = tasks.findIndex(t => t.id === id);
  if (taskIndex === -1) throw new Error("找不到該任務");
  const task = tasks[taskIndex];

  // 3. 樂觀鎖校驗
  if (payloadUpdatedAt && String(task.updatedAt || "").trim() !== String(payloadUpdatedAt).trim()) {
    return { ok: false, message: "版本衝突：此任務已被他人更新，請重整畫面再次重試", currentUpdatedAt: task.updatedAt };
  }

  // 4. 禁止欄位與白名單校驗
  const forbiddenFields = [
    "id", "type", "status", "source", "createdBy", "createdAt", "updatedAt", "updatedBy",
    "completedAt", "note", "workflowStage", "parentWorkId", "sourceRole", "sourceUser",
    "blockedReason", "startedAt"
  ];
  const whitelist = [
    "title", "description", "customerName", "productName", "quantity", "priority", "dueDate", "assignedRole", "assignedTo"
  ];

  const inputKeys = Object.keys(fields);
  if (inputKeys.length === 0) {
    return { ok: false, message: "沒有可更新的欄位" };
  }

  for (let i = 0; i < inputKeys.length; i++) {
    const k = inputKeys[i];
    if (forbiddenFields.indexOf(k) !== -1) {
      return { ok: false, message: "包含禁止編輯的欄位：" + k };
    }
    if (whitelist.indexOf(k) === -1) {
      return { ok: false, message: "包含不允許編輯的欄位：" + k };
    }
  }

  const updatePayload = {};
  let hasValidField = false;
  for (let i = 0; i < whitelist.length; i++) {
    const k = whitelist[i];
    if (fields[k] !== undefined) {
      updatePayload[k] = fields[k];
      hasValidField = true;
    }
  }

  if (!hasValidField) {
    return { ok: false, message: "沒有可更新的欄位" };
  }

  // 5. 欄位合法性驗證
  if (updatePayload.title !== undefined) {
    updatePayload.title = sanitizeTaskText_(updatePayload.title, 100);
    if (!updatePayload.title) {
      return { ok: false, message: "格式錯誤：標題為必填且不可為空" };
    }
  }

  if (updatePayload.description !== undefined) {
    updatePayload.description = sanitizeTaskText_(updatePayload.description, 500);
  }

  if (updatePayload.customerName !== undefined) {
    updatePayload.customerName = sanitizeTaskText_(updatePayload.customerName, 50);
  }

  if (updatePayload.productName !== undefined) {
    updatePayload.productName = sanitizeTaskText_(updatePayload.productName, 50);
  }

  if (updatePayload.quantity !== undefined) {
    updatePayload.quantity = sanitizeTaskText_(updatePayload.quantity, 30);
  }

  if (updatePayload.priority !== undefined) {
    if (!isValidTaskPriority_(updatePayload.priority)) {
      return { ok: false, message: "格式錯誤：優先權不合法" };
    }
  }

  if (updatePayload.dueDate !== undefined) {
    const d = String(updatePayload.dueDate).trim();
    if (d && !isValidDueDate_(d)) {
      return { ok: false, message: "格式錯誤：到期日格式應為 YYYY-MM-DD" };
    }
    updatePayload.dueDate = d;
  }

  if (updatePayload.assignedRole !== undefined) {
    const r = String(updatePayload.assignedRole).trim();
    if (r && !isValidAssignedRole_(r)) {
      return { ok: false, message: "格式錯誤：指派角色不合法" };
    }
    updatePayload.assignedRole = r;
  }

  if (updatePayload.assignedTo !== undefined) {
    updatePayload.assignedTo = sanitizeTaskText_(updatePayload.assignedTo, 50);
  }

  const finalRole = updatePayload.assignedRole !== undefined ? updatePayload.assignedRole : task.assignedRole;
  const finalAssignee = updatePayload.assignedTo !== undefined ? updatePayload.assignedTo : task.assignedTo;
  if (!finalRole && !finalAssignee) {
    return { ok: false, message: "格式錯誤：必須指定指派角色或指派人員" };
  }

  // 6. 角色權限校驗
  if (!canUserEditTaskFields_(task, userContext, finalRole, finalAssignee)) {
    return { ok: false, message: "權限不足，無法編輯此任務" };
  }

  // 7. 應用更新並記錄 Audit Log
  const changedFields = [];
  const newVals = {};

  const finalKeys = Object.keys(updatePayload);
  for (let i = 0; i < finalKeys.length; i++) {
    const k = finalKeys[i];
    const oldVal = task[k] || "";
    const newVal = updatePayload[k] || "";
    if (String(oldVal).trim() !== String(newVal).trim()) {
      changedFields.push(k);
      newVals[k] = newVal.slice(0, 30);
      task[k] = newVal;
    }
  }

  if (changedFields.length === 0) {
    return { ok: true, message: "欄位值未變更", task };
  }

  const operatorName = getTaskOperatorName_(userContext);
  task.updatedAt = new Date().toISOString();
  task.updatedBy = operatorName;

  // 8. 寫入 Audit Log
  appendAuditLog_({
    workId: task.id,
    action: "pwa_update_task",
    operator: operatorName,
    operatorRole: userContext.role || "",
    fromStatus: task.status || "",
    toStatus: task.status || "",
    details: "編輯欄位: " + changedFields.join(", ") + " | 變更: " + JSON.stringify(newVals)
  });

  upsertObjects(SHEETS.tasks, HEADERS.tasks, [task]);
  return { ok: true, message: "任務已更新", task };
}

function canUserEditTaskFields_(task, userContext, targetRole, targetAssignee) {
  if (!userContext || !userContext.role) return false;
  const role = String(userContext.role).toLowerCase().trim();
  const username = userContext.username || "";
  const displayName = userContext.displayName || "";
  const salesOwner = userContext.salesOwner || "";

  const isAdmin = (role === "admin" || role === "boss" || role === "manager" || userContext.role === "主管" || userContext.role === "管理員");

  const s = String(task.status || "").toLowerCase().trim();
  const isArchived = (s === "finished" || s === "done" || s === "cancelled");
  if (isArchived) {
    return isAdmin;
  }

  if (isAdmin) return true;

  if (role === "assistant" || userContext.role === "助理") {
    return (
      task.assignedRole === "assistant" ||
      task.assignedRole === "助理" ||
      task.assignedTo === username ||
      task.assignedTo === displayName ||
      task.assignedTo === salesOwner
    );
  }

  if (role === "sales" || role === "retailsales" || role === "showroomsales" || userContext.role === "業務") {
    return (
      task.assignedRole === "sales" ||
      task.assignedRole === "業務" ||
      task.assignedTo === username ||
      task.assignedTo === displayName ||
      task.assignedTo === salesOwner ||
      task.createdBy === username ||
      task.createdBy === displayName ||
      task.createdBy === salesOwner
    );
  }

  return false;
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

/**
 * LINE Reminder Link-only Dry-run functions
 */

function buildLineReminderLinkDryRunReport_(options) {
  options = options || {};
  const mode = options.mode || "dry-run";
  if (mode !== "dry-run") {
    throw new Error("Invalid mode: buildLineReminderLinkDryRunReport_ only supports 'dry-run' mode.");
  }

  const context = getLineReminderDryRunContext_(options);
  const candidates = getLineReminderCandidates_();

  const candidateUserCount = candidates.length;
  let eligibleUserCount = 0;
  let skippedUserCount = 0;

  const processedCandidates = [];
  const lineUserIdsSeen = {};

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const eligibility = isLineReminderCandidateEligible_(candidate, context, lineUserIdsSeen);

    let preview = "";
    if (eligibility.eligible) {
      eligibleUserCount++;
      preview = buildLineReminderMessagePreview_(candidate, context);
      if (candidate.lineUserId) {
        lineUserIdsSeen[candidate.lineUserId] = true;
      }
    } else {
      skippedUserCount++;
    }

    processedCandidates.push({
      userId: candidate.userId,
      name: candidate.name,
      role: candidate.role,
      status: candidate.status,
      hasLineUserId: !!candidate.lineUserId,
      optIn: "not_configured",
      quietHoursBlocked: false,
      frequencyBlocked: false,
      duplicateBlocked: eligibility.reason === "Skip: Duplicate LINE User ID",
      finalEligible: eligibility.eligible,
      reason: eligibility.eligible ? "OK" : eligibility.reason,
      messagePreview: preview
    });
  }

  return {
    ok: true,
    mode: "dry-run",
    runId: context.runId,
    runAt: context.runAt,
    notificationType: context.notificationType,
    targetRole: options.targetRole || "all",
    workCenterUrl: context.workCenterUrl,
    candidateUserCount: candidateUserCount,
    eligibleUserCount: eligibleUserCount,
    skippedUserCount: skippedUserCount,
    candidates: processedCandidates,
    lineApiCalled: false,
    messagesSent: 0,
    warnings: ["opt_in_not_configured_defaulting_to_true_for_simulation"],
    errors: []
  };
}

function getLineReminderCandidates_() {
  const rawUsers = readObjects(SHEETS.users, HEADERS.users);
  return rawUsers.map(function(u) {
    return {
      userId: u.id || "",
      name: u.displayName || u.username || "",
      role: u.role || "",
      status: u.status || "",
      lineUserId: u.lineUserId || ""
    };
  });
}

function isLineReminderCandidateEligible_(candidate, context, lineUserIdsSeen) {
  if (candidate.status !== "啟用") {
    return { eligible: false, reason: "Skip: Status is not 啟用" };
  }

  if (!candidate.lineUserId || candidate.lineUserId.trim() === "") {
    return { eligible: false, reason: "Skip: Missing LINE User ID" };
  }

  if (lineUserIdsSeen[candidate.lineUserId]) {
    return { eligible: false, reason: "Skip: Duplicate LINE User ID" };
  }

  const role = candidate.role ? candidate.role.trim() : "";
  const allowedRoles = [
    "admin", "boss", "manager", "assistant", "助理",
    "retailSales", "retail", "sales", "showroomSales", "showroom"
  ];
  if (allowedRoles.indexOf(role) === -1) {
    return { eligible: false, reason: "Skip: Role not allowed (" + role + ")" };
  }

  return { eligible: true, reason: "OK" };
}

function buildLineReminderMessagePreview_(candidate, context) {
  const url = context.workCenterUrl;
  const role = candidate.role ? candidate.role.trim() : "";

  if (role === "assistant" || role === "助理") {
    return "早安，請開啟工作中心查看助理待處理摘要與等資料事項：\n" + url;
  }

  if (role === "boss" || role === "admin" || role === "manager") {
    return "早安，請開啟工作中心查看主管每日總覽與團隊追蹤風險：\n" + url;
  }

  return "早安，請開啟今日工作中心查看今日摘要與待處理事項：\n" + url;
}

function getLineReminderWorkCenterUrl_() {
  const defaultUrl = "https://brown-phi.vercel.app";
  const productionUrl = PropertiesService.getScriptProperties().getProperty("PWA_PRODUCTION_URL") || defaultUrl;

  let baseUrl = productionUrl.trim();
  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }
  return baseUrl + "/?view=tasks";
}

function getLineReminderDryRunContext_(options) {
  const now = new Date();
  const year = now.getFullYear();
  const month = ("0" + (now.getMonth() + 1)).slice(-2);
  const date = ("0" + now.getDate()).slice(-2);
  const hour = ("0" + now.getHours()).slice(-2);
  const min = ("0" + now.getMinutes()).slice(-2);
  const sec = ("0" + now.getSeconds()).slice(-2);
  const runId = "dryrun-" + year + month + date + "-" + hour + min + sec;

  const runAt = Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd HH:mm:ss");

  return {
    runId: runId,
    runAt: runAt,
    notificationType: "linkReminder",
    workCenterUrl: getLineReminderWorkCenterUrl_()
  };
}

const TASK_DUE_NOTIFICATION_TIMEZONE_ = "Asia/Taipei";
const TASK_DUE_NOTIFICATION_SCHEMA_VERSION_ = "v1";
const TASK_DUE_NOTIFICATION_DEFAULT_CAP_ = 50;
const TASK_DUE_NOTIFICATION_MAX_CAP_ = 100;
const TASK_DUE_NOTIFICATION_LINE_ID_REGEX_ = /^U[a-fA-F0-9]{32}$/;

function normalizeTaskStatusForNotification_(status) {
  const raw = String(status === undefined || status === null ? "" : status).trim();
  const lower = raw.toLowerCase();
  if (lower === "created") return "CREATED";
  if (lower === "started") return "STARTED";
  if (lower === "waiting") return "WAITING";
  if (lower === "blocked") return "BLOCKED";
  if (lower === "finished" || lower === "done" || lower === "completed" || raw === "已完成") return "FINISHED";
  if (lower === "cancelled" || raw === "已取消") return "CANCELLED";
  return "UNKNOWN";
}

function normalizeTaskNotificationUsernameKey_(value) {
  return String(value === undefined || value === null ? "" : value).trim().toLowerCase();
}

function normalizeTaskNotificationDisplayNameKey_(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function normalizeTaskNotificationLineUserId_(value) {
  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw) return "";
  return raw.substring(0, 1).toUpperCase() + raw.substring(1);
}

function isTaskNotificationPlainAssignment_(value) {
  if (value === undefined || value === null) return true;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isTaskNotificationValidDateKey_(value) {
  const s = String(value || "").trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function getTodayKeyTaipei_() {
  return Utilities.formatDate(new Date(), TASK_DUE_NOTIFICATION_TIMEZONE_, "yyyy-MM-dd");
}

function normalizeTaskDueDateKeyTaipei_(value) {
  if (value === undefined || value === null || value === "") return "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) return null;
    return Utilities.formatDate(value, TASK_DUE_NOTIFICATION_TIMEZONE_, "yyyy-MM-dd");
  }
  const s = String(value).trim();
  if (!isTaskNotificationValidDateKey_(s)) return null;
  return s;
}

function taskNotificationDateKeyToUtcMs_(dateKey) {
  if (!isTaskNotificationValidDateKey_(dateKey)) return null;
  const parts = dateKey.split("-");
  return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function calculateTaipeiDateDifferenceDays_(todayKey, dueDateKey) {
  const todayMs = taskNotificationDateKeyToUtcMs_(todayKey);
  const dueMs = taskNotificationDateKeyToUtcMs_(dueDateKey);
  if (todayMs === null || dueMs === null) return null;
  return Math.round((todayMs - dueMs) / 86400000);
}

function isTaskNotificationEligible_(task) {
  if (!task || !String(task.id || "").trim()) {
    return { eligible: false, reason: "TASK_ID_MISSING", normalizedStatus: "UNKNOWN" };
  }
  if (!String(task.title || "").trim()) {
    return { eligible: false, reason: "TITLE_MISSING", normalizedStatus: "UNKNOWN" };
  }
  const normalizedStatus = normalizeTaskStatusForNotification_(task.status);
  if (normalizedStatus === "FINISHED") {
    return { eligible: false, reason: "STATUS_FINISHED", normalizedStatus };
  }
  if (normalizedStatus === "CANCELLED") {
    return { eligible: false, reason: "STATUS_CANCELLED", normalizedStatus };
  }
  if (normalizedStatus === "UNKNOWN") {
    return { eligible: false, reason: "UNKNOWN_STATUS", normalizedStatus };
  }
  const dueDateKey = normalizeTaskDueDateKeyTaipei_(task.dueDate);
  if (dueDateKey === "") {
    return { eligible: false, reason: "DUE_DATE_MISSING", normalizedStatus };
  }
  if (dueDateKey === null) {
    return { eligible: false, reason: "INVALID_DUE_DATE", normalizedStatus };
  }
  if (!String(task.assignedTo || "").trim()) {
    return { eligible: false, reason: "ASSIGNEE_MISSING", normalizedStatus };
  }
  return { eligible: true, reason: "ELIGIBLE", normalizedStatus, dueDateKey };
}

function buildTaskNotificationUsersIndex_(usersRows) {
  const index = {
    byUsername: {},
    activeByDisplayName: {},
    usernameCounts: {},
    lineUserIdCounts: {}
  };
  const users = Array.isArray(usersRows) ? usersRows : [];
  users.forEach(function(user) {
    user = user || {};
    const usernameKey = normalizeTaskNotificationUsernameKey_(user.username);
    const displayNameKey = normalizeTaskNotificationDisplayNameKey_(user.displayName);
    const status = String(user.status || "").trim();
    const lineUserId = normalizeTaskNotificationLineUserId_(user.lineUserId);
    if (usernameKey) {
      index.usernameCounts[usernameKey] = (index.usernameCounts[usernameKey] || 0) + 1;
    }
    if (TASK_DUE_NOTIFICATION_LINE_ID_REGEX_.test(lineUserId)) {
      index.lineUserIdCounts[lineUserId] = (index.lineUserIdCounts[lineUserId] || 0) + 1;
    }
    const safeUser = {
      username: String(user.username || "").trim(),
      usernameKey: usernameKey,
      displayName: String(user.displayName || "").trim(),
      displayNameKey: displayNameKey,
      status: status,
      role: String(user.role || "").trim(),
      lineUserId: lineUserId
    };
    if (usernameKey) {
      if (!index.byUsername[usernameKey]) index.byUsername[usernameKey] = [];
      index.byUsername[usernameKey].push(safeUser);
    }
    if (status === "啟用" && displayNameKey) {
      if (!index.activeByDisplayName[displayNameKey]) index.activeByDisplayName[displayNameKey] = [];
      index.activeByDisplayName[displayNameKey].push(safeUser);
    }
  });
  return index;
}

function resolveTaskNotificationRecipient_(task, usersIndex) {
  if (!task || !isTaskNotificationPlainAssignment_(task.assignedTo)) {
    return { ok: false, reason: "ASSIGNMENT_FORMAT_UNSUPPORTED" };
  }
  const assignedTo = String(task.assignedTo || "").trim();
  if (!assignedTo) {
    if (String(task.assignedRole || "").trim()) return { ok: false, reason: "ROLE_ONLY_ASSIGNMENT" };
    return { ok: false, reason: "ASSIGNEE_MISSING" };
  }
  const usernameKey = normalizeTaskNotificationUsernameKey_(assignedTo);
  const usernameMatches = usersIndex.byUsername[usernameKey] || [];
  if (usernameMatches.length > 1 || usersIndex.usernameCounts[usernameKey] > 1) {
    return { ok: false, reason: "USERNAME_DUPLICATE" };
  }
  let user = usernameMatches.length === 1 ? usernameMatches[0] : null;
  let resolution = "USERNAME";
  if (!user) {
    const displayMatches = usersIndex.activeByDisplayName[normalizeTaskNotificationDisplayNameKey_(assignedTo)] || [];
    if (displayMatches.length > 1) return { ok: false, reason: "USER_AMBIGUOUS" };
    if (displayMatches.length === 1) {
      user = displayMatches[0];
      resolution = "DISPLAY_NAME_UNIQUE";
    }
  }
  if (!user) return { ok: false, reason: "USER_NOT_FOUND" };
  if (String(user.status || "").trim() !== "啟用") return { ok: false, reason: "USER_INACTIVE" };
  if (!user.lineUserId) return { ok: false, reason: "LINE_UNBOUND" };
  if (!TASK_DUE_NOTIFICATION_LINE_ID_REGEX_.test(user.lineUserId)) return { ok: false, reason: "LINE_ID_INVALID" };
  if ((usersIndex.lineUserIdCounts[user.lineUserId] || 0) > 1) return { ok: false, reason: "LINE_ID_DUPLICATE" };
  if (!user.usernameKey) return { ok: false, reason: "USER_NOT_FOUND" };
  return {
    ok: true,
    username: user.usernameKey,
    displayNameSafe: truncateTaskNotificationText_(user.displayName || user.username, 30),
    lineUserId: user.lineUserId,
    resolution: resolution
  };
}

function buildTaskDueNotificationDedupeKey_(taskId, bucketDate, bucket, username) {
  const material = [
    TASK_DUE_NOTIFICATION_SCHEMA_VERSION_,
    String(taskId || "").trim(),
    String(bucketDate || "").trim(),
    String(bucket || "").trim().toUpperCase(),
    normalizeTaskNotificationUsernameKey_(username)
  ].join("|");
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, material);
  return bytes.map(function(b) {
    const v = b < 0 ? b + 256 : b;
    return ("0" + v.toString(16)).slice(-2);
  }).join("");
}

function truncateTaskNotificationText_(value, maxLength) {
  const s = String(value || "").trim().replace(/\s+/g, " ");
  if (s.length <= maxLength) return s;
  return s.substring(0, maxLength);
}

function maskTaskNotificationRecipient_(lineUserId) {
  const s = normalizeTaskNotificationLineUserId_(lineUserId);
  if (!TASK_DUE_NOTIFICATION_LINE_ID_REGEX_.test(s)) return "";
  return s.substring(0, 4) + "..." + s.substring(s.length - 4);
}

function createTaskDueNotificationEmptySummary_(todayKey) {
  return {
    ok: true,
    mode: "dry-run",
    timezone: TASK_DUE_NOTIFICATION_TIMEZONE_,
    todayKey: todayKey,
    scanned: 0,
    candidateCount: 0,
    dueToday: 0,
    overdue: 0,
    capped: false,
    skipped: {
      completed: 0,
      cancelled: 0,
      unknownStatus: 0,
      noTaskId: 0,
      noTitle: 0,
      noDueDate: 0,
      invalidDueDate: 0,
      future: 0,
      noAssignee: 0,
      recipientFailure: 0
    },
    recipientFailureReasons: {},
    candidates: []
  };
}

function incrementTaskDueRecipientFailure_(summary, reason) {
  summary.skipped.recipientFailure++;
  summary.recipientFailureReasons[reason] = (summary.recipientFailureReasons[reason] || 0) + 1;
}

function buildTaskDueNotificationDryRunCandidates_(tasksRows, usersRows, options) {
  options = options || {};
  const todayKey = options.todayKey && isTaskNotificationValidDateKey_(options.todayKey) ? options.todayKey : getTodayKeyTaipei_();
  let cap = Number(options.candidateCap || TASK_DUE_NOTIFICATION_DEFAULT_CAP_);
  if (!isFinite(cap) || cap <= 0) cap = TASK_DUE_NOTIFICATION_DEFAULT_CAP_;
  cap = Math.min(Math.floor(cap), TASK_DUE_NOTIFICATION_MAX_CAP_);
  const summary = createTaskDueNotificationEmptySummary_(todayKey);
  const usersIndex = buildTaskNotificationUsersIndex_(usersRows);
  const tasks = Array.isArray(tasksRows) ? tasksRows : [];
  tasks.forEach(function(task) {
    task = task || {};
    summary.scanned++;
    const eligibility = isTaskNotificationEligible_(task);
    if (!eligibility.eligible) {
      if (eligibility.reason === "TASK_ID_MISSING") summary.skipped.noTaskId++;
      else if (eligibility.reason === "TITLE_MISSING") summary.skipped.noTitle++;
      else if (eligibility.reason === "STATUS_FINISHED") summary.skipped.completed++;
      else if (eligibility.reason === "STATUS_CANCELLED") summary.skipped.cancelled++;
      else if (eligibility.reason === "UNKNOWN_STATUS") summary.skipped.unknownStatus++;
      else if (eligibility.reason === "DUE_DATE_MISSING") summary.skipped.noDueDate++;
      else if (eligibility.reason === "INVALID_DUE_DATE") summary.skipped.invalidDueDate++;
      else if (eligibility.reason === "ASSIGNEE_MISSING") {
        if (String(task.assignedRole || "").trim()) incrementTaskDueRecipientFailure_(summary, "ROLE_ONLY_ASSIGNMENT");
        else summary.skipped.noAssignee++;
      }
      return;
    }
    const dueDateKey = eligibility.dueDateKey;
    let bucket = "";
    let daysOverdue = 0;
    if (dueDateKey === todayKey) {
      bucket = "DUE_TODAY";
      daysOverdue = 0;
    } else if (dueDateKey < todayKey) {
      bucket = "OVERDUE";
      daysOverdue = calculateTaipeiDateDifferenceDays_(todayKey, dueDateKey);
    } else {
      summary.skipped.future++;
      return;
    }
    const recipient = resolveTaskNotificationRecipient_(task, usersIndex);
    if (!recipient.ok) {
      incrementTaskDueRecipientFailure_(summary, recipient.reason);
      return;
    }
    const dedupeKey = buildTaskDueNotificationDedupeKey_(task.id, todayKey, bucket, recipient.username);
    summary.candidates.push({
      taskId: String(task.id || "").trim(),
      titleSafe: truncateTaskNotificationText_(task.title, 40),
      bucket: bucket,
      dueDateKey: dueDateKey,
      daysOverdue: daysOverdue,
      assigneeUsername: recipient.username,
      assigneeDisplayNameSafe: recipient.displayNameSafe,
      maskedRecipient: maskTaskNotificationRecipient_(recipient.lineUserId),
      dedupeKeyShort: dedupeKey.substring(0, 12),
      eligible: true
    });
    if (bucket === "DUE_TODAY") summary.dueToday++;
    if (bucket === "OVERDUE") summary.overdue++;
  });
  summary.candidates.sort(function(a, b) {
    if (a.bucket !== b.bucket) return a.bucket === "OVERDUE" ? -1 : 1;
    if (a.dueDateKey !== b.dueDateKey) return a.dueDateKey.localeCompare(b.dueDateKey);
    if (a.taskId !== b.taskId) return a.taskId.localeCompare(b.taskId);
    return a.assigneeUsername.localeCompare(b.assigneeUsername);
  });
  if (summary.candidates.length > cap) {
    summary.capped = true;
    summary.candidates = summary.candidates.slice(0, cap);
  }
  summary.candidateCount = summary.candidates.length;
  return summary;
}

function openTaskDueNotificationSpreadsheetReadOnly_() {
  const spreadsheetId = (PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID") || "").trim();
  if (!spreadsheetId) return null;
  return SpreadsheetApp.openById(spreadsheetId);
}

function readTaskDueNotificationExistingObjects_(sheetName, headers) {
  const spreadsheet = openTaskDueNotificationSpreadsheetReadOnly_();
  if (!spreadsheet) throw new Error("TASK_DUE_SPREADSHEET_UNAVAILABLE");
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error("TASK_DUE_SHEET_UNAVAILABLE");
  const actualHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const headerMatches = headers.every(function(header, index) {
    return actualHeaders[index] === header;
  });
  if (!headerMatches) throw new Error("TASK_DUE_HEADER_MISMATCH");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values
    .map(function(row) {
      return headers.reduce(function(object, header, index) {
        object[header] = row[index];
        return object;
      }, {});
    })
    .filter(function(object) { return object.id || object.key; });
}

function buildTaskDueNotificationSafeLogSummary_(result) {
  return {
    ok: result.ok === true,
    mode: "dry-run",
    timezone: result.timezone || TASK_DUE_NOTIFICATION_TIMEZONE_,
    todayKey: result.todayKey || "",
    scanned: result.scanned || 0,
    candidateCount: result.candidateCount || 0,
    dueToday: result.dueToday || 0,
    overdue: result.overdue || 0,
    capped: result.capped === true,
    skipped: result.skipped || {},
    recipientFailureReasons: result.recipientFailureReasons || {}
  };
}

function triggerTaskDueNotificationDryRun() {
  try {
    const tasks = readTaskDueNotificationExistingObjects_(SHEETS.tasks, HEADERS.tasks);
    const users = readTaskDueNotificationExistingObjects_(SHEETS.users, HEADERS.users);
    const result = buildTaskDueNotificationDryRunCandidates_(tasks, users, {});
    Logger.log("Task Due Notification Dry Run Safe Summary: " + JSON.stringify(buildTaskDueNotificationSafeLogSummary_(result)));
    return result;
  } catch (e) {
    Logger.log("Task Due Notification Dry Run Safe Summary: " + JSON.stringify({ ok: false, mode: "dry-run", status: "FAILED" }));
    return { ok: false, mode: "dry-run", status: "FAILED" };
  }
}

const TASK_NOTIFICATION_LOG_SHEET_ = "TaskNotificationLog";
const TASK_NOTIFICATION_LOG_SCHEMA_VERSION_ = "v1";
const TASK_NOTIFICATION_LOG_HEADERS_ = [
  "id",
  "dedupeKey",
  "schemaVersion",
  "taskId",
  "recipientUsername",
  "recipientMasked",
  "bucket",
  "bucketDate",
  "dueDateKey",
  "status",
  "createdAt",
  "reservedAt",
  "sentAt",
  "updatedAt",
  "requestIdShort",
  "attemptCount",
  "errorCode",
  "source",
  "noteSafe",
  "parentLogId",
  "resolution",
  "resolvedAt",
  "resolvedBy"
];
const TASK_NOTIFICATION_LOG_STATUSES_ = [
  "CANDIDATE",
  "RESERVED",
  "SENT",
  "FAILED",
  "UNKNOWN_OUTCOME",
  "SKIPPED",
  "CANCELLED_RESERVATION",
  "RESOLVED_SENT",
  "RESOLVED_NOT_SENT"
];
const TASK_NOTIFICATION_LOG_BUCKETS_ = ["DUE_TODAY", "OVERDUE"];
const TASK_NOTIFICATION_LOG_SOURCES_ = ["TASK_DUE_REMINDER", "MANUAL_RETRY", "SETUP_TEST"];
const TASK_NOTIFICATION_LOG_RESOLUTIONS_ = ["CONFIRMED_SENT", "CONFIRMED_NOT_SENT"];
const TASK_NOTIFICATION_LOG_ERROR_CODES_ = [
  "LOG_SHEET_MISSING",
  "LOG_SCHEMA_INVALID",
  "LOG_LOCK_TIMEOUT",
  "LOG_CREATE_FAILED",
  "LOG_ROW_INVALID",
  "LOG_STATUS_INVALID",
  "LOG_VERSION_UNSUPPORTED",
  "UNKNOWN_OUTCOME"
];
const TASK_NOTIFICATION_LOG_NOTE_SAFE_ALLOWLIST_ = [
  "",
  "DO_NOT_RETRY",
  "OPERATOR_REVIEW_REQUIRED",
  "SCHEMA_CHECK",
  "SETUP_CREATED",
  "SETUP_EXISTS"
];
const TASK_NOTIFICATION_LOG_FORBIDDEN_ROW_FIELDS_ = {
  lineUserId: true,
  customerName: true,
  description: true,
  messageBody: true,
  token: true,
  secret: true,
  endpoint: true,
  rawResponse: true,
  stack: true
};
const TASK_NOTIFICATION_LOG_FIELD_CONTRACT_ = {
  id: { immutable: true, required: "reservation", sensitive: false },
  dedupeKey: { immutable: true, required: "reservation", sensitive: false },
  schemaVersion: { immutable: true, required: "all", sensitive: false },
  taskId: { immutable: true, required: "reservation", sensitive: false },
  recipientUsername: { immutable: true, required: "reservation", sensitive: false },
  recipientMasked: { immutable: true, required: "reservation", sensitive: "masked-only" },
  bucket: { immutable: true, required: "reservation", allowlist: "bucket", sensitive: false },
  bucketDate: { immutable: true, required: "reservation", sensitive: false },
  dueDateKey: { immutable: true, required: "reservation", sensitive: false },
  status: { immutable: false, required: "all", allowlist: "status", sensitive: false },
  createdAt: { immutable: true, required: "reservation", sensitive: false },
  reservedAt: { immutable: true, required: "reserved", sensitive: false },
  sentAt: { immutable: false, required: "sent", sensitive: false },
  updatedAt: { immutable: false, required: "all", sensitive: false },
  requestIdShort: { immutable: false, required: "outbound-attempt", sensitive: false },
  attemptCount: { immutable: false, required: "all", sensitive: false },
  errorCode: { immutable: false, required: "failure", allowlist: "errorCode", sensitive: false },
  source: { immutable: true, required: "reservation", allowlist: "source", sensitive: false },
  noteSafe: { immutable: false, required: "optional", allowlist: "noteSafe", sensitive: false },
  parentLogId: { immutable: true, required: "resolution", sensitive: false },
  resolution: { immutable: false, required: "resolution", allowlist: "resolution", sensitive: false },
  resolvedAt: { immutable: false, required: "resolution", sensitive: false },
  resolvedBy: { immutable: false, required: "resolution", sensitive: "canonical-username-only" }
};

function isTaskNotificationLogAllowlisted_(value, allowedValues, allowBlank) {
  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw) return allowBlank === true;
  return allowedValues.indexOf(raw) !== -1;
}

function isTaskNotificationLogTimestamp_(value, allowBlank) {
  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw) return allowBlank === true;
  const parsed = Date.parse(raw);
  return isFinite(parsed) && raw.indexOf("T") !== -1;
}

function isTaskNotificationLogNonNegativeInteger_(value) {
  if (value === "" || value === undefined || value === null) return false;
  const n = Number(value);
  return isFinite(n) && Math.floor(n) === n && n >= 0;
}

function buildTaskNotificationLogResult_(ok, status, errorCode, extra) {
  const result = {
    ok: ok === true,
    status: status || (ok ? "VALID" : "INVALID"),
    schemaVersion: TASK_NOTIFICATION_LOG_SCHEMA_VERSION_
  };
  if (errorCode) result.errorCode = errorCode;
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach(function(key) {
      result[key] = extra[key];
    });
  }
  return result;
}

function validateTaskNotificationLogSchema_(sheet) {
  if (!sheet) {
    return buildTaskNotificationLogResult_(false, "MISSING", "LOG_SHEET_MISSING", {
      columnCount: TASK_NOTIFICATION_LOG_HEADERS_.length
    });
  }
  const expected = TASK_NOTIFICATION_LOG_HEADERS_;
  const lastColumn = Number(sheet.getLastColumn ? sheet.getLastColumn() : 0);
  if (lastColumn !== expected.length) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_SCHEMA_INVALID", {
      columnCount: lastColumn
    });
  }
  if (lastColumn < 1) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_SCHEMA_INVALID", {
      columnCount: lastColumn
    });
  }
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(header) {
    return String(header === undefined || header === null ? "" : header).trim();
  });
  const seen = {};
  for (let i = 0; i < headers.length; i++) {
    if (!headers[i]) {
      return buildTaskNotificationLogResult_(false, "INVALID", "LOG_SCHEMA_INVALID", {
        columnCount: lastColumn
      });
    }
    if (seen[headers[i]]) {
      return buildTaskNotificationLogResult_(false, "INVALID", "LOG_SCHEMA_INVALID", {
        columnCount: lastColumn
      });
    }
    seen[headers[i]] = true;
    if (headers[i] !== expected[i]) {
      return buildTaskNotificationLogResult_(false, "INVALID", "LOG_SCHEMA_INVALID", {
        columnCount: lastColumn
      });
    }
  }
  if (TASK_NOTIFICATION_LOG_SCHEMA_VERSION_ !== "v1") {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_VERSION_UNSUPPORTED", {
      columnCount: lastColumn
    });
  }
  return buildTaskNotificationLogResult_(true, "VALID", "", {
    columnCount: expected.length
  });
}

function validateTaskNotificationLogRow_(rowObject) {
  const row = rowObject || {};
  const allowedFields = {};
  TASK_NOTIFICATION_LOG_HEADERS_.forEach(function(header) {
    allowedFields[header] = true;
  });
  const keys = Object.keys(row);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!allowedFields[key] || TASK_NOTIFICATION_LOG_FORBIDDEN_ROW_FIELDS_[key]) {
      return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
    }
  }

  const schemaVersion = String(row.schemaVersion || "").trim();
  if (schemaVersion !== TASK_NOTIFICATION_LOG_SCHEMA_VERSION_) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_VERSION_UNSUPPORTED");
  }

  const status = String(row.status || "").trim();
  if (!isTaskNotificationLogAllowlisted_(status, TASK_NOTIFICATION_LOG_STATUSES_, false)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_STATUS_INVALID");
  }
  if (!isTaskNotificationLogAllowlisted_(row.bucket, TASK_NOTIFICATION_LOG_BUCKETS_, false)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  if (!isTaskNotificationLogAllowlisted_(row.source, TASK_NOTIFICATION_LOG_SOURCES_, false)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  if (!isTaskNotificationLogAllowlisted_(row.resolution, TASK_NOTIFICATION_LOG_RESOLUTIONS_, true)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  if (!/^[a-f0-9]{64}$/.test(String(row.dedupeKey || "").trim())) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  const username = String(row.recipientUsername || "").trim();
  if (!username || username !== username.toLowerCase() || String(row.recipientUsername || "") !== username) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  if (!isTaskNotificationValidDateKey_(row.bucketDate) || !isTaskNotificationValidDateKey_(row.dueDateKey)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  if (!isTaskNotificationLogTimestamp_(row.createdAt, false) || !isTaskNotificationLogTimestamp_(row.updatedAt, false)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  if (row.reservedAt && !isTaskNotificationLogTimestamp_(row.reservedAt, true)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  if (row.sentAt && !isTaskNotificationLogTimestamp_(row.sentAt, true)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  if (row.resolvedAt && !isTaskNotificationLogTimestamp_(row.resolvedAt, true)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  if (!isTaskNotificationLogNonNegativeInteger_(row.attemptCount)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  if (row.errorCode && !isTaskNotificationLogAllowlisted_(row.errorCode, TASK_NOTIFICATION_LOG_ERROR_CODES_, true)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }
  if (!isTaskNotificationLogAllowlisted_(row.noteSafe, TASK_NOTIFICATION_LOG_NOTE_SAFE_ALLOWLIST_, true)) {
    return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
  }

  if (status === "RESERVED") {
    if (!isTaskNotificationLogTimestamp_(row.reservedAt, false) || String(row.sentAt || "").trim()) {
      return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
    }
  }
  if (status === "SENT") {
    if (!isTaskNotificationLogTimestamp_(row.sentAt, false) || String(row.errorCode || "").trim() || String(row.resolution || "").trim()) {
      return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
    }
  }
  if (status === "UNKNOWN_OUTCOME") {
    if (!String(row.requestIdShort || "").trim() || String(row.errorCode || "").trim() !== "UNKNOWN_OUTCOME") {
      return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
    }
  }
  if (status === "RESOLVED_SENT" || status === "RESOLVED_NOT_SENT") {
    const expectedResolution = status === "RESOLVED_SENT" ? "CONFIRMED_SENT" : "CONFIRMED_NOT_SENT";
    if (!String(row.parentLogId || "").trim() ||
        String(row.resolution || "").trim() !== expectedResolution ||
        !isTaskNotificationLogTimestamp_(row.resolvedAt, false) ||
        !String(row.resolvedBy || "").trim() ||
        String(row.resolvedBy || "").trim() !== String(row.resolvedBy || "").trim().toLowerCase()) {
      return buildTaskNotificationLogResult_(false, "INVALID", "LOG_ROW_INVALID");
    }
  }

  return buildTaskNotificationLogResult_(true, "VALID", "");
}

function openTaskNotificationLogSpreadsheetReadOnly_() {
  const spreadsheetId = (PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID") || "").trim();
  if (!spreadsheetId) return null;
  return SpreadsheetApp.openById(spreadsheetId);
}

function buildTaskNotificationLogSafeSummary_(result) {
  return {
    ok: result && result.ok === true,
    status: result && result.status ? result.status : "INVALID",
    schemaVersion: TASK_NOTIFICATION_LOG_SCHEMA_VERSION_,
    columnCount: result && result.columnCount ? result.columnCount : TASK_NOTIFICATION_LOG_HEADERS_.length,
    errorCode: result && result.errorCode ? result.errorCode : ""
  };
}

function triggerTaskNotificationLogSchemaCheck() {
  try {
    const spreadsheet = openTaskNotificationLogSpreadsheetReadOnly_();
    if (!spreadsheet) {
      const missing = buildTaskNotificationLogResult_(false, "MISSING", "LOG_SHEET_MISSING", {
        columnCount: TASK_NOTIFICATION_LOG_HEADERS_.length
      });
      Logger.log("Task Notification Log Schema Check Safe Summary: " + JSON.stringify(buildTaskNotificationLogSafeSummary_(missing)));
      return missing;
    }
    const sheet = spreadsheet.getSheetByName(TASK_NOTIFICATION_LOG_SHEET_);
    const result = validateTaskNotificationLogSchema_(sheet);
    Logger.log("Task Notification Log Schema Check Safe Summary: " + JSON.stringify(buildTaskNotificationLogSafeSummary_(result)));
    return result;
  } catch (e) {
    const failed = buildTaskNotificationLogResult_(false, "INVALID", "LOG_SCHEMA_INVALID", {
      columnCount: TASK_NOTIFICATION_LOG_HEADERS_.length
    });
    Logger.log("Task Notification Log Schema Check Safe Summary: " + JSON.stringify(buildTaskNotificationLogSafeSummary_(failed)));
    return failed;
  }
}

function setupTaskNotificationLogSheet() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return buildTaskNotificationLogResult_(false, "FAILED", "LOG_LOCK_TIMEOUT", {
      columnCount: TASK_NOTIFICATION_LOG_HEADERS_.length
    });
  }
  try {
    const spreadsheet = openTaskNotificationLogSpreadsheetReadOnly_();
    if (!spreadsheet) {
      return buildTaskNotificationLogResult_(false, "MISSING", "LOG_SHEET_MISSING", {
        columnCount: TASK_NOTIFICATION_LOG_HEADERS_.length
      });
    }
    let sheet = spreadsheet.getSheetByName(TASK_NOTIFICATION_LOG_SHEET_);
    if (sheet) {
      const existing = validateTaskNotificationLogSchema_(sheet);
      if (existing.ok) {
        return buildTaskNotificationLogResult_(true, "ALREADY_EXISTS", "", {
          columnCount: TASK_NOTIFICATION_LOG_HEADERS_.length
        });
      }
      return existing;
    }
    sheet = spreadsheet.insertSheet(TASK_NOTIFICATION_LOG_SHEET_);
    sheet.getRange(1, 1, 1, TASK_NOTIFICATION_LOG_HEADERS_.length).setValues([TASK_NOTIFICATION_LOG_HEADERS_]);
    if (sheet.freezeRows) sheet.freezeRows(1);
    SpreadsheetApp.flush();
    const created = validateTaskNotificationLogSchema_(sheet);
    if (!created.ok) return created;
    return buildTaskNotificationLogResult_(true, "CREATED", "", {
      columnCount: TASK_NOTIFICATION_LOG_HEADERS_.length
    });
  } catch (e) {
    return buildTaskNotificationLogResult_(false, "FAILED", "LOG_CREATE_FAILED", {
      columnCount: TASK_NOTIFICATION_LOG_HEADERS_.length
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {
      // Lock release failures do not change the safe setup result.
    }
  }
}

/**
 * Stage 20-F: LINE Push Single Whitelist Channel Manual Test Entrance
 */
function runSingleLinePushWhitelistTest_(options) {
  options = options || {};
  const dryRun = options.dryRun !== false;
  const send = options.send === true;
  const recipient = options.recipient;

  // Message is strictly hardcoded to the fixed test string.
  const message = "勁揚業務管家 LINE Push 安全通路測試中。";

  if (!recipient || typeof recipient !== "string") {
    return { ok: false, status: "INVALID_RECIPIENT", message: "Recipient lineUserId is invalid or empty." };
  }

  // Strict regex for LINE User ID format
  const lineUserIdRegex = /^U[a-fA-F0-9]{32}$/;
  if (!lineUserIdRegex.test(recipient)) {
    return { ok: false, status: "INVALID_RECIPIENT_FORMAT", message: "Recipient must be a single valid LINE User ID (starts with U followed by 32 hex chars)." };
  }

  const maskedRecipient = recipient.substring(0, 4) + "..." + recipient.substring(recipient.length - 4);
  const timestamp = new Date().getTime().toString();
  const requestId = "req-" + timestamp + "-" + Math.floor(Math.random() * 1000000);

  // Validate requestId format (only letters, numbers, hyphens, and underscores; length 8 to 100)
  const requestIdRegex = /^[A-Za-z0-9_-]{8,100}$/;
  if (!requestIdRegex.test(requestId)) {
    return { ok: false, status: "INVALID_REQUEST_ID", message: "Generated requestId format is invalid." };
  }

  // Dry run check executes BEFORE properties checks to allow safe previews when disabled
  if (dryRun && !send) {
    const props = PropertiesService.getScriptProperties();
    const sharedSecret = (props.getProperty("LINE_PUSH_SHARED_SECRET") || "").trim() || "dummy_secret_for_dry_run";
    const canonical = "jy-line-push-v1|sendPushReminder|" + requestId + "|" + timestamp + "|" + recipient + "|" + message;
    const signature = computeHmacSha256Hex_(canonical, sharedSecret);
    const payload = {
      internalRequest: "jy-line-push-v1",
      action: "sendPushReminder",
      requestId: requestId,
      timestamp: timestamp,
      recipient: recipient,
      message: message,
      signature: signature
    };

    return {
      ok: true,
      status: "DRY_RUN",
      mode: "dry-run",
      recipient: maskedRecipient,
      requestId: requestId,
      timestamp: timestamp,
      payloadSize: JSON.stringify(payload).length
    };
  }

  // Properties checks only happen for real send (send === true)
  const props = PropertiesService.getScriptProperties();
  const enabled = (props.getProperty("LINE_PUSH_ENABLED") || "").trim();
  if (enabled !== "enabled") {
    return { ok: false, status: "PUSH_DISABLED", message: "LINE Push is disabled on Backend script properties." };
  }

  const endpoint = (props.getProperty("LINE_BOT_INTERNAL_ENDPOINT") || "").trim();
  if (!endpoint) {
    return { ok: false, status: "ENDPOINT_MISSING", message: "LINE Bot internal endpoint (LINE_BOT_INTERNAL_ENDPOINT) is missing." };
  }

  const sharedSecret = (props.getProperty("LINE_PUSH_SHARED_SECRET") || "").trim();
  if (!sharedSecret) {
    return { ok: false, status: "SECRET_MISSING", message: "Shared secret (LINE_PUSH_SHARED_SECRET) is missing." };
  }

  const canonical = "jy-line-push-v1|sendPushReminder|" + requestId + "|" + timestamp + "|" + recipient + "|" + message;
  const signature = computeHmacSha256Hex_(canonical, sharedSecret);

  const payload = {
    internalRequest: "jy-line-push-v1",
    action: "sendPushReminder",
    requestId: requestId,
    timestamp: timestamp,
    recipient: recipient,
    message: message,
    signature: signature
  };

  // Real HTTP POST call to LINE Bot
  const fetchOptions = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(endpoint, fetchOptions);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    try {
      const result = JSON.parse(responseBody);
      return {
        ok: result.ok,
        status: result.status,
        message: result.message,
        recipient: result.recipient,
        responseCode: responseCode,
        rawResponse: responseBody.substring(0, 500)
      };
    } catch (e) {
      return {
        ok: false,
        status: "BAD_JSON_RESPONSE",
        message: "LINE Bot endpoint returned invalid JSON response.",
        responseCode: responseCode,
        rawResponse: responseBody.substring(0, 500)
      };
    }
  } catch (err) {
    return {
      ok: false,
      status: "HTTP_FETCH_FAILED",
      message: err.toString()
    };
  }
}

/**
 * SHA-256 HMAC helper for Apps Script
 */
function computeHmacSha256Hex_(value, key) {
  const keyBytes = Utilities.newBlob(key).getBytes();
  const valueBytes = Utilities.newBlob(value).getBytes();
  const signatureBytes = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    valueBytes,
    keyBytes
  );
  return signatureBytes.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

/**
 * Stage 20-I-B: LINE Push Dry Run Wrapper
 * This wrapper reads LINE_PUSH_TEST_RECIPIENT from Backend Script Properties
 * and invokes runSingleLinePushWhitelistTest_ with dryRun: true, send: false.
 */
function triggerSingleLinePushDryRun() {
  const props = PropertiesService.getScriptProperties();
  const recipient = (props.getProperty("LINE_PUSH_TEST_RECIPIENT") || "").trim();

  const result = runSingleLinePushWhitelistTest_({
    dryRun: true,
    send: false,
    recipient: recipient
  });

  // Strict safe summary object with strict type enforcement and fallback defaults
  const safeSummary = {
    ok: result.ok === true,
    status: typeof result.status === "string" ? result.status : (result.status ? String(result.status) : "UNKNOWN"),
    mode: "dry-run",
    maskedRecipient: typeof result.recipient === "string" ? result.recipient : ""
  };

  Logger.log("Dry Run Safe Summary: " + JSON.stringify(safeSummary));
  return safeSummary;
}


/**
 * Stage 20-K: LINE Push Single Allowlist Live Test
 * This wrapper reads LINE_PUSH_TEST_RECIPIENT from Backend Script Properties
 * and invokes runSingleLinePushWhitelistTest_ with dryRun: false, send: true.
 */
function triggerSingleLinePushLiveTest() {
  let recipient = "";
  let maskedRecipient = "";
  try {
    const props = PropertiesService.getScriptProperties();
    recipient = (props.getProperty("LINE_PUSH_TEST_RECIPIENT") || "").trim();
  } catch (e) {
    console.error("Failed to read script properties.");
    return {
      ok: false,
      status: "CONFIG_MISSING",
      mode: "live-send",
      maskedRecipient: ""
    };
  }

  if (!recipient) {
    return {
      ok: false,
      status: "INVALID_RECIPIENT",
      mode: "live-send",
      maskedRecipient: ""
    };
  }

  // Pre-validate format to prevent invalid recipients from going into the core
  const lineUserIdRegex = /^U[a-fA-F0-9]{32}$/;
  if (!lineUserIdRegex.test(recipient)) {
    return {
      ok: false,
      status: "INVALID_RECIPIENT_FORMAT",
      mode: "live-send",
      maskedRecipient: ""
    };
  }

  // Construct masked recipient locally based on validated recipient
  maskedRecipient = recipient.substring(0, 4) + "..." + recipient.substring(recipient.length - 4);

  try {
    const result = runSingleLinePushWhitelistTest_({
      dryRun: false,
      send: true,
      recipient: recipient
    });

    const isOk = result.ok === true;
    let status = typeof result.status === "string" ? result.status : "FAILED";

    // Map internal core status values to allowed status list
    if (status === "PUSH_DISABLED") {
      status = "DISABLED";
    } else if (status === "ENDPOINT_MISSING" || status === "SECRET_MISSING") {
      status = "CONFIG_MISSING";
    }

    // Strict status allowlist mapping
    const ALLOWED_STATUSES = [
      "SENT",
      "SUCCESS",
      "REJECTED",
      "DISABLED",
      "CONFIG_MISSING",
      "INVALID_RECIPIENT",
      "INVALID_RECIPIENT_FORMAT",
      "HTTP_ERROR",
      "HTTP_FETCH_FAILED",
      "UNKNOWN_OUTCOME",
      "FAILED"
    ];
    if (ALLOWED_STATUSES.indexOf(status) === -1) {
      status = "FAILED";
    }

    // Handle uncertain outcome on network fetch failures (like timeouts)
    if (status === "HTTP_FETCH_FAILED") {
      const msg = (typeof result.message === "string" ? result.message : "").toLowerCase();
      const isTimeout = msg.indexOf("timeout") !== -1 ||
                        msg.indexOf("timed out") !== -1 ||
                        msg.indexOf("time limit") !== -1 ||
                        msg.indexOf("exceeded maximum execution time") !== -1 ||
                        msg.indexOf("execution time exceeded") !== -1;
      if (isTimeout) {
        const safeTimeoutSummary = {
          ok: false,
          status: "UNKNOWN_OUTCOME",
          mode: "live-send",
          maskedRecipient: maskedRecipient,
          warning: "DO_NOT_RETRY"
        };
        Logger.log("Live Send Safe Summary: " + JSON.stringify(safeTimeoutSummary));
        return safeTimeoutSummary;
      }
    }

    const safeSummary = {
      ok: isOk,
      status: status,
      mode: "live-send",
      maskedRecipient: maskedRecipient
    };
    Logger.log("Live Send Safe Summary: " + JSON.stringify(safeSummary));
    return safeSummary;

  } catch (err) {
    console.error("Live test wrapper caught error.");
    const safeErrorSummary = {
      ok: false,
      status: "FAILED",
      mode: "live-send",
      maskedRecipient: maskedRecipient
    };
    Logger.log("Live Send Safe Summary: " + JSON.stringify(safeErrorSummary));
    return safeErrorSummary;
  }
}
