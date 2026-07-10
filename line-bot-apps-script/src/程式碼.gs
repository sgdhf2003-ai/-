var INVENTORY_SS_ID = "1C_R1DdTj5brxftl9fPabTKBGzcG-lxWWxWoyi-ItA48";
var RANKING_SS_ID = "15OD-TDYrBlBeGQ0S1zVuxkFdD4CdXqCUDIYQ4Dbdw3Q";
var RANKING_SHEET_NAME = "庫存數量排行";

function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu("業績系統選單")
      .addItem("重新整理產品數量排行", "refreshQuantityRankingFromMenu")
      .addToUi();
  } catch (err) {
    console.log("onOpen skipped: " + err.toString());
  }
}

function refreshQuantityRankingFromMenu() {
  var result = refreshQuantityRanking();
  SpreadsheetApp.getActiveSpreadsheet().toast(result.message || "已更新排行", "業績系統", 5);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.page === 'promo') {
    return HtmlService.createHtmlOutputFromFile('Promo')
        .setTitle('勁揚建材 - 特惠促銷商品目錄')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  if (e && e.parameter && e.parameter.action === 'readSpreadsheet') {
    var fileId = e.parameter.fileId;
    try {
      var ss = SpreadsheetApp.openById(fileId);
      var sheets = ss.getSheets();
      var allData = {};
      for (var i = 0; i < sheets.length; i++) {
        var sheet = sheets[i];
        var name = sheet.getName();
        allData[name] = sheet.getDataRange().getValues();
      }
      return ContentService.createTextOutput(JSON.stringify(allData)).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  if (e && e.parameter && e.parameter.action === 'getLogs') {
    var lastN = LogRepository_readRecentLineLogRows(INVENTORY_SS_ID, 500);
    return ContentService.createTextOutput(JSON.stringify(lastN)).setMimeType(ContentService.MimeType.JSON);
  }
  if (e && e.parameter && e.parameter.action === 'inspectRow') {
    var ss = SpreadsheetApp.openById(INVENTORY_SS_ID);
    var sheet = ss.getSheetByName("庫存查詢表");
    var range = sheet.getRange("A1:Q5");
    var values = range.getValues();
    return ContentService.createTextOutput(JSON.stringify(values)).setMimeType(ContentService.MimeType.JSON);
  }
  if (e && e.parameter && e.parameter.action === 'inspectFormulas') {
    var ss = SpreadsheetApp.openById(INVENTORY_SS_ID);
    var sheet = ss.getSheetByName("庫存查詢表");
    var values = sheet.getDataRange().getValues();
    var formulas = sheet.getDataRange().getFormulas();
    var result = [];
    for (var i = 0; i < values.length; i++) {
      var rowVal = values[i];
      var rowForm = formulas[i];
      if (rowVal && rowVal[2] && rowVal[2].toString().indexOf("ES-3901") !== -1) {
        result.push({
          row: i + 1,
          model: rowVal[2],
          batch: rowVal[6],
          stockVal: rowVal[10],
          stockForm: rowForm[10],
          availVal: rowVal[11],
          availForm: rowForm[11],
          reserveVal: rowVal[12],
          reserveForm: rowForm[12]
        });
      }
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }
  if (e && e.parameter && e.parameter.action === 'getAllRows') {
    var ss = SpreadsheetApp.openById(INVENTORY_SS_ID);
    var sheet = ss.getSheetByName("庫存查詢表");
    var values = sheet.getDataRange().getValues();
    return ContentService.createTextOutput(JSON.stringify(values)).setMimeType(ContentService.MimeType.JSON);
  }
  if (e && e.parameter && e.parameter.action === 'runConvert') {
    convertChipsToUrls();
    return ContentService.createTextOutput("SUCCESS").setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.action === 'getHeaders') {
    var ss = SpreadsheetApp.openById(INVENTORY_SS_ID);
    var sheet = ss.getSheetByName("庫存查詢表");
    var headers = sheet.getDataRange().getValues()[0];
    return ContentService.createTextOutput(JSON.stringify(headers)).setMimeType(ContentService.MimeType.JSON);
  }
  if (e && e.parameter && e.parameter.action === 'searchSheet') {
    var ss = SpreadsheetApp.openById(INVENTORY_SS_ID);
    var sheets = ss.getSheets();
    var results = [];
    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      var name = sheet.getName();
      var values = sheet.getDataRange().getValues();
      for (var r = 0; r < values.length; r++) {
        var row = values[r];
        for (var c = 0; c < row.length; c++) {
          var val = row[c];
          if (val && val.toString().indexOf('精細實景圖') !== -1) {
            results.push({ sheet: name, cell: (r+1) + "," + (c+1), value: val });
          }
        }
      }
    }
    return ContentService.createTextOutput(JSON.stringify(results)).setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('勁揚建材庫存查詢系統')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function getInventoryData() {
  var ss = SpreadsheetApp.openById(INVENTORY_SS_ID);
  
  // ==========================================
  // 1. 抓取主要「庫存查詢表」資料
  // ==========================================
  var sheet = ss.getSheetByName("庫存查詢表");
  if (!sheet) {
    return { success: false, message: "錯誤：找不到名為『庫存查詢表』的分頁！請確認新表格的分頁名稱是否正確。" };
  }
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0]; 
  var idxSeries = -1, idxOrigin = -1, idxModel = -1, idxSize = -1, idxWeight = -1, idxBatch = -1, idxReserved = -1, idxNote = -1, idxContract = -1;  
  
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] == null) continue;
    var h = headers[i].toString().replace(/\s+/g, ''); 
    if (h.indexOf("系列") !== -1) idxSeries = i;
    if (h.indexOf("產地") !== -1) idxOrigin = i;
    if (h.indexOf("編號") !== -1 || h.indexOf("型號") !== -1 || h.indexOf("品名") !== -1) idxModel = i;
    if (h === "規格尺寸" || h.indexOf("規格尺寸") !== -1) idxSize = i;
    else if (idxSize === -1 && h.indexOf("尺寸") !== -1) idxSize = i;
    if (h.indexOf("重量") !== -1) idxWeight = i;
    if (h.indexOf("批號") !== -1) idxBatch = i;
    if (h.indexOf("保留") !== -1) idxReserved = i;
    if (h.indexOf("備註") !== -1 || h.indexOf("說明") !== -1) idxNote = i;
    
    if (h.indexOf("簽約限定") !== -1 || h.indexOf("限定產品") !== -1) {
      idxContract = i;
    }
  }
  
  if (idxContract === -1 && headers.length > 14) {
    idxContract = 14; 
  }
  
  function parseRobust(val) {
    return QuantityParser_parseNumberOrNaN(val);
  }
  
  function cleanString(val) {
    return TextNormalizer_cleanLine(val);
  }
  
  var results = [];
  if (data.length > 1) {
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (!row || row.length === 0) continue;
      
      var modelVal = (idxModel !== -1) ? cleanString(row[idxModel]) : "";
      var seriesVal = (idxSeries !== -1) ? cleanString(row[idxSeries]) : "";
      var batchVal = (idxBatch !== -1) ? cleanString(row[idxBatch]) : "";
      
      if (modelVal === "" && seriesVal === "") continue; 

      var isContract = false;
      if (idxContract !== -1 && row[idxContract] != null) {
        var cVal = row[idxContract].toString().trim().toUpperCase();
        if (cVal === "TRUE" || cVal === "V" || cVal === "✔" || cVal === "✅" || cVal === "是" || cVal === "1") {
          isContract = true;
        }
      }

      var rawJText = (row.length > 9 && row[9] != null && row[9].toString().trim() !== "") ? cleanString(row[9]) : "未標示";
      
      var numJ = parseRobust((row.length > 9) ? row[9] : "");
      var stockK = parseRobust((row.length > 10) ? row[10] : "");
      if(isNaN(stockK)) stockK = 0;
      
      var stockL = parseRobust((row.length > 11) ? row[11] : "");
      if(isNaN(stockL)) stockL = 0;
      
      var reservedVal = 0;
      if (idxReserved !== -1 && row[idxReserved] != null) {
        var pRes = parseRobust(row[idxReserved]);
        if(!isNaN(pRes)) reservedVal = pRes;
      }
      
      var pingVal = "-"; 
      if (stockL <= 0) {
         pingVal = "0"; 
      } else if (!isNaN(numJ) && numJ > 0) {
         var calc = stockL / numJ;
         pingVal = parseFloat(calc.toFixed(2)).toString(); 
      } else {
         pingVal = "0"; 
      }

      results.push({
        series: seriesVal,
        origin: (idxOrigin !== -1) ? cleanString(row[idxOrigin]) : "",
        model: modelVal,
        size: (idxSize !== -1) ? cleanString(row[idxSize]) : "-",
        weight: (idxWeight !== -1) ? cleanString(row[idxWeight]) : "-",
        rawJ: rawJText, 
        isContract: isContract, 
        stockWarehouse: stockK, 
        stock: stockL,
        ping: pingVal,
        batch: batchVal || "-",
        reserved: reservedVal, 
        note: (idxNote !== -1) ? cleanString(row[idxNote]) : ""
      });
    }
  }

  // ==========================================
  // 2. 抓取新增的「到港貨物庫存」資料
  // ==========================================
  var arrivingResults = [];
  var sheetArriving = ss.getSheetByName("到港貨物庫存");
  if (sheetArriving) {
    var arrData = sheetArriving.getDataRange().getValues();
    for (var r = 1; r < arrData.length; r++) { 
      var arrRow = arrData[r];
      if (!arrRow || arrRow.length === 0) continue;

      var colA = arrRow[0] != null ? arrRow[0].toString().trim() : "";
      var colB = arrRow[1] != null ? arrRow[1].toString().trim() : "";
      var colC = arrRow[2] != null ? arrRow[2].toString().trim() : "";
      var colD = arrRow[3] != null ? arrRow[3].toString().trim() : "";
      var colE = arrRow[4] != null ? arrRow[4].toString().trim() : "";

      if (colA === "" && colB === "" && colC === "" && colD === "" && colE === "") continue;

      // 💥【防護網】只要A欄出現「瑞錦」或「上詣」，直接屏蔽不抓取
      if (colA.indexOf("瑞錦") !== -1 || colA.indexOf("上詣") !== -1) {
        continue;
      }

      if (arrRow[4] instanceof Date) {
        var d = arrRow[4];
        var month = (d.getMonth() + 1).toString().padStart(2, '0');
        var day = d.getDate().toString().padStart(2, '0');
        colE = month + "/" + day;
      }

      arrivingResults.push({
        colA: colA, 
        colB: colB, 
        colC: colC, 
        colD: colD, 
        colE: colE  
      });
    }
  }

  // ==========================================
  // 3. 抓取「LINE紀錄」資料（最新 200 筆）
  // ==========================================
  var lineLogResults = LogRepository_readRecentLineLogSummaries(INVENTORY_SS_ID, 200);

  return { success: true, data: results, arrivingData: arrivingResults, lineLogData: lineLogResults };
}

// 💥 轉換 P 欄（單片圖檔）與 Q 欄（單片實景）的智慧晶片為純文字連結
function convertChipsToUrls() {
  var ss = SpreadsheetApp.openById(INVENTORY_SS_ID);
  var sheet = ss.getSheetByName("庫存查詢表");
  if (!sheet) {
    Logger.log("找不到分頁『庫存查詢表』");
    return;
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("沒有資料列！");
    return;
  }
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idxPhoto = -1;
  var idxScene = -1;
  
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] == null) continue;
    var h = headers[i].toString().replace(/\s+/g, '');
    if (h.indexOf("單片圖檔") !== -1 || h.indexOf("圖檔") !== -1) idxPhoto = i;
    if (h.indexOf("單片實景") !== -1 || h.indexOf("實景") !== -1 || h.indexOf("場景") !== -1) idxScene = i;
  }
  
  if (idxPhoto === -1 || idxScene === -1) {
    Logger.log("找不到『單片圖檔』或『單片實景』欄位！自動使用 P 欄 (16) 與 Q 欄 (17)。");
    if (idxPhoto === -1) idxPhoto = 15; // P 欄 (0-based index 15)
    if (idxScene === -1) idxScene = 16; // Q 欄 (0-based index 16)
  }
  
  Logger.log("已選定欄位索引：單片圖檔=" + (idxPhoto+1) + "，單片實景=" + (idxScene+1));
  
  var rangeP = sheet.getRange(2, idxPhoto + 1, lastRow - 1, 1);
  var rangeQ = sheet.getRange(2, idxScene + 1, lastRow - 1, 1);
  
  var richTextValuesP = rangeP.getRichTextValues();
  var richTextValuesQ = rangeQ.getRichTextValues();
  var rawValuesP = rangeP.getValues();
  var rawValuesQ = rangeQ.getValues();
  
  var newValuesP = [];
  var newValuesQ = [];
  
  for (var i = 0; i < richTextValuesP.length; i++) {
    // 處理 P 欄 (單片圖檔)
    var cellP = richTextValuesP[i][0];
    var urlP = cellP ? cellP.getLinkUrl() : null;
    var textP = cellP ? cellP.getText().trim() : "";
    
    if (urlP) {
      newValuesP.push([urlP]);
    } else if (textP.startsWith("http://") || textP.startsWith("https://")) {
      newValuesP.push([textP]);
    } else {
      newValuesP.push([rawValuesP[i][0]]);
    }
    
    // 處理 Q 欄 (單片實景)
    var cellQ = richTextValuesQ[i][0];
    var urlQ = cellQ ? cellQ.getLinkUrl() : null;
    var textQ = cellQ ? cellQ.getText().trim() : "";
    
    if (urlQ) {
      newValuesQ.push([urlQ]);
    } else if (textQ.startsWith("http://") || textQ.startsWith("https://")) {
      newValuesQ.push([textQ]);
    } else {
      newValuesQ.push([rawValuesQ[i][0]]);
    }
  }
  
  // 寫回純文字 URL
  rangeP.setValues(newValuesP);
  rangeQ.setValues(newValuesQ);
  
  Logger.log("轉換完成！");
}

function refreshQuantityRanking() {
  var sourceSs = SpreadsheetApp.openById(INVENTORY_SS_ID);
  var sourceSheet = sourceSs.getSheetByName("庫存查詢表");
  if (!sourceSheet) {
    return { success: false, message: "找不到來源分頁『庫存查詢表』。" };
  }

  var targetSs = SpreadsheetApp.openById(RANKING_SS_ID);
  var targetSheet = targetSs.getSheetByName(RANKING_SHEET_NAME);
  if (!targetSheet) {
    targetSheet = targetSs.insertSheet(RANKING_SHEET_NAME);
  }

  var values = sourceSheet.getDataRange().getValues();
  var headers = values.length > 0 ? values[0] : [];
  var idxModel = -1;
  var idxSeries = -1;
  var idxBatch = -1;
  var idxQty = -1;

  for (var i = 0; i < headers.length; i++) {
    if (headers[i] == null) continue;
    var h = headers[i].toString().replace(/\s+/g, "");
    if (h.indexOf("編號") !== -1 || h.indexOf("型號") !== -1 || h.indexOf("品名") !== -1) idxModel = i;
    if (h.indexOf("系列") !== -1) idxSeries = i;
    if (h.indexOf("批號") !== -1) idxBatch = i;
    if (h.indexOf("可用庫存") !== -1 || h.indexOf("數量") !== -1 || h.indexOf("庫存") !== -1) idxQty = i;
  }

  if (idxModel === -1) idxModel = 0;
  if (idxBatch === -1) idxBatch = 2;
  if (idxSeries === -1) idxSeries = 3;
  if (idxQty === -1) idxQty = 11;

  function cleanText(val) {
    return TextNormalizer_cleanLine(val);
  }

  function parseQty(val) {
    return QuantityParser_parseNumberOrZero(val);
  }

  var grouped = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row || row.length === 0) continue;

    var model = cleanText(row[idxModel]);
    var batch = cleanText(row[idxBatch]);
    var series = cleanText(row[idxSeries]);
    var qty = parseQty(row[idxQty]);

    if (!model && !batch && !series) continue;

    var key = [model, batch, series].join("||");
    if (!grouped[key]) {
      grouped[key] = { model: model, batch: batch, series: series, qty: 0 };
    }
    grouped[key].qty += qty;
  }

  var rows = Object.keys(grouped).map(function(key) {
    return grouped[key];
  });

  rows.sort(function(a, b) {
    if (b.qty !== a.qty) return b.qty - a.qty;
    if (a.model !== b.model) return a.model.localeCompare(b.model, undefined, { numeric: true, sensitivity: "base" });
    if (a.batch !== b.batch) return a.batch.localeCompare(b.batch, undefined, { numeric: true, sensitivity: "base" });
    return a.series.localeCompare(b.series, undefined, { numeric: true, sensitivity: "base" });
  });

  var output = [["名次", "產品貨號", "產品批號", "產品系列名稱", "數量"]];
  for (var n = 0; n < rows.length; n++) {
    output.push([n + 1, rows[n].model, rows[n].batch, rows[n].series, rows[n].qty]);
  }

  targetSheet.getRange(1, 1, targetSheet.getMaxRows(), 5).clearContent();
  targetSheet.getRange(1, 1, output.length, 5).setValues(output);

  return {
    success: true,
    message: "已更新庫存數量排行。",
    rows: rows.length
  };
}

// 供網頁前端 (google.script.run) 呼叫以取得帶有真實庫存與單位的促銷商品資料
function getPromotionalProductsForWeb() {
  try {
    var items = getPromotionalProducts();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      // 根據系列取得對應單位
      item.unit = getUnit(item.series);
    }
    return { success: true, items: items };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
