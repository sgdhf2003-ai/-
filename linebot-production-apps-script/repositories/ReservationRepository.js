function ReservationRepository_getReserveSheet_(spreadsheetId, createIfMissing) {
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheetName = "客戶預留紀錄";
  var reserveSheet = ss.getSheetByName(sheetName);

  if (!reserveSheet && createIfMissing) {
    reserveSheet = ss.insertSheet(sheetName);
    reserveSheet.appendRow(["時間", "預留顧客", "商品型號", "系列", "目前庫存", "促銷說明"]);
  }

  return reserveSheet;
}

function ReservationRepository_trimReserveRows_(reserveSheet, maxReserveRows) {
  var totalRows = reserveSheet.getLastRow();
  if (totalRows > maxReserveRows + 1) {
    reserveSheet.deleteRows(2, totalRows - (maxReserveRows + 1));
  }
}

function ReservationRepository_appendReserveRecord(spreadsheetId, row, maxReserveRows) {
  var reserveSheet = ReservationRepository_getReserveSheet_(spreadsheetId, true);
  reserveSheet.appendRow(row);
  ReservationRepository_trimReserveRows_(reserveSheet, maxReserveRows);
}
