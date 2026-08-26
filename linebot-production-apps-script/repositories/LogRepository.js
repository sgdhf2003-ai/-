function LogRepository_getLineLogSheet_(spreadsheetId, createIfMissing) {
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName("LINE紀錄");
  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet("LINE紀錄");
    sheet.appendRow(["時間", "使用者輸入", "回覆內容", "狀態", "原始 JSON 資料"]);
  }
  return sheet;
}

function LogRepository_trimLineLog_(sheet, maxLogRows) {
  var totalRows = sheet.getLastRow();
  if (totalRows > maxLogRows + 1) {
    sheet.deleteRows(2, totalRows - (maxLogRows + 1));
  }
}

function LogRepository_appendLineLog(spreadsheetId, row, maxLogRows) {
  var logSheet = LogRepository_getLineLogSheet_(spreadsheetId, true);
  logSheet.appendRow(row);
  LogRepository_trimLineLog_(logSheet, maxLogRows);
}

function LogRepository_readRecentLineLogRows(spreadsheetId, limit) {
  var sheet = LogRepository_getLineLogSheet_(spreadsheetId, false);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  return values.slice(Math.max(1, values.length - limit));
}

function LogRepository_readRecentLineLogSummaries(spreadsheetId, limit) {
  var sheet = LogRepository_getLineLogSheet_(spreadsheetId, false);
  if (!sheet) return [];

  var logData = sheet.getDataRange().getValues();
  var lineLogResults = [];
  var count = 0;
  for (var r = logData.length - 1; r >= 1; r--) {
    var logRow = logData[r];
    if (!logRow || logRow.length === 0) continue;

    var timeVal = logRow[0] != null ? TextNormalizer_cleanLine(logRow[0]) : "";
    var userMsgVal = logRow[1] != null ? TextNormalizer_cleanLine(logRow[1]) : "";
    var replyVal = logRow[2] != null ? logRow[2].toString().trim() : "";
    var statusVal = logRow[3] != null ? TextNormalizer_cleanLine(logRow[3]) : "";

    if (timeVal === "" && userMsgVal === "" && replyVal === "") continue;

    lineLogResults.push({
      time: timeVal,
      userMsg: userMsgVal,
      reply: replyVal,
      status: statusVal
    });

    count++;
    if (count >= limit) break;
  }

  return lineLogResults;
}
