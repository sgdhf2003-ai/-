function ReminderRepository_getWeekendAlertSheet_(spreadsheetId, createIfMissing) {
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheetName = "假日警示排程";
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(["時間", "產品型號", "需求數量", "需求單位", "可用庫存", "相差片數", "顧客ID", "顧客暱稱", "狀態"]);
  }

  return sheet;
}

function ReminderRepository_appendWeekendAlert(spreadsheetId, row) {
  var sheet = ReminderRepository_getWeekendAlertSheet_(spreadsheetId, true);
  sheet.appendRow(row);
}

function ReminderRepository_readWeekendAlertRows(spreadsheetId) {
  var sheet = ReminderRepository_getWeekendAlertSheet_(spreadsheetId, false);
  if (!sheet) return null;
  return sheet.getDataRange().getValues();
}

function ReminderRepository_setWeekendAlertStatus(spreadsheetId, rowNumber, statusText) {
  var sheet = ReminderRepository_getWeekendAlertSheet_(spreadsheetId, false);
  if (!sheet) return;
  sheet.getRange(rowNumber, 9).setValue(statusText);
}
