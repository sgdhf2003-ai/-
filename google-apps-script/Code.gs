const ROOT_FOLDER_ID = "1eOqcHag3qUO_Cd7n2Hv4A4Q3K8NKgXvB";
const SPREADSHEET_NAME = "勁揚業務管家後台";
const SHEETS = {
  stores: "店家資料",
  holds: "保留物品",
  photos: "照片存檔",
  settings: "系統設定",
};

const HEADERS = {
  stores: ["id", "customerCode", "name", "shortName", "salesOwner", "phone", "phone2", "mobile", "address", "region", "contactName", "taxId", "note", "createdAt", "updatedAt"],
  holds: ["id", "storeId", "storeName", "salesOwner", "item", "quantity", "reservationStatus", "holdAddress", "holdDate", "expiresAt", "reminderAt", "note", "status", "createdAt", "updatedAt"],
  photos: ["id", "storeId", "storeName", "salesOwner", "category", "note", "driveUrl", "fileId", "folderId", "createdAt", "uploadedAt"],
  settings: ["key", "value", "updatedAt"],
};

function doGet() {
  return jsonOutput(readAll());
}

function doPost(e) {
  try {
    const data = parseBody(e);
    const action = data.action || "readAll";
    if (action === "setup") return jsonOutput(setupBackend(data));
    if (action === "readAll") return jsonOutput(readAll());
    if (action === "snapshot") return jsonOutput(saveSnapshot(data));
    if (action === "upsertStore") return jsonOutput(upsertStores([data.store]));
    if (action === "upsertHold") return jsonOutput(upsertHolds([data.hold]));
    if (action === "uploadPhoto") return jsonOutput(uploadPhoto(data));
    throw new Error("Unknown action: " + action);
  } catch (error) {
    return jsonOutput({ ok: false, error: error.message || String(error) });
  }
}

function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function setupBackend(data) {
  const spreadsheet = ensureSpreadsheet();
  ensureAllSheets(spreadsheet);
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
  if (Array.isArray(data.photos)) upsertPhotos(data.photos);
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
    photos: readObjects(SHEETS.photos, HEADERS.photos),
  };
}

function uploadPhoto(data) {
  const spreadsheet = ensureSpreadsheet();
  ensureAllSheets(spreadsheet);
  const photo = data.photo || {};
  const imageDataUrl = data.imageDataUrl || "";
  if (!photo.id) throw new Error("Missing photo id");
  if (!imageDataUrl.startsWith("data:image/")) throw new Error("Missing image data");

  const root = DriveApp.getFolderById(getRootFolderId(data));
  const storeFolder = getOrCreateFolder(root, sanitizeName(photo.storeName || photo.storeId || "未指定店家"));
  const createdAt = photo.createdAt ? new Date(photo.createdAt) : new Date();
  const timestamp = Utilities.formatDate(createdAt, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
  const fileName = sanitizeName(timestamp + "-" + (photo.category || "照片") + "-" + (photo.storeName || "店家")) + ".jpg";
  const blob = dataUrlToBlob(imageDataUrl, fileName);
  const file = storeFolder.createFile(blob);
  const uploadedAt = new Date().toISOString();
  const savedPhoto = {
    id: photo.id,
    storeId: photo.storeId,
    storeName: photo.storeName,
    salesOwner: photo.salesOwner,
    category: photo.category,
    note: photo.note,
    driveUrl: file.getUrl(),
    fileId: file.getId(),
    folderId: storeFolder.getId(),
    createdAt: photo.createdAt,
    uploadedAt,
  };
  upsertPhotos([savedPhoto]);
  return { ok: true, message: "照片已上傳 Google Drive", ...savedPhoto };
}

function upsertStores(stores) {
  upsertObjects(SHEETS.stores, HEADERS.stores, stores.filter(Boolean).map((store) => ({ ...store, updatedAt: new Date().toISOString() })));
  return { ok: true, message: "店家資料已同步" };
}

function upsertHolds(holds) {
  const storesById = makeLookup(readObjects(SHEETS.stores, HEADERS.stores), "id");
  const rows = holds.filter(Boolean).map((hold) => {
    const store = storesById[hold.storeId] || {};
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
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (current.join("") !== headers.join("")) {
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
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

function jsonOutput(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
