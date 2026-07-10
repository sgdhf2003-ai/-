// ====== 這是修復過空格的專屬 Access Token ======
var CHANNEL_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '';

// ====== 客戶端專用圖文選單 ID ======
var CUSTOMER_RICH_MENU_ID = 'richmenu-652c0daf14cf62fe48e677f227995458';

// ====== Google 雲端硬碟設定 ======
// 請在此填入您的「產品圖檔」與「實景圖」Google 雲端硬碟資料夾 ID
// 注意：資料夾必須在 Google 雲端硬碟中設定共用為「知道連結的任何人均可檢視」
var PRODUCT_IMAGE_FOLDER_ID = '1XO4bbqTDZbY7qX3dz6n_pvhOkjyPUKDi';
var SCENE_IMAGE_FOLDER_ID = '1bR6nPsY1HP7FAHx8vsI8m6eh64L797-D';

// ====== 全域執行快取 (優化多行查詢與即時庫存讀取速度，避免重複讀取試算表) ======
var globalSheetData = null;

function getInventoryValues(ss) {
  if (typeof INVENTORY_ROWS !== "undefined" && INVENTORY_ROWS && INVENTORY_ROWS.length > 0) {
    return INVENTORY_ROWS;
  }
  
  if (globalSheetData) {
    return globalSheetData;
  }
  
  var values = InventoryRepository_readInventoryRows(ss);
  globalSheetData = values;
  return values;
}


// 當 LINE 收到訊息時，會自動觸發這個 doPost 函數
function doPost(e) {
  globalSheetData = null; // 重置全域快取快照，避免跨 Webhook Request 快取髒資料 (Stale Cache)
  var rawContent = "";
  try {
    if (!e || !e.postData || !e.postData.contents) {
      writeLogToSheet("N/A", "N/A", "系統錯誤：沒有 postData 資料（可能是直接以瀏覽器打開網址或以 GET 請求測試）。");
      return HtmlService.createHtmlOutput("Webhook works!");
    }
    
    rawContent = e.postData.contents;
    var postData = JSON.parse(rawContent);
    
    // 1. 處理外部試算表寫入 API 請求 (writeSpreadsheet)
    if (postData && postData.action === 'writeSpreadsheet') {
      var ssId = postData.spreadsheetId;
      var sheetsData = postData.sheetsData;
      var ss = SpreadsheetApp.openById(ssId);
      
      for (var name in sheetsData) {
        var sheet = ss.getSheetByName(name);
        if (!sheet) {
          sheet = ss.insertSheet(name);
        }
        sheet.clear();
        var rows = sheetsData[name];
        if (rows && rows.length > 0) {
          var requiredRows = rows.length;
          var requiredCols = rows[0].length;
          
          var maxRows = sheet.getMaxRows();
          var maxCols = sheet.getMaxColumns();
          
          if (maxRows < requiredRows) {
            sheet.insertRowsAfter(maxRows, requiredRows - maxRows);
          }
          if (maxCols < requiredCols) {
            sheet.insertColumnsAfter(maxCols, requiredCols - maxCols);
          }
          
          sheet.getRange(1, 1, requiredRows, requiredCols).setValues(rows);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 2. 處理 LINE Webhook 訊息
    var events = postData.events;
    
    if (!events || events.length === 0) {
      writeLogToSheet("N/A", rawContent, "系統提示：收到的 events 長度為 0。");
      return HtmlService.createHtmlOutput("Webhook works!");
    }
    
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      if (event.type === 'postback') {
        try {
          var postbackHandled = handleAssistantPostback_(event);
          if (postbackHandled) continue;
        } catch (postbackErr) {
          writeLogToSheet("Postback Error", postbackErr.toString(), "系統錯誤", rawContent);
        }
      }
      
      // 歡迎詞/說明與幫助內容
      var welcomeText = "您好！歡迎使用勁揚建材庫存查詢系統 🌸\n\n" +
                        "💡 **查詢指令說明**：\n\n" +
                        "1. 📦 **查詢庫存**：\n" +
                        "   * 輸入「型號」或「型號 + 數量」\n" +
                        "   * 範例：`PP-3508` 或 `PP-3508 10箱` / `PP-3508 300片`\n" +
                        "   * 系統會以燈號 🟢 (有庫存) / 🔴 (無庫存) 顯示狀態與詳細資訊。\n\n" +
                        "2. 🎨 **查詢批號**：\n" +
                        "   * 直接輸入「批號」也可以直接查詢該批次商品喔！\n" +
                        "   * 範例：`7X24` 或 `7A24`\n\n" +
                        "3. 🔗 **查詢圖檔連結**：\n" +
                        "   * 輸入「型號 + 單片/磚」或「型號 + 實景」\n" +
                        "   * 範例：`PP-3508` 單片/磚 或 `PP-3508` 實景\n" +
                        "   * 系統會回傳對應的圖檔連結按鈕卡片，點擊即可直接瀏覽。\n\n" +
                        "4. ℹ️ **幫助說明**：\n" +
                        "   * 輸入「說明」、「幫助」或「help」即可隨時再次發送此使用說明。\n\n" +
                        "🌸 **貼心提示**：不論查詢什麼內容，我們在每則訊息下方都會附上特惠「促銷商品」按鈕喔！客倌隨時點選就能挖寶，便宜撿不完～🛒✨";

      // 偵測加入好友事件 (Follow Event)
      if (event.type == 'follow') {
        var replyToken = event.replyToken;
        try {
          replyToLine(replyToken, welcomeText, false);
          writeLogToSheet("加入好友事件", welcomeText, "成功回覆歡迎詞", rawContent);
          
          // 新好友自動綁定圖文選單
          var senderUserId = (event.source && event.source.userId) ? event.source.userId : "N/A";
          var clerkUserId = PropertiesService.getScriptProperties().getProperty('CLERK_USER_ID');
          if (senderUserId && senderUserId !== "N/A" && senderUserId !== clerkUserId) {
            linkRichMenuToUser(senderUserId);
          }
        } catch (err) {
          writeLogToSheet("加入好友事件", welcomeText, "回覆歡迎詞失敗：" + err.toString(), rawContent);
        }
        continue;
      }
      
      // 攔截小姐的確認訊息（文字「好/收到/OK」或貼圖/圖片）
      var senderUserId = (event.source && event.source.userId) ? event.source.userId : "N/A";
      var clerkUserId = PropertiesService.getScriptProperties().getProperty('CLERK_USER_ID');
      var isFromClerk = (clerkUserId && senderUserId === clerkUserId);

      // 自動為顧客綁定圖文選單（排除小姐，快取 6 小時避免重複呼叫 API）
      if (senderUserId && senderUserId !== "N/A" && !isFromClerk) {
        var cache = CacheService.getScriptCache();
        var cacheKey = "rm_linked_" + senderUserId;
        if (!cache.get(cacheKey)) {
          try {
            linkRichMenuToUser(senderUserId);
            cache.put(cacheKey, "1", 21600); // 快取 6 小時
          } catch (rmErr) {
            Logger.log("自動綁定圖文選單失敗: " + rmErr.toString());
          }
        }
      }
      if (isFromClerk && event.type === 'message') {
        var shouldAck = false;
        if (event.message.type === 'text') {
          var clerkMsg = event.message.text.trim().toLowerCase();
          if (clerkMsg === "好" || clerkMsg === "收到" || clerkMsg === "ok" || clerkMsg === "okay" || clerkMsg === "ok!" || clerkMsg === "🆗" || clerkMsg === "👍" || clerkMsg === "👌" || clerkMsg === "okk" || clerkMsg === "好的") {
            shouldAck = true;
          }
        } else if (event.message.type === 'sticker' || event.message.type === 'image') {
          shouldAck = true;
        }
        
        if (shouldAck) {
          try {
            replyToLine(event.replyToken, "👍", true);
            // 將所有未發送的假日警示排程標記為已確認，取消週一重複通知
            markWeekendAlertsAsProcessed();
            
            // 標記所有活躍顧客為已確認，停止後續警訊
            var cache = CacheService.getScriptCache();
            var activeListStr = cache.get("active_alert_customers") || "";
            if (activeListStr) {
              var list = activeListStr.split(",");
              for (var j = 0; j < list.length; j++) {
                var cid = list[j];
                if (cid) {
                  cache.put("clerk_acknowledged_" + cid, "true", 7200); // 2 小時免打擾
                }
              }
              cache.remove("active_alert_customers");
            }
            clearPendingPromoReserveRequests();
            
            writeLogToSheet("小姐確認回覆", "👍", "小姐已確認警示（已取消週一排程與設定免打擾）", rawContent);
          } catch (err) {
            writeLogToSheet("小姐確認回覆失敗", err.toString(), "錯誤", rawContent);
          }
          continue; // 結束該 event 的處理，不往下走一般文字查詢
        }
      }
      
      // 確認是文字訊息
      if (event.type == 'message' && event.message.type == 'text') {
        var userMessage = event.message.text.trim();
        var replyToken = event.replyToken;
        
        var lineUserId = event.source && event.source.userId ? event.source.userId : "";
        var activeDialogState = checkActiveDialogState_(lineUserId, userMessage, replyToken);
        if (activeDialogState) {
          continue;
        }
        
        // 紀錄活躍會話 (排除小姐)
        if (!isFromClerk && senderUserId !== "N/A") {
          recordSessionUser(senderUserId);
        }

        // 雙模式 Intent Router：內部明確指令在庫存 fallback 前處理；
        // inventory intent 會回傳 false，保留原有庫存、促銷與預留流程。
        const routed = typeof LineIntent_tryHandleTextEvent === "function" ? LineIntent_tryHandleTextEvent(event) : null;
        if (routed && (routed.handled === true || routed === true)) {
          continue;
        }

        // 勁揚業務管家外掛入口：只處理明確指令，避免干擾原本庫存機器人流程。
        if (typeof JingyangAssistant_tryHandleLineEvent === "function" && JingyangAssistant_tryHandleLineEvent(event)) {
          continue;
        }
        
        // 1. 攔截一般顧客的「確認聯絡小姐」回覆 (如：好、要、需要、是、是的、確定等，或包含預留/保留字眼)
        var confirmRegex = /^(要|需要|是|是的|好|好的|確定|請幫我確認|請小姐確認|確認|麻煩小姐|麻煩確認|預留|保留)$/i;
        var hasReserveKeyword = (userMessage.indexOf("預留") !== -1 || userMessage.indexOf("保留") !== -1);
        
        if ((confirmRegex.test(userMessage) || hasReserveKeyword) && !isFromClerk) {
          var lastWarnModel = CacheService.getScriptCache().get("last_warn_" + senderUserId);
          if (lastWarnModel) {
            try {
              var customerName = getUserDisplayName(senderUserId);
              var alertText = "🔔 顧客要求聯絡確認！\n" +
                              "━━━━━━━━━━━━━━━━━━━━\n" +
                              "👤 顧客名稱：" + customerName + "\n" +
                              "🌸 商品型號：" + lastWarnModel + "\n" +
                              "💬 回覆內容：" + userMessage + "\n\n" +
                              "💡 提示：顧客已確認需要您幫忙確認庫存並預留，請儘速與顧客聯繫！";
              
              // 檢查小姐是否已確認，以及防重複發送
              var modelCode = getGlobalModelCodeKey(lastWarnModel);
              var cacheKey = "clerk_alert_count_" + modelCode + "_" + senderUserId;
              var alertCount = parseInt(CacheService.getScriptCache().get(cacheKey) || "0");
              var acked = CacheService.getScriptCache().get("clerk_acknowledged_" + senderUserId);
              
              if (clerkUserId && alertCount < 2 && acked !== "true") {
                pushMessageToUser(clerkUserId, alertText);
                CacheService.getScriptCache().put(cacheKey, (alertCount + 1).toString(), 7200);
                recordActiveAlertCustomer(senderUserId);
              } else {
                Logger.log("Prevented contact request alert to clerk due to limit or ack: " + modelCode);
              }
              
              var clientReply = "好的！已為您通知服務小姐。小姐將會進一步幫您確認庫存「" + lastWarnModel + "」並與您聯絡，請稍候喔！";
              replyToLine(replyToken, clientReply, isFromClerk);
              writeLogToSheet(userMessage, clientReply, "顧客確認通知小姐成功", rawContent);
              
              CacheService.getScriptCache().remove("last_warn_" + senderUserId);
            } catch (err) {
              writeLogToSheet(userMessage, "通知小姐確認失敗: " + err.toString(), "錯誤", rawContent);
            }
            continue; // 結束該 event 的處理，不往下走一般文字查詢
          } else if (hasReserveKeyword) {
            // 如果快取已過期或沒有型號快取，但字面包含「預留/保留」，依然通知小姐，絕不報錯
            try {
              var customerName = getUserDisplayName(senderUserId);
              var alertText = "🔔 顧客傳送預留需求！\n" +
                              "━━━━━━━━━━━━━━━━━━━━\n" +
                              "👤 顧客名稱：" + customerName + "\n" +
                              "💬 訊息內容：" + userMessage + "\n\n" +
                              "💡 提示：顧客發送了預留/保留相關訊息，請與顧客聯繫確認！";
              
              // 使用特殊的 key 限制無型號預留的通知次數，並檢查小姐是否已確認
              var cacheKey = "clerk_alert_count_general_reserve_" + senderUserId;
              var alertCount = parseInt(CacheService.getScriptCache().get(cacheKey) || "0");
              var acked = CacheService.getScriptCache().get("clerk_acknowledged_" + senderUserId);
              
              if (clerkUserId && alertCount < 2 && acked !== "true") {
                pushMessageToUser(clerkUserId, alertText);
                CacheService.getScriptCache().put(cacheKey, (alertCount + 1).toString(), 7200);
                recordActiveAlertCustomer(senderUserId);
              } else {
                Logger.log("Prevented general reserve alert to clerk due to limit or ack.");
              }
              
              var clientReply = "好的！已為您轉告服務小姐。小姐將會進一步與您聯絡，請稍候喔！";
              replyToLine(replyToken, clientReply, isFromClerk);
              writeLogToSheet(userMessage, clientReply, "顧客無快取預留通知小姐成功", rawContent);
            } catch (err) {
              writeLogToSheet(userMessage, "無快取通知小姐預留失敗: " + err.toString(), "錯誤", rawContent);
            }
            continue; // 結束該 event，不往下走一般庫存查詢
          }
        }
        
        // 偵測是否為週末 (星期六=6, 星期日=7)
        var dayStr = Utilities.formatDate(new Date(), "GMT+8", "u");
        var isWeekend = (dayStr === "6" || dayStr === "7");
        var weekendNoticeObj = { 
          "type": "text", 
          "text": "☀️ 【假日公告】您好，由於目前是休息日，服務人員無法第一時間為您處理及保留庫存喔！但您仍可先使用系統自動查詢，查詢結果如下：" 
        };
        
        // 綁定小姐通知管道的特殊指令
        if (userMessage === "###我是小姐###" || userMessage === "###綁定小姐###" || userMessage === "###綁定通知###") {
          try {
            PropertiesService.getScriptProperties().setProperty('CLERK_USER_ID', senderUserId);
            // 自動註冊週一排程與閒置檢查排程
            setupMondayTrigger();
            setupIdleCheckTrigger();
            var replyText = "恭喜您！已成功綁定為庫存警示通知管道，已自動為您註冊「每週一早上庫存警示排程」與「顧客閒置關懷追蹤排程」！\n您的 LINE User ID 為：\n" + senderUserId;
            replyToLine(replyToken, replyText, true);
            writeLogToSheet(userMessage, replyText, "綁定通知成功", rawContent);
          } catch (err) {
            writeLogToSheet(userMessage, "綁定失敗: " + err.toString(), "綁定失敗", rawContent);
          }
          continue;
        }
        
        var lowerMsg = userMessage.toLowerCase();
        if (lowerMsg === "說明" || lowerMsg === "幫助" || lowerMsg === "帮助" || lowerMsg === "說明" || lowerMsg === "help" || lowerMsg === "instructions" || lowerMsg === "instruction" || lowerMsg === "歡迎" || lowerMsg === "欢迎") {
          try {
            replyToLine(replyToken, welcomeText, isFromClerk);
            writeLogToSheet(userMessage, welcomeText, "成功回覆說明訊息", rawContent);
          } catch (err) {
            writeLogToSheet(userMessage, welcomeText, "回覆說明訊息失敗：" + err.toString(), rawContent);
          }
          continue;
        }
        
        // 攔截促銷商品查詢指令（支援系列展開，例如：查看促銷 星月六角 或直接打 星月六角）
        var isPromoQuery = false;
        var promoQueryTarget = "";
        
        var promoKeywordMatch = userMessage.match(/^(查看促銷商品|查看促銷|促銷商品|促銷)\s*(.*)$/i);
        if (promoKeywordMatch) {
          isPromoQuery = true;
          promoQueryTarget = promoKeywordMatch[2].trim();
        } else if (!isLikelyModelQuery(userMessage)) {
          // 如果沒有促銷前綴，但直接輸入了已知的促銷系列名稱，也可以直接觸發該系列的促銷商品展開
          try {
            var allPromoProducts = getPromotionalProducts();
            var uniqueSeriesList = [];
            for (var i = 0; i < allPromoProducts.length; i++) {
              var sName = allPromoProducts[i].series;
              if (sName && uniqueSeriesList.indexOf(sName) === -1) {
                uniqueSeriesList.push(sName);
              }
            }
            
            var normMsg = normalizeSearchKey(userMessage);
            for (var i = 0; i < uniqueSeriesList.length; i++) {
              if (normalizeSearchKey(uniqueSeriesList[i]) === normMsg && normMsg !== "") {
                isPromoQuery = true;
                promoQueryTarget = uniqueSeriesList[i];
                break;
              }
            }
          } catch (e) {
            Logger.log("檢查促銷系列列表失敗：" + e.toString());
          }
        }
        
        if (isPromoQuery) {
          try {
            var promoReply = searchPromotionalProducts(promoQueryTarget, senderUserId);
            replyToLine(replyToken, promoReply, true); // 促銷清單本身不顯示促銷按鈕，防止無限循環
            writeLogToSheet(userMessage, JSON.stringify(promoReply), "成功回覆促銷商品清單 (" + (promoQueryTarget || "目錄") + ")", rawContent);
          } catch (err) {
            writeLogToSheet(userMessage, "回覆促銷商品清單失敗: " + err.toString(), "錯誤", rawContent);
          }
          continue;
        }
        
        // 特殊除錯指令：在 LINE 直接查詢並顯示雲端硬碟資料夾 ID
        if (userMessage === "###列出資料夾###") {
          var replyText = "";
          try {
            var folders = DriveApp.getFolders();
            var candidates = [];
            while (folders.hasNext()) {
              var folder = folders.next();
              var name = folder.getName();
              if (name.indexOf("圖") !== -1 || name.indexOf("產品") !== -1 || name.indexOf("實景") !== -1 || name.indexOf("照片") !== -1 || name.indexOf("庫存") !== -1) {
                candidates.push("資料夾: " + name + "\nID: " + folder.getId());
              }
            }
            replyText = "=== 您的 Google Drive 資料夾 ===\n" + (candidates.length > 0 ? candidates.join("\n\n") : "未找到包含關鍵字的資料夾");
          } catch (driveErr) {
            replyText = "讀取雲端硬碟失敗，請確認是否已在 Apps Script 網頁版執行 forceAuthorize 進行授權。\n錯誤：" + driveErr.toString();
          }
          
          try {
            replyToLine(replyToken, replyText, true);
            writeLogToSheet(userMessage, replyText, "成功回覆資料夾ID", rawContent);
          } catch (err) {
            writeLogToSheet(userMessage, replyText, "回覆資料夾ID失敗：" + err.toString(), rawContent);
          }
          continue; // 結束本次 loop，不往下執行庫存搜尋
        }
        var lines = userMessage.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l !== ""; });
        
        if (lines.length <= 1) {
          var replyText = "";
          var queryCount = 0;
          try {
            if (senderUserId !== "N/A") {
              queryCount = updateExactQueryTracker(senderUserId, userMessage);
            }
            replyText = searchInventory(userMessage, senderUserId);
          } catch (err) {
            replyText = "搜尋庫存時發生錯誤：" + err.toString();
          }
          
          // 如果連續問了 3 次相同的內容，主動詢問是否由小姐對接
          if (queryCount === 3 && senderUserId !== "N/A") {
            var core = userMessage.split(/\s+/)[0].trim();
            // 寫入快取，讓顧客回覆「是」或「需要」時能直接對接到此型號
            CacheService.getScriptCache().put("last_warn_" + senderUserId, core, 1800);
            
            var offerText = "\n\n💡 哩厚 🌸 偵測到您已經連續查詢 3 次相同的「" + userMessage + "」囉！是不是在跟小幫手玩躲貓貓呢？🤪\n如果真的有需要，不要跟機器人捉迷藏啦！請問是否要幫您聯絡服務小姐，由小姐親自與您對接確認呢？💬\n(若需要，請直接回覆「是」或「需要」)";
            
            if (typeof replyText === 'string') {
              replyText = replyText + offerText;
            } else if (replyText && typeof replyText === 'object') {
              if (replyText.type === 'text') {
                replyText.text = replyText.text + offerText;
              } else if (Array.isArray(replyText)) {
                var lastMsg = replyText[replyText.length - 1];
                if (lastMsg && lastMsg.type === 'text') {
                  lastMsg.text = lastMsg.text + offerText;
                } else {
                  replyText.push({ "type": "text", "text": offerText.trim() });
                }
              } else {
                replyText = [replyText, { "type": "text", "text": offerText.trim() }];
              }
            }
            // 重設計數器，防止後續每次查詢都跳出提示
            CacheService.getScriptCache().put("exact_query_count_" + senderUserId, "0", 1800);
          }
          
          // 回覆 LINE
          try {
            var finalReply = replyText;
            if (isWeekend) {
              if (typeof replyText === 'string') {
                finalReply = [weekendNoticeObj, { "type": "text", "text": replyText }];
              } else if (Array.isArray(replyText)) {
                finalReply = [weekendNoticeObj].concat(replyText);
              } else {
                finalReply = [weekendNoticeObj, replyText];
              }
            }
            replyToLine(replyToken, finalReply, isFromClerk);
            var logText = typeof replyText === 'string' ? replyText : JSON.stringify(replyText);
            writeLogToSheet(userMessage, logText, "成功回覆 LINE", rawContent);
          } catch (err) {
            var logTextErr = typeof replyText === 'string' ? replyText : JSON.stringify(replyText);
            writeLogToSheet(userMessage, logTextErr, "回覆 LINE 失敗：" + err.toString(), rawContent);
          }
        } else {
          // 複數查詢邏輯
          var rawMessages = [];
          for (var idx = 0; idx < lines.length; idx++) {
            var line = lines[idx];
            try {
              var result = searchInventory(line, senderUserId);
              if (typeof result === 'string') {
                rawMessages.push({ "type": "text", "text": result });
              } else if (Array.isArray(result)) {
                rawMessages = rawMessages.concat(result);
              } else if (result && typeof result === 'object') {
                rawMessages.push(result);
              }
            } catch (err) {
              rawMessages.push({ "type": "text", "text": "搜尋「" + line + "」時發生錯誤：" + err.toString() });
            }
          }
          
          // 合併連續的文字訊息
          var combinedMessages = [];
          for (var idx = 0; idx < rawMessages.length; idx++) {
            var msg = rawMessages[idx];
            if (msg.type === "text") {
              if (combinedMessages.length > 0 && combinedMessages[combinedMessages.length - 1].type === "text") {
                combinedMessages[combinedMessages.length - 1].text += "\n\n====================\n\n" + msg.text;
              } else {
                combinedMessages.push({ "type": "text", "text": msg.text });
              }
            } else {
              combinedMessages.push(msg);
            }
          }
          
          // 處理 LINE 訊息上限限制 (最多 5 個區塊)
          // 假日多一個公告，且促銷按鈕佔 1 個，所以庫存查詢上限對應減少以預留按鈕欄位
          var maxBlocks = isWeekend ? 3 : 4;
          if (combinedMessages.length > maxBlocks) {
            combinedMessages = combinedMessages.slice(0, maxBlocks - 1);
            combinedMessages.push({
              "type": "text",
              "text": "⚠️ 系統提示：一次最多僅能回傳 5 個訊息區塊，其餘查詢結果已被省略。建議分批查詢以取得完整資訊。"
            });
          }
          
          // 回覆 LINE
          try {
            var finalReply = combinedMessages;
            if (isWeekend) {
              finalReply = [weekendNoticeObj].concat(combinedMessages);
            }
            replyToLine(replyToken, finalReply, isFromClerk);
            writeLogToSheet(userMessage, JSON.stringify(combinedMessages), "成功複數回覆 LINE", rawContent);
          } catch (err) {
            writeLogToSheet(userMessage, JSON.stringify(combinedMessages), "複數回覆 LINE 失敗：" + err.toString(), rawContent);
          }
        }
      } else {
        writeLogToSheet("非文字訊息", "類型: " + event.type, "不予處理", rawContent);
      }
    }
  } catch (globalErr) {
    writeLogToSheet("未分類錯誤", "N/A", "全域錯誤：" + globalErr.toString(), rawContent);
  }
}

// 查詢庫存的邏輯
// 查詢庫存的邏輯
function searchInventory(itemName, senderUserId) {
  senderUserId = senderUserId || "N/A";
  var ssId = "1C_R1DdTj5brxftl9fPabTKBGzcG-lxWWxWoyi-ItA48"; // 試算表 ID
  var ss;
  try {
    ss = SpreadsheetApp.openById(ssId);
  } catch (e) {
    return "系統提示：無法開啟試算表，請確認試算表 ID 是否正確或權限是否已開啟。";
  }
  
  var data = getInventoryValues(ss);
  if (!data) {
    return "系統提示：找不到名為「庫存查詢表」的分頁，請確認試算表下方的名稱是否正確喔！";
  }
  if (data.length <= 1) {
    return "系統提示：目前庫存查詢表中沒有資料喔！";
  }
  
  // === 0. 檢查是否是型號圖片查詢 (例如 "EQ-1722 單片", "EQ-1722 實景", "EQ-1722 單片 實景") ===
  var msgClean = itemName.trim();
  
  // 偵測系列字尾並切除（例如將「波波里花園系列」切除為「波波里花園」進行比對，提升智慧度）
  var isSeriesSuffixTyped = false;
  var searchItem = msgClean;
  var seriesSuffixMatch = searchItem.match(/\s*系列\s*$/);
  if (seriesSuffixMatch) {
    isSeriesSuffixTyped = true;
    searchItem = searchItem.replace(/\s*系列\s*$/, "").trim();
  }
  
  var isImageSearch = false;
  var isSingleSearch = false;
  var isSceneSearch = false;
  
  var imageMatch = msgClean.match(/\s*([+\/／或和與、]*\s*(單片|單磚|產品圖|圖片|圖檔|實景|場景|實照|實拍|實景圖|實景照|照片|相片|圖|图|照|单片|单砖|产品图|图片|图档|实景|场景|实照|实拍|实景图|实景照))+$/i);
  if (imageMatch) {
    isImageSearch = true;
    var matchedText = imageMatch[0];
    if (matchedText.match(/(單片|單磚|產品圖|圖片|圖檔|单片|单砖|产品图|图片|图档)/)) {
      isSingleSearch = true;
    }
    if (matchedText.match(/(實景|場景|實照|實拍|實景圖|實景照|实景|场景|实照|实拍|实景图|实景照)/)) {
      isSceneSearch = true;
    }
    // 如果是通用相片/照片詞彙且兩者都沒有被觸發，則預設兩者都開啟
    if (matchedText.match(/(照片|相片|照|圖|图)/) && !isSingleSearch && !isSceneSearch) {
      isSingleSearch = true;
      isSceneSearch = true;
    }
    searchItem = msgClean.substring(0, imageMatch.index).trim();
  }
  
  // === 1. 解析查詢需求（例如：IB2312 50、IB2312 10箱） ===
  var reqQty = null;
  var reqUnit = "";
  
  if (!isImageSearch) {
    // 1) 先檢查是否有「空格 + 數字 + 可選單位」 (例如: "EQ-1722 500", "AP-6001 10箱")
    var qtySpaceMatch = searchItem.match(/\s+(\d+(?:\.\d+)?)\s*(片|包|箱|件|坪)?$/);
    var parsedQtyFromSpace = false;
    if (qtySpaceMatch) {
      var rawUnit = qtySpaceMatch[2] ? qtySpaceMatch[2].trim() : "";
      var remaining = searchItem.substring(0, qtySpaceMatch.index).trim();
      
      // 💡 如果沒有指定單位，且剩餘的型號部分不包含任何數字，則不應將該數字視為數量（它很可能是型號的一部分，例如 "EQ 1721"）
      if (rawUnit === "" && !/\d/.test(remaining)) {
        // 不視為數量，忽略此比對
      } else {
        reqQty = parseFloat(qtySpaceMatch[1]);
        if (rawUnit === "箱" || rawUnit === "件") {
          reqUnit = "箱";
        } else if (rawUnit === "坪") {
          reqUnit = "坪";
        } else if (rawUnit === "包") {
          reqUnit = "包";
        } else {
          reqUnit = "片"; // 預設用「片數」代替
        }
        searchItem = remaining;
        parsedQtyFromSpace = true;
      }
    }
    
    if (!parsedQtyFromSpace) {
      // 2) 再檢查是否有緊鄰的「數字 + 強制單位」 (例如: "EQ-1722500片", "AP-600110箱")
      var qtyUnitMatch = searchItem.match(/(\d+(?:\.\d+)?)\s*(片|包|箱|件|坪)$/);
      if (qtyUnitMatch) {
        reqQty = parseFloat(qtyUnitMatch[1]);
        var rawUnit = qtyUnitMatch[2];
        if (rawUnit === "箱" || rawUnit === "件") {
          reqUnit = "箱";
        } else {
          reqUnit = rawUnit;
        }
        searchItem = searchItem.substring(0, qtyUnitMatch.index).trim();
      }
    }
  }
  
  var headers = data[0];
  var idxModel = -1;
  var idxSeries = -1;
  var idxOrigin = -1;
  var idxSize = -1;
  var idxBatch = -1;
  var idxReserved = -1;
  var idxStock = -1;
  var idxAvailable = -1;
  var idxName = -1;
  var idxNote = -1;
  var idxProductImgFolder = -1;
  var idxSceneImgFolder = -1;
  var idxWeight = -1;
  var idxPacking = -1; // 箱/入
  var idxNumJ = -1; // 坪/片
  
  // 動態尋找欄位索引，保持與網頁後端一致
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] == null) continue;
    var h = headers[i].toString().replace(/\s+/g, '');
    if (h.indexOf("編號") !== -1 || h.indexOf("型號") !== -1) idxModel = i;
    if (h.indexOf("品名") !== -1) {
      idxName = i;
      if (idxModel === -1) idxModel = i;
    }
    if (h.indexOf("系列") !== -1) idxSeries = i;
    if (h.indexOf("產地") !== -1) idxOrigin = i;
    if (h === "規格尺寸" || h.indexOf("規格尺寸") !== -1) idxSize = i;
    else if (idxSize === -1 && h.indexOf("尺寸") !== -1) idxSize = i;
    if (h.indexOf("批號") !== -1) idxBatch = i;
    if (h.indexOf("可用庫存") !== -1 || h.indexOf("可用") !== -1) idxAvailable = i;
    else if (h.indexOf("庫存") !== -1) idxStock = i;
    if (h.indexOf("保留") !== -1) idxReserved = i;
    if (h.indexOf("備註") !== -1 || h.indexOf("說明") !== -1) idxNote = i;
    if (h.indexOf("單片圖檔") !== -1 || h.indexOf("產品圖檔") !== -1) idxProductImgFolder = i;
    if (h.indexOf("單片實景") !== -1 || h.indexOf("實景圖檔") !== -1 || h.indexOf("實景圖") !== -1) idxSceneImgFolder = i;
    if (h.indexOf("重量") !== -1) idxWeight = i;
    if (h.indexOf("箱/入") !== -1 || h.indexOf("包裝") !== -1) idxPacking = i;
    if (h.indexOf("坪/片") !== -1 || h.indexOf("換算") !== -1 || h.indexOf("用量") !== -1) idxNumJ = i;
  }
  
  if (idxProductImgFolder === -1) idxProductImgFolder = 15;
  if (idxSceneImgFolder === -1) idxSceneImgFolder = 16;
  
  if (idxModel === -1) {
    return "系統提示：在試算表中找不到「品項編號/型號」欄位，請檢查標題名稱。";
  }
  
  // === 2. 搜尋符合的項目（標準化比對，忽略大小寫、空白與常見符號） ===
  searchItem = InventorySearch_cleanDisplayQuery(searchItem);
  var searchKey = InventorySearch_normalizeQuery(searchItem);
  
  // === 1.5 檢查是否為系列名稱查詢 ===
  if (idxSeries !== -1) {
    var seriesMap = {};
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (!row || row.length === 0) continue;
      var seriesVal = row[idxSeries] ? row[idxSeries].toString().trim() : "";
      if (seriesVal !== "") {
        var normSeries = normalizeSearchKey(seriesVal);
        if (normSeries !== "") {
          if (!seriesMap[normSeries]) {
            seriesMap[normSeries] = [];
          }
          var modelVal = row[idxModel] ? row[idxModel].toString().trim() : "";
          if (modelVal !== "" && seriesMap[normSeries].indexOf(modelVal) === -1) {
            seriesMap[normSeries].push(modelVal);
          }
        }
      }
    }
    
    // 比對系列名稱
    var matchedSeriesKey = "";
    var seriesKeys = Object.keys(seriesMap);
    for (var k = 0; k < seriesKeys.length; k++) {
      if (seriesKeys[k] === searchKey) {
        matchedSeriesKey = seriesKeys[k];
        break;
      }
    }
    
    if (matchedSeriesKey === "" && searchKey.length >= 2) {
      for (var k = 0; k < seriesKeys.length; k++) {
        if (seriesKeys[k].indexOf(searchKey) !== -1) {
          matchedSeriesKey = seriesKeys[k];
          break;
        }
      }
    }
    
    if (matchedSeriesKey !== "") {
      var modelsList = seriesMap[matchedSeriesKey];
      var originalSeriesName = "";
      for (var r = 1; r < data.length; r++) {
        var row = data[r];
        if (!row || row.length === 0) continue;
        var seriesVal = row[idxSeries] ? row[idxSeries].toString().trim() : "";
        if (normalizeSearchKey(seriesVal) === matchedSeriesKey) {
          originalSeriesName = seriesVal;
          break;
        }
      }
      
      var seriesReply = "🔍 「" + originalSeriesName + "」系列編號列表如下：\n\n";
      for (var m = 0; m < modelsList.length; m++) {
        seriesReply += "- " + modelsList[m] + "\n";
      }
      seriesReply += "\n💡 您可輸入上方任一編號來查詢庫存或圖片喔！";
      return { "type": "text", "text": seriesReply.trim() };
    }
  }
  var matches = InventorySearch_rankAndLimitRows(data.slice(1), searchItem, {
    idxModel: idxModel,
    idxName: idxName,
    idxStock: idxStock,
    idxAvailable: idxAvailable,
    idxReserved: idxReserved,
    limit: 0
  });
  
  var isBatchSearchMatched = false;
  if (matches.length === 0 && idxBatch !== -1 && searchKey !== "") {
    // 1) 先嘗試「批號精準匹配」
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (!row || row.length === 0) continue;
      var batchVal = row[idxBatch] ? row[idxBatch].toString().trim() : "";
      if (batchVal !== "" && normalizeSearchKey(batchVal) === searchKey) {
        matches.push(row);
        isBatchSearchMatched = true;
      }
    }
    // 2) 如果精準比對沒有找到，且輸入的關鍵字大於等於 2 個字，則嘗試「批號部分模糊符合」
    if (matches.length === 0 && searchKey.length >= 2) {
      for (var r = 1; r < data.length; r++) {
        var row = data[r];
        if (!row || row.length === 0) continue;
        var batchVal = row[idxBatch] ? row[idxBatch].toString().trim() : "";
        if (batchVal !== "" && normalizeSearchKey(batchVal).indexOf(searchKey) !== -1) {
          matches.push(row);
          isBatchSearchMatched = true;
        }
      }
    }
  }
  
  if (matches.length === 0) {
    var guardReply = checkIntelligenceGuard(itemName, senderUserId);
    if (guardReply) {
      return { "type": "text", "text": guardReply };
    }
    
    // 💡 模糊型號候選比對 (海納百川容錯，對年長顧客極其友善)
    var fuzzyCandidates = findFuzzyModelCandidates(searchItem, data, idxModel);
    if (fuzzyCandidates.length > 0) {
      var listReply = "客倌您好 🌸 系統沒有找到完全符合「" + searchItem + "」的商品，不過小幫手為您猜測，您是不是想找以下商品呢？\n\n";
      var actions = [];
      var limit = Math.min(fuzzyCandidates.length, 4);
      
      for (var g = 0; g < fuzzyCandidates.length; g++) {
        var cand = fuzzyCandidates[g];
        var modelName = cand.model;
        var series = idxSeries !== -1 && cand.row[idxSeries] ? cand.row[idxSeries].toString().trim() : "未標示";
        var size = idxSize !== -1 && cand.row[idxSize] ? cand.row[idxSize].toString().trim() : "未標示";
        
        // 統計該型號的所有批號庫存
        var totalStock = 0;
        var unit = getUnit(series);
        for (var r = 1; r < data.length; r++) {
          var row = data[r];
          if (!row || row.length === 0) continue;
          if (getModelCodeKey(row[idxModel]) === cand.code) {
            totalStock += getAvailableStock_(row, idxStock, idxAvailable, idxReserved);
          }
        }
        
        listReply += "🌸 商品編號：" + modelName + "\n";
        listReply += "🎀 產品系列：" + series + "\n";
        listReply += "📏 規格尺寸：" + size + "\n";
        listReply += "📦 總庫存量：" + (totalStock > 0 ? (totalStock + " " + unit + " ✅") : "0 " + unit + " ❌") + "\n";
        listReply += "────────────────\n";
        
        if (g < limit) {
          var btnLabel = "👉 " + cand.code;
          if (btnLabel.length > 20) {
            btnLabel = btnLabel.substring(0, 17) + "...";
          }
          actions.push({
            "type": "message",
            "label": btnLabel,
            "text": cand.code
          });
        }
      }
      
      listReply = listReply.replace(/────────────────\n$/, "").trim();
      
      // 建構 LINE 模板按鈕
      var template = {
        "type": "template",
        "altText": "確認您要的商品",
        "template": {
          "type": "buttons",
          "text": "請問這是您要找的商品嗎？請點擊按鈕確認：",
          "actions": actions
        }
      };
      
      return [
        { "type": "text", "text": listReply },
        template
      ];
    }
    
    // 若不是合理的型號格式，判定為非庫存類留言，給予溫暖客服回覆
    if (!isLikelyModelQuery(searchItem)) {
      return "您好 🌸 我是您的 AI 客服專員。目前我無法從系統中找到與「" + searchItem + "」相關的商品、型號或批號喔！\n\n" +
             "💡 建議您直接輸入商品「型號」（例如：EQ-1721）或「批號」（例如：7X24）來幫您快速查詢。\n" +
             "💡 也可以試試較短型號、移除多餘空白，或改用商品名稱關鍵字。\n" +
             "💡 另外，我們在每則回覆下方都有為您準備好康的「促銷商品」連結按鈕，客倌隨時能點擊進去逛逛喔！🥰\n\n" +
             "如果有其他特殊需求或要聯絡小姐，可以直接回覆「是」或「需要」，我會立刻請服務小姐聯繫您！";
    }
    
    return "您好！目前系統中查不到型號或批號「" + searchItem + "」的庫存資料，請確認輸入是否正確。也可以試試較短型號、移除多餘空白，或改用商品名稱關鍵字。下面有為您附上特惠促銷商品連結，客倌也可以去逛逛挑選好康喔！🌸🛒";
  }
  
  // === 3. 依據型號進行分組與判斷 ===
  // 提取型號代碼來判斷是否為同一商品 (已移至全域以供促銷與庫存查詢共用)
  
  var groups = {};
  for (var i = 0; i < matches.length; i++) {
    var key = getModelCodeKey(matches[i][idxModel]);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(matches[i]);
  }
  
  var groupKeys = Object.keys(groups);
  
  // 3.1) 如果搜尋結果包含多個不同型號商品 -> 回傳型號清單供選擇
  if (groupKeys.length > 1) {
    if (isBatchSearchMatched) {
      var listReply = "🔍 您查詢的批號「" + searchItem + "」符合多個商品編號：\n\n";
      var actions = [];
      var limit = Math.min(groupKeys.length, 4);
      
      for (var g = 0; g < groupKeys.length; g++) {
        var groupedRows = groups[groupKeys[g]];
        var firstRow = groupedRows[0];
        var modelName = firstRow[idxModel] ? firstRow[idxModel].toString().trim() : "未標示";
        var series = idxSeries !== -1 && firstRow[idxSeries] ? firstRow[idxSeries].toString().trim() : "未標示";
        var size = idxSize !== -1 && firstRow[idxSize] ? firstRow[idxSize].toString().trim() : "未標示";
        var unit = getUnit(series);
        
        var batchStock = 0;
        for (var r = 0; r < groupedRows.length; r++) {
          batchStock += parseRobust(groupedRows[r][11]);
        }
        
        listReply += "🌸 商品編號：" + modelName + "\n";
        listReply += "🎀 產品系列：" + series + "\n";
        listReply += "📏 規格尺寸：" + size + "\n";
        listReply += "🎨 批號庫存：" + (batchStock > 0 ? (batchStock + " " + unit + " ✅") : "0 " + unit + " ❌") + "\n";
        listReply += "────────────────\n";
        
        if (g < limit) {
          var btnLabel = "👉 " + modelName;
          if (btnLabel.length > 20) {
            btnLabel = btnLabel.substring(0, 17) + "...";
          }
          actions.push({
            "type": "message",
            "label": btnLabel,
            "text": modelName
          });
        }
      }
      
      listReply = listReply.replace(/────────────────\n$/, "").trim();
      
      // 建構 LINE 模板按鈕
      var template = {
        "type": "template",
        "altText": "確認您要的商品",
        "template": {
          "type": "buttons",
          "text": "請問這是您想要的商品嗎？請點擊下方按鈕確認：",
          "actions": actions
        }
      };
      
      return [
        { "type": "text", "text": listReply },
        template
      ];
    } else {
      var listReply = "🔍 您搜尋的關鍵字「" + searchItem + "」符合以下多個型號，請輸入更精準的型號進行查詢：\n\n";
      var limit = Math.min(groupKeys.length, 5);
      for (var g = 0; g < limit; g++) {
        var firstRow = groups[groupKeys[g]][0];
        var modelName = firstRow[idxModel] ? firstRow[idxModel].toString().trim() : "未標示";
        listReply += "- " + modelName + "\n";
      }
      if (groupKeys.length > 5) {
        listReply += "\n（僅顯示前 5 筆，請輸入更完整的商品編號）";
      }
      return listReply.trim();
    }
  }
  
  // 3.2) 如果搜尋結果為同一商品（可能有多筆不同批號資料）-> 進行合併排版與比對
  var targetKey = groupKeys[0];
  var groupedRows = groups[targetKey];
  var firstRow = groupedRows[0];
  
  var model = firstRow[idxModel] ? firstRow[idxModel].toString().trim() : "未標示";
  var modelCode = getModelCodeKey(model);
  
  var series = idxSeries !== -1 && firstRow[idxSeries] ? firstRow[idxSeries].toString().trim() : "未標示";
  var origin = idxOrigin !== -1 && firstRow[idxOrigin] ? firstRow[idxOrigin].toString().trim() : "未標示";
  var size = idxSize !== -1 && firstRow[idxSize] ? firstRow[idxSize].toString().trim() : "未標示";
  
  // 依據系列判斷單位
  var unit = getUnit(series);
  
  // 包裝（箱/入）、箱重（重量）、換算（坪/片）
  var packingVal = idxPacking !== -1 && firstRow[idxPacking] ? parseRobust(firstRow[idxPacking]) : 0;
  var packingText = packingVal > 0 ? (packingVal + " " + unit + "/件") : "未標示";
  
  var weightVal = idxWeight !== -1 && firstRow[idxWeight] ? firstRow[idxWeight].toString().trim() : "未標示";
  if (weightVal !== "未標示" && weightVal.toLowerCase().indexOf("kg") === -1) {
    weightVal += " KG";
  }
  
  var numJ = idxNumJ !== -1 && firstRow[idxNumJ] ? parseRobust(firstRow[idxNumJ]) : 0;
  var numJText = numJ > 0 ? (numJ + " " + unit + "/坪") : "未標示";
  
  // 收集所有批號的可用庫存 (即使庫存為零也保留以供顯示)
  var totalAvailableStock = 0;
  var batchMap = {}; // 批號 -> 可用庫存
  for (var r = 0; r < groupedRows.length; r++) {
    var row = groupedRows[r];
    var b = idxBatch !== -1 && row[idxBatch] ? row[idxBatch].toString().trim() : "";
    if (b === "") b = "(無批號)";
    var stock = getAvailableStock_(row, idxStock, idxAvailable, idxReserved); // 可用庫存
    totalAvailableStock += stock;
    
    if (!batchMap[b]) {
      batchMap[b] = 0;
    }
    batchMap[b] += stock;
  }
  
  var batchLines = [];
  var batchKeys = Object.keys(batchMap);
  for (var k = 0; k < batchKeys.length; k++) {
    var batchName = batchKeys[k];
    var batchStock = batchMap[batchName];
    var displayName = batchName;
    if (batchName === "(無批號)" || batchName === "无批号") {
      displayName = "無批號";
    }
    batchLines.push("- " + displayName + "：" + batchStock + " " + unit + (batchStock > 0 ? " ✅" : " ❌"));
  }
  
  var batchText = "";
  if (batchLines.length > 0) {
    batchText = batchLines.join("\n");
  } else {
    batchText = "- 🚫 暫無可用庫存";
  }
  
  // 檢查是否有「促銷」或「促销」字眼在備註欄位中
  var hasPromotion = false;
  for (var r = 0; r < groupedRows.length; r++) {
    var row = groupedRows[r];
    var noteVal = idxNote !== -1 && row.length > idxNote && row[idxNote] ? row[idxNote].toString().trim() : "";
    if (noteVal.indexOf("促銷") !== -1 || noteVal.indexOf("促销") !== -1) {
      hasPromotion = true;
      break;
    }
  }
  
  // 格式化商品基本資料與狀態訊息 (將查詢需求與庫存燈號狀態移至最上方)
  var reply = "";
  
  // === 4. 如果有查詢需求量，將查詢需求與狀態排版在最上方，並以科技感燈號表示 ===
  var isNearStockWarning = false;
  var warningDiff = 0;
  if (reqQty !== null) {
    var reqQtyInPieces = reqQty;
    
    // 單位換算
    if (reqUnit === "箱") {
      reqQtyInPieces = reqQty * (packingVal > 0 ? packingVal : 1);
    } else if (reqUnit === "坪") {
      reqQtyInPieces = reqQty * (numJ > 0 ? numJ : 1);
    }
    
    // 避免浮點運算造成 4560 被算成 4559.999999 之類的誤判
    var availableStockForCheck = Math.round(totalAvailableStock * 100) / 100;
    var requiredStockForCheck = Math.round(reqQtyInPieces * 100) / 100;
    
    reply += "查詢需求：" + reqQty + reqUnit + "\n";
    
    if (availableStockForCheck + 0.000001 >= requiredStockForCheck) {
      reply += "🟢 狀態：(庫存充足，可正常供應。)";
    } else {
      reply += "🔴 狀態：(庫存不足，目前現貨不足。)";
    }
    reply += "\n~~~~~~~~~~~~~~~~~~\n\n";

    // 檢查庫存與需求量差額是否在 100 片以內
    warningDiff = Math.abs(availableStockForCheck - requiredStockForCheck);
    if (warningDiff <= 100) {
      isNearStockWarning = true;
      
      // 將觸發吃緊警訊的型號記錄至快取中（保留 10 分鐘，以便顧客回覆好/要/需要時能對接通知小姐）
      if (senderUserId && senderUserId !== "N/A") {
        CacheService.getScriptCache().put("last_warn_" + senderUserId, model, 600);
      }
      
      var dayStrForCheck = Utilities.formatDate(new Date(), "GMT+8", "u");
      var isWeekendForCheck = (dayStrForCheck === "6" || dayStrForCheck === "7");
      
      if (isWeekendForCheck) {
        var customerName = getUserDisplayName(senderUserId);
        queueWeekendAlert(model, reqQty, reqUnit, totalAvailableStock, warningDiff, senderUserId, customerName);
      } else {
        sendClerkStockAlert(model, reqQty, reqUnit, totalAvailableStock, warningDiff, senderUserId);
      }
    }
  }
  
  // 如果是促銷商品，顯示警告語
  if (hasPromotion) {
    reply += "⚠️ 促銷不退貨\n~~~~~~~~~~~~~~~~~~\n\n";
  }
  
  // 格式化商品基本資料訊息 (更換為可愛好看的風格)
  reply += "🌸 商品編號：" + model + "\n";
  reply += "🎀 產品系列：" + series + "\n";
  reply += "📏 規格尺寸：" + size + "\n";
  reply += "🌍 產地來源：" + origin + "\n";
  reply += "📦 包裝數量：" + packingText + "\n";
  reply += "🏋️ 箱裝重量：" + weightVal + "\n";
  reply += "🧮 坪數換算：" + numJText + "\n";
  reply += "📦 可用庫存：" + totalAvailableStock + " " + unit + "\n";
  reply += "🎨 庫存批號：\n" + batchText;
  
  // 如果觸發庫存警示，在結果底部加入溫馨提醒
  if (isNearStockWarning) {
    var dayStrForCheck = Utilities.formatDate(new Date(), "GMT+8", "u");
    var isWeekendForCheck = (dayStrForCheck === "6" || dayStrForCheck === "7");
    var weekendNotice = isWeekendForCheck ? "\n（我們將於週一上班時間為您確認並主動回覆）" : "";
    
    reply += "\n\n⚠️⚠️⚠️ 庫存即將完售 ⚠️⚠️⚠️\n" +
             "━━━━━━━━━━━━━━━━━━━━\n" +
             "📢 溫馨提醒：\n" +
             "此型號目前可用庫存與您的查詢需求非常接近！\n" +
             "（目前僅相差約 " + Math.round(warningDiff) + " 片）\n\n" +
             "庫存隨時有變動可能，請問需要幫您請小姐進一步確定並預留嗎？" + weekendNotice + "\n" +
             "━━━━━━━━━━━━━━━━━━━━";
  }
  
  // 取得當前型號編號作為提示範例中的動態提醒
  var modelBase = "";
  var codeMatch = model.match(/^([a-zA-Z0-9\-_/\.]+)/);
  if (codeMatch) {
    modelBase = codeMatch[1];
  } else {
    modelBase = model.split(/\s+/)[0];
  }
  
  // 加入底部的提示資訊
    reply += "\n\n💡 查詢圖片：型號 + 單片/磚 / 實景";
    reply += "\n💡 查詢範例：(例：" + modelBase + " 10箱/片)";
    reply += "\n💡 貼心提醒：輸入「批號」（如 7X24）時，會直接顯示該批號的可用庫存數量喔！另外下方也附上超值的促銷按鈕，歡迎客倌點擊挑選便宜好貨！🎁✨";
  
  var replyMsg = reply.trim();

  // 一般庫存查詢只回傳純文字，避免額外觸發 Drive 搜尋而拖慢 webhook
  if (!isImageSearch) {
    return { "type": "text", "text": replyMsg };
  }

  // === 5. 只有查圖片時才解析相關連結按鈕 ===
  var productFolderVal = idxProductImgFolder !== -1 && firstRow.length > idxProductImgFolder && firstRow[idxProductImgFolder] ? firstRow[idxProductImgFolder].toString().trim() : "";
  var sceneFolderVal = idxSceneImgFolder !== -1 && firstRow.length > idxSceneImgFolder && firstRow[idxSceneImgFolder] ? firstRow[idxSceneImgFolder].toString().trim() : "";
  
  var productLink = getLinkFromCell(productFolderVal, modelCode, PRODUCT_IMAGE_FOLDER_ID);
  var sceneLink = getLinkFromCell(sceneFolderVal, modelCode, SCENE_IMAGE_FOLDER_ID);
  
  var actions = [];
  if (InventorySearch_isUsableImageLink(productLink) && isSingleSearch) {
    actions.push({
      "type": "uri",
      "label": "🖼️ 單片圖檔",
      "uri": productLink
    });
  }
  if (InventorySearch_isUsableImageLink(sceneLink) && isSceneSearch) {
    actions.push({
      "type": "uri",
      "label": "🏡 實景圖檔",
      "uri": sceneLink
    });
  }
  var template = {
    "type": "template",
    "altText": "點擊查看「" + model + "」的相關連結",
    "template": {
      "type": "buttons",
      "title": "🔗 " + (model.length > 25 ? model.substring(0, 22) + "..." : model) + " 相關連結",
      "text": "請選擇您要查看的項目：",
      "actions": actions
    }
  };
  if (actions.length > 0) {
    return template;
  }
  var labelName = isSingleSearch ? "單片圖檔" : (isSceneSearch ? "實景圖檔" : "相關圖檔");
  return { "type": "text", "text": replyMsg + "\n\n您好！目前系統中找不到「" + model + "」的" + labelName + "連結喔！先提供文字庫存結果供您確認。" };
}

// 輔助函數：解析數值
function parseRobust(val) {
  return QuantityParser_parseNumberOrZero(val);
}

// 負責把日誌寫入試算表中的「LINE紀錄」分頁
function writeLogToSheet(userMessage, replyText, status, rawContent) {
  // 為了避免 webhook 回覆逾時，只保留錯誤/系統類紀錄寫入試算表。
  var statusText = status || "";
  if (statusText.indexOf("失敗") === -1 && statusText.indexOf("錯誤") === -1 && statusText.indexOf("系統") === -1) {
    return;
  }

  var ssId = "1C_R1DdTj5brxftl9fPabTKBGzcG-lxWWxWoyi-ItA48";
  try {
    var time = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd HH:mm:ss");
    LogRepository_appendLineLog(ssId, [time, userMessage || "", replyText || "", status || "", rawContent || ""], 200);
  } catch (e) {
    console.error("寫入 Log 發生錯誤: " + e.toString());
  }
}

function isPromoCardEnabled_() {
  return false;
}

// 負責把訊息傳回給 LINE 的底層程式（支援傳送純文字或 LINE 訊息物件陣列）
function replyToLine(replyToken, replyData, skipPromo) {
  var url = 'https://api.line.me/v2/bot/message/reply';
  var messages = [];
  
  if (typeof replyData === 'string') {
    messages = [{'type': 'text', 'text': replyData}];
  } else if (Array.isArray(replyData)) {
    messages = replyData;
  } else {
    messages = [replyData];
  }
  
  // 如果不跳過促銷，且目前回覆訊息長度小於 5
  if (isPromoCardEnabled_() && !skipPromo && messages.length < 5) {
    var promoButtonMsg = {
      "type": "template",
      "altText": "客倌：我有一批貨很便宜，要不要試試看",
      "template": {
        "type": "buttons",
        "text": "客倌：我有一批貨很便宜，要不要試試看？🫱🪪",
        "actions": [
          {
            "type": "message",
            "label": "🔥 查看促銷商品",
            "text": "查看促銷商品"
          }
        ]
      }
    };
    messages.push(promoButtonMsg);
  }
  
  var options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN
    },
    'muteHttpExceptions': true,
    'payload': JSON.stringify({
      'replyToken': replyToken,
      'messages': messages
    })
  };
  
  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    if (code >= 200 && code < 300) return;
    
    console.error("LINE reply failed: " + code + " " + response.getContentText());
  } catch (err) {
    console.error("LINE reply exception: " + err.toString());
  }
  
  // 失敗時退回成純文字，避免整條訊息完全沒回覆
  try {
    var fallbackText = "";
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (msg && msg.type === "text" && msg.text) {
        fallbackText = msg.text;
        break;
      }
    }
    if (!fallbackText) {
      fallbackText = "抱歉，系統剛剛回覆失敗，請您再試一次，我會重新幫您查詢。";
    }
    UrlFetchApp.fetch(url, {
      'method': 'post',
      'headers': {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN
      },
      'muteHttpExceptions': true,
      'payload': JSON.stringify({
        'replyToken': replyToken,
        'messages': [{'type': 'text', 'text': fallbackText}]
      })
    });
  } catch (fallbackErr) {
    console.error("LINE fallback reply exception: " + fallbackErr.toString());
  }
}

// 幫助授權與測試的專用函數，請在編輯器中選擇此函數並點擊「執行」來啟用權限
function testUrlFetch() {
  try {
    var url = 'https://api.line.me/v2/bot/info';
    var options = {
      'method': 'get',
      'headers': {
        'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN
      },
      'muteHttpExceptions': true
    };
    var response = UrlFetchApp.fetch(url, options);
    Logger.log("測試成功！回應內容：" + response.getContentText());
  } catch (e) {
    Logger.log("測試失敗，錯誤原因：" + e.toString());
  }
}

// 先檢查目前授權狀態；如果還沒授權，會把授權網址印到執行紀錄
function checkAuthorization() {
  var info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  Logger.log("授權狀態：" + info.getAuthorizationStatus());
  if (info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    Logger.log("請先開啟這個網址完成授權：" + info.getAuthorizationUrl());
  }
}

// ⚠️ 強制授權函數（無 try-catch 阻擋），用來強制觸發 Google 系統的授權彈窗
function forceAuthorize() {
  UrlFetchApp.fetch("https://api.line.me/");
  SpreadsheetApp.openById("1C_R1DdTj5brxftl9fPabTKBGzcG-lxWWxWoyi-ItA48");
  DriveApp.getRootFolder(); // 強制觸發 Google 雲端硬碟的授權授權彈窗
  setupMondayTrigger();
  setupIdleCheckTrigger();
}

// 輔助函數：在指定資料夾中搜尋檔名包含關鍵字的圖片，並回傳直接連結與瀏覽連結 (已加入 10 分鐘高速快取以大幅提升回覆速度)
function getDriveFileUrl(folderId, fileNameKeyword) {
  if (!folderId || folderId.trim() === "" || folderId.indexOf('請填入') !== -1) {
    return null;
  }
  
  var cacheKey = "dr_file_" + folderId + "_" + fileNameKeyword.replace(/[^a-zA-Z0-9]/g, "");
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached !== null) {
    if (cached === "NOT_FOUND") return null;
    try {
      return JSON.parse(cached);
    } catch(err) {}
  }
  
  try {
    var folder = DriveApp.getFolderById(folderId);
    var query = 'title contains "' + fileNameKeyword + '" and mimeType contains "image/" and trashed = false';
    var files = folder.searchFiles(query);
    if (files.hasNext()) {
      var file = files.next();
      var fileId = file.getId();
      
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {
        console.warn("自動設定檔案共用失敗：" + shareErr.toString());
      }
      
      var fileInfo = {
        directUrl: "https://lh3.googleusercontent.com/d/" + fileId,
        viewUrl: file.getUrl()
      };
      cache.put(cacheKey, JSON.stringify(fileInfo), 21600); // 快取 6 小時 (最大上限)，大幅提升重複搜尋之回應速度
      return fileInfo;
    }
  } catch (e) {
    console.error("搜尋雲端硬碟圖檔時發生錯誤 (型號: " + fileNameKeyword + "): " + e.toString());
  }
  cache.put(cacheKey, "NOT_FOUND", 3600); // 未找到同樣快取 1 小時，避免重複發起慢速搜尋
  return null;
}

// 輔助尋找資料夾 ID 的函數，請在編輯器中選擇並執行此函數，並在下方的「執行紀錄」中複製 ID
function listDriveFolders() {
  var folders = DriveApp.getFolders();
  var found = false;
  Logger.log("=== 開始搜尋您的 Google Drive 資料夾 ===");
  while (folders.hasNext()) {
    var folder = folders.next();
    var name = folder.getName();
    // 篩選出名字含有 圖、產品、實景、照片、庫存 等字樣的資料夾
    if (name.indexOf("圖") !== -1 || name.indexOf("產品") !== -1 || name.indexOf("實景") !== -1 || name.indexOf("照片") !== -1 || name.indexOf("庫存") !== -1) {
      Logger.log("資料夾名稱: 「" + name + "」 ➡️ ID: " + folder.getId());
      found = true;
    }
  }
  if (!found) {
    Logger.log("沒有找到包含關鍵字的資料夾，以下列出前 20 個資料夾供參考：");
    var folders2 = DriveApp.getFolders();
    var count = 0;
    while (folders2.hasNext() && count < 20) {
      var f = folders2.next();
      Logger.log("資料夾名稱: 「" + f.getName() + "」 ➡️ ID: " + f.getId());
      count++;
    }
  }
  Logger.log("=== 搜尋結束 ===");
}

// 輔助解析儲存格內容以提取 Google Drive 資料夾 ID
function getFolderIdFromCell(cellValue) {
  if (!cellValue) return null;
  var val = cellValue.toString().trim();
  if (val === "") return null;
  
  // 檢查是否為網址格式，若是則從中提取資料夾或檔案 ID
  if (val.indexOf("http") === 0) {
    var match = val.match(/folders\/([a-zA-Z0-9\-_]+)/);
    if (match) return match[1];
    var matchFile = val.match(/id=([a-zA-Z0-9\-_]+)/);
    if (matchFile) return matchFile[1];
  }
  
  // 檢查是否符合 Google Drive ID 的一般特徵（長度在 25 到 50 之間，包含大小寫字母、數字、底線和橫線）
  if (/^[a-zA-Z0-9\-_]{25,50}$/.test(val)) {
    return val;
  }
  
  return null;
}

// 輔助函數：藉由資料夾名稱或 ID，在該資料夾中搜尋符合型號關鍵字的圖片，並回傳圖片資訊 (已加入資料夾 ID 快取 24 小時)
function getDriveFileUrlByNameOrId(folderNameOrId, fileNameKeyword) {
  if (!folderNameOrId || folderNameOrId.trim() === "") return null;
  
  var folderId = getFolderIdFromCell(folderNameOrId);
  if (folderId) {
    return getDriveFileUrl(folderId, fileNameKeyword);
  }
  
  var cacheKey = "f_name_to_id_" + folderNameOrId.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "");
  var cache = CacheService.getScriptCache();
  var cachedId = cache.get(cacheKey);
  if (cachedId !== null) {
    if (cachedId === "NOT_FOUND") return null;
    return getDriveFileUrl(cachedId, fileNameKeyword);
  }
  
  try {
    var folders = DriveApp.getFoldersByName(folderNameOrId);
    if (folders.hasNext()) {
      var folder = folders.next();
      var fId = folder.getId();
      cache.put(cacheKey, fId, 86400); // 快取名稱對應的 ID 24 小時
      return getDriveFileUrl(fId, fileNameKeyword);
    }
  } catch (e) {
    console.error("藉由資料夾名稱搜尋圖片時發生錯誤 (資料夾: " + folderNameOrId + ", 型號: " + fileNameKeyword + "): " + e.toString());
  }
  cache.put(cacheKey, "NOT_FOUND", 3600); // 1 小時內不再重複找不存在的資料夾名稱
  return null;
}

// 輔助函數：解析儲存格內容（網址、資料夾或單一檔案）以取得適當的連結
function getLinkFromCell(cellValue, modelCode, defaultFolderId) {
  if (!cellValue) {
    if (defaultFolderId) {
      // 💡 極速搜尋優化：如果不希望每次都花費數秒進行 DriveApp.searchFiles，
      // 且這裡只有 defaultFolderId (未在儲存格填寫網址)，我們維持 Drive 搜尋為備用 fallback。
      var defaultFile = getDriveFileUrl(defaultFolderId, modelCode);
      if (defaultFile) return defaultFile.viewUrl;
    }
    return null;
  }
  
  var val = cellValue.toString().trim();
  if (val === "") return null;
  
  // 1. 如果是 Google Drive 資料夾連結 -> 💡 極速搜尋優化：直接返回資料夾連結，繞過 DriveApp 搜尋
  if (val.indexOf("http") === 0 && val.indexOf("folders/") !== -1) {
    return val;
  }
  
  // 2. 如果是 Google Drive 單一檔案連結 (包含 file/d/)
  if (val.indexOf("http") === 0 && val.indexOf("file/d/") !== -1) {
    return val;
  }
  
  // 3. 如果是其他網址
  if (val.indexOf("http") === 0) {
    return val;
  }
  
  // 4. 如果是普通的資料夾名稱或 ID -> 回退至 DriveApp 搜尋
  var fileByName = getDriveFileUrlByNameOrId(val, modelCode);
  if (fileByName) return fileByName.viewUrl;
  
  return null;
}

// 輔助函數：依據系列名稱判定單位 (片 或 包)
function getUnit(seriesName) {
  if (!seriesName) return "片";
  var name = seriesName.trim();
  if (name === "填縫劑" || name === "泳池填縫劑" || name.indexOf("填縫劑") !== -1) {
    return "包";
  }
  return "片";
}

// 輔助函數：將搜尋字元與型號進行標準化處理（忽略大小寫、空白與特殊符號）
function normalizeSearchKey(str) {
  return TextNormalizer_normalizeSearchKey(str);
}

function InventorySearch_cleanDisplayQuery(str) {
  if (str == null) return "";
  return str.toString().replace(/\s+/g, " ").trim();
}

function InventorySearch_normalizeQuery(str) {
  return normalizeSearchKey(InventorySearch_cleanDisplayQuery(str));
}

function InventorySearch_matchRank(row, query, options) {
  options = options || {};
  if (!row) return null;
  var searchKey = InventorySearch_normalizeQuery(query);
  if (!searchKey || searchKey.length < 2) return null;
  var allowContainsMatch = searchKey.length >= 3;

  var idxModel = options.idxModel;
  var idxName = options.idxName;
  var modelVal = idxModel !== undefined && idxModel >= 0 && row.length > idxModel && row[idxModel] ? row[idxModel].toString().trim() : "";
  if (!modelVal) return null;

  var modelCode = getModelCodeKey(modelVal);
  var fullModelKey = InventorySearch_normalizeQuery(modelVal);
  var nameKey = idxName !== undefined && idxName >= 0 && row.length > idxName && row[idxName] ? InventorySearch_normalizeQuery(row[idxName]) : "";

  if (modelCode === searchKey || fullModelKey === searchKey) return 1;
  if (modelCode.indexOf(searchKey) === 0 || fullModelKey.indexOf(searchKey) === 0) return 2;
  if (allowContainsMatch && (modelCode.indexOf(searchKey) !== -1 || fullModelKey.indexOf(searchKey) !== -1)) return 3;
  if (allowContainsMatch && nameKey && nameKey.indexOf(searchKey) !== -1) return 4;
  return null;
}

function InventorySearch_rankAndLimitRows(rows, query, options) {
  options = options || {};
  var limit = options.limit == null ? 5 : options.limit;
  var ranked = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var rank = InventorySearch_matchRank(row, query, options);
    if (rank == null) continue;
    ranked.push({
      row: row,
      rank: rank,
      index: i
    });
  }
  ranked.sort(function(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.index - b.index;
  });
  if (ranked.length === 0) return [];
  var bestRank = ranked[0].rank;
  var result = ranked.filter(function(item) {
    return item.rank === bestRank;
  }).map(function(item) {
    return item.row;
  });
  if (limit > 0) {
    return result.slice(0, limit);
  }
  return result;
}

function InventorySearch_isUsableImageLink(url) {
  if (!url) return false;
  var val = url.toString().trim();
  return /^https?:\/\//i.test(val);
}

// 輔助函數：解析儲存格內容以取得直接的圖片 URL (用於傳送 LINE 圖片訊息)
function getDirectImageLink(cellValue, modelCode, defaultFolderId) {
  if (!cellValue) {
    if (defaultFolderId) {
      var defaultFile = getDriveFileUrl(defaultFolderId, modelCode);
      if (defaultFile) return defaultFile.directUrl;
    }
    return null;
  }
  
  var val = cellValue.toString().trim();
  if (val === "") return null;
  
  // 1. 如果是 Google Drive 單一檔案連結 (包含 file/d/)
  if (val.indexOf("http") === 0 && val.indexOf("file/d/") !== -1) {
    var fileIdMatch = val.match(/file\/d\/([a-zA-Z0-9\-_]+)/);
    if (fileIdMatch) return "https://lh3.googleusercontent.com/d/" + fileIdMatch[1];
  }
  // 或者包含 id=
  if (val.indexOf("http") === 0 && val.indexOf("id=") !== -1) {
    var idMatch = val.match(/id=([a-zA-Z0-9\-_]+)/);
    if (idMatch) return "https://lh3.googleusercontent.com/d/" + idMatch[1];
  }
  
  // 2. 如果是 Google Drive 資料夾連結
  if (val.indexOf("http") === 0 && val.indexOf("folders/") !== -1) {
    var matchFolder = val.match(/folders\/([a-zA-Z0-9\-_]+)/);
    if (matchFolder) {
      var folderId = matchFolder[1];
      var fileInFolder = getDriveFileUrl(folderId, modelCode);
      if (fileInFolder) return fileInFolder.directUrl;
    }
  }
  
  // 3. 如果是普通的資料夾名稱 or ID
  var fileByName = getDriveFileUrlByNameOrId(val, modelCode);
  if (fileByName) return fileByName.directUrl;
  
  return null;
}

// 取得詢問顧客的 LINE Profile 暱稱
function getUserDisplayName(userId) {
  if (!userId || userId === "N/A") return "顧客";
  try {
    var url = 'https://api.line.me/v2/bot/profile/' + userId;
    var options = {
      'method': 'get',
      'headers': {
        'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN
      },
      'muteHttpExceptions': true
    };
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      var profile = JSON.parse(response.getContentText());
      return profile.displayName || "顧客";
    }
  } catch (e) {
    console.error("取得用戶暱稱失敗: " + e.toString());
  }
  return "顧客";
}

// 當可用庫存與查詢片數差額在 100 片以內時，向小姐發送庫存吃緊 Push 通知
function sendClerkStockAlert(model, reqQty, reqUnit, totalAvailableStock, warningDiff, senderUserId) {
  try {
    var clerkUserId = PropertiesService.getScriptProperties().getProperty('CLERK_USER_ID');
    if (!clerkUserId) {
      Logger.log("CLERK_USER_ID has not been set yet.");
      return;
    }
    
    // 檢查小姐是否已確認，若是則停止發送
    var acked = CacheService.getScriptCache().get("clerk_acknowledged_" + senderUserId);
    if (acked === "true") {
      Logger.log("Prevented alert to clerk because clerk already acknowledged: " + senderUserId);
      return;
    }
    
    // 防重複推播機制：2小時內相同顧客對相同商品最多通知小姐 2 次
    var modelCode = getGlobalModelCodeKey(model);
    var cacheKey = "clerk_alert_count_" + modelCode + "_" + senderUserId;
    var alertCount = parseInt(CacheService.getScriptCache().get(cacheKey) || "0");
    if (alertCount >= 2) {
      Logger.log("Prevented duplicate alert to clerk (reached max limit of 2): " + modelCode);
      return;
    }
    CacheService.getScriptCache().put(cacheKey, (alertCount + 1).toString(), 7200); // 2 小時快取 (7200 秒)
    
    // 紀錄為活躍顧客，以便小姐回覆時消警
    recordActiveAlertCustomer(senderUserId);
    
    // 取得顧客名稱
    var customerName = getUserDisplayName(senderUserId);
    
    var alertText = "🚨🚨🚨 庫存吃緊警示 🚨🚨🚨\n" +
                    "━━━━━━━━━━━━━━━━━━━━\n" +
                    "有顧客在 LINE 上詢問此商品庫存：\n\n" +
                    "🌸 商品型號：" + model + "\n" +
                    "📊 顧客需求：" + reqQty + " " + reqUnit + "\n" +
                    "🟢 目前可用庫存：" + totalAvailableStock + " 片\n" +
                    "⚠️ 相差片數：" + Math.round(warningDiff) + " 片 (在 100 片以內)\n" +
                    "👤 詢問顧客：" + customerName + "\n\n" +
                    "💡 提示：請儘速與顧客確認或鎖定庫存喔！";
                    
    var url = 'https://api.line.me/v2/bot/message/push';
    var options = {
      'method': 'post',
      'headers': {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN
      },
      'payload': JSON.stringify({
        'to': clerkUserId,
        'messages': [{'type': 'text', 'text': alertText}]
      }),
      'muteHttpExceptions': true
    };
    var response = UrlFetchApp.fetch(url, options);
    Logger.log("Sent alert to clerk: " + response.getContentText());
  } catch (err) {
    Logger.log("Failed to send alert to clerk: " + err.toString());
  }
}

// 假日排程：將警示先寫入試算表中的「假日警示排程」分頁
function queueWeekendAlert(model, reqQty, reqUnit, totalAvailableStock, warningDiff, senderUserId, customerName) {
  var ssId = "1C_R1DdTj5brxftl9fPabTKBGzcG-lxWWxWoyi-ItA48";
  try {
    // 檢查小姐是否已確認，若是則停止排程
    var acked = CacheService.getScriptCache().get("clerk_acknowledged_" + senderUserId);
    if (acked === "true") {
      Logger.log("Prevented weekend alert queue because clerk already acknowledged: " + senderUserId);
      return;
    }
    
    // 防重複排程機制：2小時內相同顧客對相同商品最多排程 2 次
    var modelCode = getGlobalModelCodeKey(model);
    var cacheKey = "clerk_alert_count_" + modelCode + "_" + senderUserId;
    var alertCount = parseInt(CacheService.getScriptCache().get(cacheKey) || "0");
    if (alertCount >= 2) {
      Logger.log("Prevented duplicate weekend alert queue (reached max limit of 2): " + modelCode);
      return;
    }
    CacheService.getScriptCache().put(cacheKey, (alertCount + 1).toString(), 7200); // 2 小時快取 (7200 秒)
    
    // 紀錄為活躍顧客，以便小姐回覆時消警
    recordActiveAlertCustomer(senderUserId);
    
    var time = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd HH:mm:ss");
    ReminderRepository_appendWeekendAlert(ssId, [time, model, reqQty, reqUnit, totalAvailableStock, warningDiff, senderUserId, customerName, "待發送"]);
  } catch (e) {
    console.error("寫入假日警示排程失敗: " + e.toString());
  }
}

// 輔助全域函式：解析商品型號代碼
function getGlobalModelCodeKey(modelStr) {
  if (!modelStr) return "";
  var codeMatch = modelStr.toString().trim().match(/^([a-zA-Z0-9\-_/\.]+)/);
  return codeMatch ? normalizeSearchKey(codeMatch[1]) : normalizeSearchKey(modelStr);
}

// 週一排程 Trigger 自動建立與管理
function setupMondayTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "processMondayReminders") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("processMondayReminders")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();
  Logger.log("週一提醒排程 Trigger 建立成功！");
}

// 每週一早上處理假日累積警示推播的入口函式
function processMondayReminders() {
  var ssId = "1C_R1DdTj5brxftl9fPabTKBGzcG-lxWWxWoyi-ItA48";
  try {
    var data = ReminderRepository_readWeekendAlertRows(ssId);
    if (!data) {
      Logger.log("找不到『假日警示排程』分頁。");
      return;
    }
    
    if (data.length <= 1) {
      Logger.log("沒有排程警示需要處理。");
      return;
    }
    
    var clerkUserId = PropertiesService.getScriptProperties().getProperty('CLERK_USER_ID');
    var clerkAlerts = [];
    var processedCount = 0;
    
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var status = row[8]; // 狀態
      if (status === "待發送") {
        var time = row[0];
        var model = row[1];
        var reqQty = row[2];
        var reqUnit = row[3];
        var totalAvailableStock = row[4];
        var warningDiff = row[5];
        var senderUserId = row[6];
        var customerName = row[7];
        
        // 1. 推播給顧客提醒
        if (senderUserId && senderUserId !== "N/A") {
          try {
            var customerText = "📢 您好！今天是工作日，關於您於假日詢問的商品「" + model + "」（需求量與可用庫存相差在 100 片以內，僅相差 " + Math.round(warningDiff) + " 片），我們已請服務小姐進一步幫您確認庫存與保留喔！如有需要，小姐會主動與您聯繫。";
            pushMessageToUser(senderUserId, customerText);
          } catch (custErr) {
            console.error("發送顧客週一提醒失敗: " + custErr.toString());
          }
        }
        
        // 2. 收集給小姐的警示
        clerkAlerts.push("- 商品：" + model + " | 需求：" + reqQty + reqUnit + " | 庫存：" + totalAvailableStock + " 片 | 差額：" + Math.round(warningDiff) + " 片 | 顧客：" + customerName);
        
        // 3. 更新狀態為已發送
        var updateTime = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd HH:mm:ss");
        ReminderRepository_setWeekendAlertStatus(ssId, r + 1, "已發送 (" + updateTime + ")");
        processedCount++;
      }
    }
    
    // 3. 推播整合通知給小姐
    if (clerkAlerts.length > 0 && clerkUserId) {
      var alertText = "🔔 假日累積庫存警示通知\n" +
                      "以下為假日期間顧客詢問且庫存吃緊的項目，請儘速處理：\n\n" +
                      clerkAlerts.join("\n\n") + "\n\n" +
                      "💡 提示：請確認上述顧客需求並及時鎖定庫存喔！";
      pushMessageToUser(clerkUserId, alertText);
    }
    
    Logger.log("成功處理 " + processedCount + " 筆週一提醒。");
  } catch (err) {
    Logger.log("處理週一提醒時發生錯誤: " + err.toString());
  }
}

// 輔助函數：主動 Push 訊息給使用者或小姐
function pushMessageToUser(userId, text) {
  var clerkUserId = PropertiesService.getScriptProperties().getProperty("CLERK_USER_ID");
  var messageObj = {
    'type': 'text',
    'text': text
  };
  
  // 如果是發送給小姐的推送訊息，自動隨附 Quick Reply 快速回覆按鈕
  if (clerkUserId && userId === clerkUserId) {
    messageObj.quickReply = {
      'items': [
        {
          'type': 'action',
          'action': {
            'type': 'message',
            'label': '👌 OK',
            'text': 'OK'
          }
        },
        {
          'type': 'action',
          'action': {
            'type': 'message',
            'label': '👍 收到',
            'text': '收到'
          }
        },
        {
          'type': 'action',
          'action': {
            'type': 'message',
            'label': '好',
            'text': '好'
          }
        }
      ]
    };
  }

  var url = 'https://api.line.me/v2/bot/message/push';
  var options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN
    },
    'payload': JSON.stringify({
      'to': userId,
      'messages': [messageObj]
    }),
    'muteHttpExceptions': true
  };
  var response = UrlFetchApp.fetch(url, options);
  return response;
}

// 輔助函數：將客戶端專用圖文選單綁定至指定使用者
function linkRichMenuToUser(userId) {
  if (typeof CUSTOMER_RICH_MENU_ID === "undefined" || !CUSTOMER_RICH_MENU_ID) return;
  var url = 'https://api.line.me/v2/bot/user/' + userId + '/richmenu/' + CUSTOMER_RICH_MENU_ID;
  var options = {
    'method': 'post',
    'headers': {
      'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN
    },
    'muteHttpExceptions': true
  };
  try {
    var response = UrlFetchApp.fetch(url, options);
    Logger.log("綁定圖文選單結果 (" + userId + "): " + response.getContentText());
  } catch (err) {
    Logger.log("綁定圖文選單 API 呼叫失敗: " + err.toString());
  }
}

// 輔助函數：取得特定列的可用庫存，並具備公式失效自動扣除保留數量的防呆與容錯邏輯
function getAvailableStock_(row, idxStock, idxAvailable, idxReserved) {
  if (!row) return 0;
  var stockIdx = (typeof idxStock !== "undefined" && idxStock !== -1) ? idxStock : 10;
  var availIdx = (typeof idxAvailable !== "undefined" && idxAvailable !== -1) ? idxAvailable : 11;
  var reservIdx = (typeof idxReserved !== "undefined" && idxReserved !== -1) ? idxReserved : 12;
  
  var physical = row.length > stockIdx ? parseRobust(row[stockIdx]) : 0;
  var reserved = row.length > reservIdx ? parseRobust(row[reservIdx]) : 0;
  var available = row.length > availIdx ? parseRobust(row[availIdx]) : (physical - reserved);
  
  // 防呆與校正：可用庫存不應高於「實際現貨庫存 - 保留數量」
  var maxAllowed = physical - reserved;
  if (available > maxAllowed) {
    available = maxAllowed;
  }
  return available;
}

// 假日排程消警：當小姐在假日回覆好/OK/貼圖時，自動將假日警示狀態變更為「已確認」，防週一重複發送
function markWeekendAlertsAsProcessed() {
  var ssId = "1C_R1DdTj5brxftl9fPabTKBGzcG-lxWWxWoyi-ItA48";
  try {
    var data = ReminderRepository_readWeekendAlertRows(ssId);
    if (!data) return;
    if (data.length <= 1) return;
    
    var updateTime = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd HH:mm:ss");
    var updateCount = 0;
    
    for (var r = 1; r < data.length; r++) {
      var status = data[r][8];
      if (status === "待發送") {
        ReminderRepository_setWeekendAlertStatus(ssId, r + 1, "已確認 (" + updateTime + ")");
        updateCount++;
      }
    }
    Logger.log("已自動取消 " + updateCount + " 筆假日排程警報。");
  } catch (e) {
    Logger.log("消警失敗: " + e.toString());
  }
}

// 智慧引導守衛：攔截閒聊、問候或挫折性詞彙，改回以溫馨引導語而非查無型號
// 智慧引導守衛：攔截閒聊、問候、抱怨或親切回覆，提供 AI 客服助理式的溫馨互動與引導
function checkIntelligenceGuard(itemName, senderUserId) {
  var clean = itemName.trim().toLowerCase();
  
  // 1. 常見問候/閒聊詞 (AI 客服助理問候)
  var greetings = /^(哈囉|hello|hi|你好|您好|在嗎|早安|午安|晚安|嗨|在吗|哈罗|有人在嗎|有人在吗|👋)$/i;
  if (greetings.test(clean)) {
    return "您好！我是您的 AI 客服助理 🌸 很高興為您服務！\n\n" +
           "💡 您可以直接輸入產品的「型號」（如：EQ-1721）來幫您快速查詢庫存，或輸入「型號 + 數量」進行查詢。\n" +
           "💡 如果想查看某個系列的所有型號，直接輸入「系列名稱」（例如：波波里花園）就可以囉！\n\n" +
           "請問今天有什麼我可以幫您的呢？😊";
  }
  
  // 2. 感謝/親切回覆詞 (給予溫暖的回覆，並標記結束會話)
  var thanks = /^(謝謝|谢谢|感恩|感謝|感谢|ok|了解|知道|了解了|收到|好的|ok了|👌|辛苦了|麻煩了|麻煩您了|太好了|好棒|棒|讚|讚喔|太感謝了)$/;
  if (thanks.test(clean)) {
    if (senderUserId && senderUserId !== "N/A") {
      removeSessionUser(senderUserId);
    }
    return "不客氣，這是我應該做的！🥰 很高興能幫上您的忙。\n\n" +
           "若您之後還有其他商品需要查詢，隨時直接留言輸入型號，我都會立刻幫您處理喔！\n" +
           "請問目前還有其他需要我協助的地方嗎？✨";
  }

  // 3. 否定詞 / 不需要協助 (標記結束會話)
  var noHelp = /^(沒有|不需要|不用|沒事|沒了|不用了|沒有了|不用麻煩了|先不用|暫時不用|暫時沒有|無|沒|不用謝謝|不用喔|沒有喔|沒有耶|這樣就好)$/;
  if (noHelp.test(clean)) {
    if (senderUserId && senderUserId !== "N/A") {
      removeSessionUser(senderUserId);
    }
    return "好的，沒問題！👍 非常感謝您的回覆。\n\n" +
           "祝您有個美好愉快的一天！🌸 如果之後有任何商品庫存或圖片需要查詢，隨時歡迎再來找我喔！😊";
  }

  // 4. 肯定詞 / 需要協助 (提示輸入型號)
  var yesHelp = /^(要|需要|好啊|請幫我確認|請小姐確認|確認|麻煩確認)$/;
  if (yesHelp.test(clean)) {
    return "好的！請問您需要查詢或預留哪一個商品型號呢？\n" +
           "可以直接輸入型號（例如：EQ-1721）或系列名稱，我會立刻幫您處理喔！🌸";
  }
  
  // 5. 抱怨/情緒詞 (以幽默調侃、詼諧自嘲的口吻回應，取代原本生硬的回覆)
  var complaints = /.*(笨死了|白痴|白癡|笨蛋|傻眼|北七|爛死了|爛|差勁|無言|白痴喔|不聰明|笨|爛機器人|廢物|智障|爛透了|白目|吵|囉唆|煩|廢|沒用|吵死了|裝死|傻逼|垃圾|爛貨).*$/;
  if (complaints.test(clean)) {
    return "哎呀！客倌您這一鞭抽得小幫手機心運算都差點短路啦！⚡️😵‍💫\n" +
           "小幫手知道自己有時候反應呆呆的，但只要您輸入正確的「型號」（例如：`EQ-1721`）或「批號」，我保證會用最快的速度滾去幫您查好庫存！\n\n" +
           "💡 來～深呼吸，重新輸入正確編號給小幫手一次表現的機會嘛！🙏\n" +
           "（如果還是嫌我太笨，可以直接打「預留」或「請小姐確認」，我會乖乖去把我們溫柔親切的服務小姐請出來為您做最完美的真人服務喔！🥰🌸）";
  }
  
  // 6. 詢問照片/圖片但沒有提供型號 (防呆與高齡化友善引導)
  var photoKeywords = /^(照片|圖片|圖檔|相片|看照片|看圖片|看圖|有照片嗎|有圖片嗎|有圖嗎|照片檔|单片|实景|产品图|圖片檔)$/;
  if (photoKeywords.test(clean)) {
    return "您好！我是您的 AI 客服助理 🌸\n\n" +
           "💡 如果您想查詢商品的圖檔連結，可以直接輸入『型號 + 照片』（例如：`EQ-1721 照片`）或『型號 + 實景』（例如：`EQ-1721 實景`）喔！\n" +
           "系統會立刻把單片圖與實景圖連結傳給您喔！🥰\n\n" +
           "另外，每則訊息下方都有我們最新最殺的「促銷商品」按鈕，客倌有空也可以去點點看喔！🛒✨";
  }

  // 7. 純中文且長度 >= 3 的字詞（通常是閒聊、抱怨或打錯的系列/型號），且不是型號格式
  var isPureChinese = /^[\u4e00-\u9fa5]+$/.test(clean);
  if (isPureChinese && clean.length >= 3) {
    return "您好！系統無法辨識「" + itemName + "」這個指令喔 🌸\n\n" +
           "💡 如果您是想查詢「系列」，請確認系列名稱是否輸入正確（如：雪藏、EQ六角）。\n" +
           "💡 如果您是想查詢「型號」，請直接輸入品項編號（如：EQ-1721）。\n\n" +
           "ℹ️ 您可以輸入「說明」或「幫助」取得完整的格式指引。";
  }
  
  return null;
}

// 輔助功能：記錄活躍警訊顧客，便於小姐回覆時一次性消警與設定免打擾
function recordActiveAlertCustomer(senderUserId) {
  CacheHelper_addToCommaList("active_alert_customers", senderUserId, 7200); // 2 小時
}

// 輔助功能：紀錄活躍顧客會話
function recordSessionUser(senderUserId) {
  if (!senderUserId || senderUserId === "N/A") return;
  CacheHelper_addToCommaList("active_session_users", senderUserId, 3600); // 1 小時
  CacheHelper_put("last_active_time_" + senderUserId, new Date().getTime().toString(), 3600);
  CacheHelper_remove("follow_up_sent_" + senderUserId);
}

// 輔助功能：移除活躍顧客會話 (結束服務)
function removeSessionUser(senderUserId) {
  if (!senderUserId || senderUserId === "N/A") return;
  CacheHelper_removeFromCommaList("active_session_users", senderUserId, 3600);
  CacheHelper_remove("last_active_time_" + senderUserId);
  CacheHelper_remove("follow_up_sent_" + senderUserId);
}

// 定時排程：檢查閒置顧客並在 5 分鐘後發送關懷訊息
function checkIdleCustomers() {
  var cache = CacheService.getScriptCache();
  var activeListStr = cache.get("active_session_users") || "";
  if (!activeListStr) return;
  
  var list = activeListStr.split(",");
  var now = new Date().getTime();
  var updatedList = [];
  
  for (var i = 0; i < list.length; i++) {
    var senderUserId = list[i];
    if (!senderUserId) continue;
    
    var lastActiveTimeStr = cache.get("last_active_time_" + senderUserId);
    if (!lastActiveTimeStr) continue; // 已過期過久，跳過
    
    var lastActiveTime = parseInt(lastActiveTimeStr);
    var elapsedMinutes = (now - lastActiveTime) / 60000;
    
    var followUpSent = cache.get("follow_up_sent_" + senderUserId);
    
    // 超過 5 分鐘未說話，且本會話還沒有發送過關懷問候
    if (elapsedMinutes >= 5 && elapsedMinutes < 15 && !followUpSent) {
      try {
        var followUpText = "您好 🌸 請問剛剛查詢的商品庫存還順利嗎？有沒有其他需要我協助確認或預留的地方呢？😊";
        pushMessageToUser(senderUserId, followUpText);
        cache.put("follow_up_sent_" + senderUserId, "true", 3600);
      } catch (e) {
        Logger.log("Failed to push follow-up to user: " + senderUserId + ", error: " + e.toString());
      }
    }
    
    // 只保留 20 分鐘內的活躍追蹤，超過後將自動排除不再追蹤
    if (elapsedMinutes < 20) {
      updatedList.push(senderUserId);
    }
  }
  
  if (updatedList.length > 0) {
    cache.put("active_session_users", updatedList.join(","), 3600);
  } else {
    cache.remove("active_session_users");
  }

  checkPendingPromoReserveReminders();
}

// 自動註冊 5 分鐘閒置檢查排程
function setupIdleCheckTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var exists = false;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "checkIdleCustomers") {
      exists = true;
      break;
    }
  }
  if (!exists) {
    ScriptApp.newTrigger("checkIdleCustomers")
      .timeBased()
      .everyMinutes(5)
      .create();
    Logger.log("閒置追蹤排程 Trigger 建立成功！");
  }
}

function submitPromoReserve(payload) {
  try {
    var data = payload || {};
    var model = String(data.model || "").trim();
    if (!model) {
      return { success: false, error: "缺少商品型號" };
    }

    var clerkUserId = PropertiesService.getScriptProperties().getProperty("CLERK_USER_ID");
    if (!clerkUserId) {
      return { success: false, error: "尚未設定小姐通知對象（CLERK_USER_ID）" };
    }

    var userId = String(data.userId || "").trim();
    var customerName = String(data.customerName || "").trim();
    if (!customerName && userId && userId !== "") {
      try {
        customerName = getUserDisplayName(userId);
      } catch (userErr) {
        Logger.log("獲取顧客姓名失敗: " + userErr.toString());
      }
    }

    var reserveItem = {
      id: Utilities.getUuid(),
      model: model,
      series: String(data.series || "").trim(),
      stock: String(data.stock || "").trim(),
      promoText: String(data.promoText || "").trim(),
      createdAt: new Date().getTime(),
      reminded: false,
      userId: userId,
      customerName: customerName
    };

    var queue = getPendingPromoReserveQueue_();
    queue.push(reserveItem);
    savePendingPromoReserveQueue_(queue);
    setupIdleCheckTrigger();

    // 寫入 Google 試算表的「客戶預留紀錄」分頁
    try {
      writeReserveToSheet_(reserveItem);
    } catch (sheetErr) {
      Logger.log("寫入預留紀錄至試算表失敗: " + sheetErr.toString());
    }

    pushMessageToUser(clerkUserId, buildPromoReserveAlertText_(reserveItem, false));
    return { success: true, message: "已通知小姐" };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function checkPendingPromoReserveReminders() {
  try {
    var queue = getPendingPromoReserveQueue_();
    if (!queue.length) return;

    var clerkUserId = PropertiesService.getScriptProperties().getProperty("CLERK_USER_ID");
    if (!clerkUserId) return;

    var now = new Date().getTime();
    var updated = [];

    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];
      if (!item || !item.id || item.reminded === true) continue;
      var createdAt = parseInt(item.createdAt || "0");
      if (!createdAt) continue;

      if ((now - createdAt) >= 30 * 60 * 1000) {
        pushMessageToUser(clerkUserId, buildPromoReserveAlertText_(item, true));
        item.reminded = true;
        item.remindedAt = now;
        continue;
      }

      updated.push(item);
    }

    // 已送出提醒的項目不再保留，避免重複催促
    savePendingPromoReserveQueue_(updated);
  } catch (err) {
    Logger.log("checkPendingPromoReserveReminders failed: " + err.toString());
  }
}

function clearPendingPromoReserveRequests() {
  try {
    PropertiesService.getScriptProperties().deleteProperty("pending_promo_reserves");
  } catch (err) {
    Logger.log("clearPendingPromoReserveRequests failed: " + err.toString());
  }
}

function getPendingPromoReserveQueue_() {
  return CacheHelper_getJsonProperty("pending_promo_reserves", []);
}

function savePendingPromoReserveQueue_(queue) {
  CacheHelper_setJsonProperty("pending_promo_reserves", queue || []);
}

function buildPromoReserveAlertText_(item, isReminder) {
  var prefix = isReminder ? "⏰ 預留提醒" : "🔔 新的預留通知";
  var customerInfo = "";
  if (item.customerName) {
    customerInfo = "👤 預留顧客：" + item.customerName + "\n";
  } else if (item.userId) {
    customerInfo = "👤 預留顧客 ID：" + item.userId + "\n";
  } else {
    customerInfo = "👤 預留顧客：未填寫 (可能直接開啟網頁)\n";
  }

  return prefix + "\n" +
    "━━━━━━━━━━━━━━━━━━━━\n" +
    customerInfo +
    "🌸 商品型號：" + (item.model || "-") + "\n" +
    (item.series ? "🏷️ 系列：" + item.series + "\n" : "") +
    (item.stock ? "📦 目前庫存：" + item.stock + "\n" : "") +
    (item.promoText ? "📢 促銷說明：" + item.promoText + "\n" : "") +
    "🕒 時間：" + Utilities.formatDate(new Date(item.createdAt || new Date()), "GMT+8", "yyyy-MM-dd HH:mm") + "\n\n" +
    "💡 提示：這筆預留通知若您已處理，回覆「好 / 收到 / OK」即可停止後續提醒。";
}

// 輔助功能：追蹤顧客是否連續 3 次查詢相同的搜尋內容（同編號、同數量）
function updateExactQueryTracker(senderUserId, userMessage) {
  if (!senderUserId || senderUserId === "N/A") return 0;
  
  // 標準化整個訊息作為比對基礎 (例如 "eq172110000")
  var normalizedQuery = normalizeSearchKey(userMessage);
  if (!normalizedQuery || normalizedQuery.length < 2) return 0;
  
  var cache = CacheService.getScriptCache();
  var lastQuery = cache.get("last_exact_query_" + senderUserId);
  var count = parseInt(cache.get("exact_query_count_" + senderUserId) || "0");
  
  if (lastQuery === normalizedQuery) {
    count += 1;
  } else {
    count = 1;
    cache.put("last_exact_query_" + senderUserId, normalizedQuery, 1800); // 30 分鐘
  }
  
  cache.put("exact_query_count_" + senderUserId, count.toString(), 1800); // 30 分鐘
  return count;
}

// 輔助函數：判斷是否為型號查詢格式 (例如 EQ-1724, 7A24, PP3508)
function isLikelyModelQuery(str) {
  if (!str) return false;
  var clean = str.trim();
  
  // 型號格式特徵：英文開頭接數字，或數字接英文 (例如 EQ-1724, IB2312, 7A24)
  var modelPattern = /[a-zA-Z]+-?\d+/i;
  var numericPattern = /^\d+$/; // 純數字
  var alphanumericPattern = /^[a-zA-Z0-9]+$/; // 短代碼
  
  if (modelPattern.test(clean) || numericPattern.test(clean)) {
    return true;
  }
  if (clean.length <= 10 && alphanumericPattern.test(clean)) {
    return true;
  }
  return false;
}

// 全域函數：提取型號代碼並進行標準化，用以比對商品代碼（忽略顏色、修飾字等）
function getModelCodeKey(modelStr) {
  if (!modelStr) return "";
  var codeMatch = modelStr.toString().trim().match(/^([a-zA-Z0-9\-_/\.]+)/);
  return codeMatch ? normalizeSearchKey(codeMatch[1]) : normalizeSearchKey(modelStr);
}

// 一次性讀取整個庫存查詢表，建立記憶體內部的型號對照表 (Hash Map) 以極大化提升效能
function getLiveStockMap(ss) {
  var stockMap = {};
  if (!ss) return stockMap;
  var values;
  values = getInventoryValues(ss);
  if (!values) return stockMap;
  if (values.length <= 1) return stockMap;
  
  var headers = values[0];
  var idxModel = -1;
  var idxStock = -1;
  var idxAvailable = -1;
  var idxReserved = -1;
  
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] == null) continue;
    var h = headers[i].toString().replace(/\s+/g, '');
    if (h.indexOf("編號") !== -1 || h.indexOf("型號") !== -1 || h.indexOf("品名") !== -1) {
      idxModel = i;
    }
    if (h.indexOf("可用庫存") !== -1 || h.indexOf("可用") !== -1) idxAvailable = i;
    else if (h.indexOf("庫存") !== -1) idxStock = i;
    if (h.indexOf("保留") !== -1) idxReserved = i;
  }
  if (idxModel === -1) idxModel = 0;
  
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row || row.length === 0) continue;
    var modelVal = row[idxModel] ? row[idxModel].toString().trim() : "";
    var targetKey = getModelCodeKey(modelVal);
    if (!targetKey) continue;
    
    var stock = getAvailableStock_(row, idxStock, idxAvailable, idxReserved);
    if (stockMap[targetKey] === undefined) {
      stockMap[targetKey] = 0;
    }
    stockMap[targetKey] += stock;
  }
  return stockMap;
}

// 核心對接：讀取試算表中指定 ID (gid=539717015) 的促銷商品分頁，並篩選內含「促銷」字樣的商品
function getPromotionalProducts() {
  var ssId = "1C_R1DdTj5brxftl9fPabTKBGzcG-lxWWxWoyi-ItA48";
  var ss = SpreadsheetApp.openById(ssId);
  var sheet = null;
  var sheets = ss.getSheets();
  
  // 透過 sheetId (gid) 精準比對尋找分頁
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === 539717015) {
      sheet = sheets[i];
      break;
    }
  }
  
  // 如果找不到，模糊匹配分頁名稱含「促銷」的分頁，最後再退回「庫存查詢表」
  if (!sheet) {
    var allSheets = ss.getSheets();
    for (var i = 0; i < allSheets.length; i++) {
      if (allSheets[i].getName().indexOf("促銷") !== -1) {
        sheet = allSheets[i];
        break;
      }
    }
  }
  if (!sheet) {
    sheet = ss.getSheetByName("庫存查詢表");
  }
  if (!sheet) return [];
  
  var values = getInventoryValues(ss);
  if (!values || values.length <= 1) return [];
  
  var headers = values[0];
  var idxModel = -1;
  var idxSeries = -1;
  
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] == null) continue;
    var h = headers[i].toString().replace(/\s+/g, '');
    if (h.indexOf("編號") !== -1 || h.indexOf("型號") !== -1 || h.indexOf("品名") !== -1) {
      idxModel = i;
    }
    if (h.indexOf("系列") !== -1) {
      idxSeries = i;
    }
  }
  
  if (idxModel === -1) idxModel = 0; // 防呆
  
  // 核心效能優化：一次性讀取庫存對照表，建立記憶體內部的雜湊對照表 (Hash Map)
  var stockMap = getLiveStockMap(ss);
  
  var promoItems = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row || row.length === 0) continue;
    
    var model = row[idxModel] ? row[idxModel].toString().trim() : "";
    if (!model) continue;
    
    var series = (idxSeries !== -1 && row[idxSeries]) ? row[idxSeries].toString().trim() : "";
    
    // 檢查該行是否包含「促銷」關鍵字
    var isPromo = false;
    var promoText = "";
    for (var c = 0; c < row.length; c++) {
      var cellVal = row[c] ? row[c].toString().trim() : "";
      if (cellVal !== "" && cellVal.indexOf("促銷") !== -1) {
        isPromo = true;
        promoText = cellVal;
        break;
      }
    }
    
    if (isPromo) {
      // O(1) 記憶體極速比對
      var targetKey = getModelCodeKey(model);
      var stockVal = (targetKey && stockMap[targetKey] !== undefined) ? stockMap[targetKey] : 0;
      
      promoItems.push({
        model: model,
        series: series,
        promoText: promoText,
        stock: stockVal
      });
    }
  }
  return promoItems;
}

// 格式化並輸出促銷清單 (支援系列折疊目錄)
function searchPromotionalProducts(query, senderUserId) {
  try {
    var items = getPromotionalProducts();
    if (items.length === 0) {
      return "客倌 🌸 目前系統中沒有查到標記有「促銷」的特惠商品喔！\n如果有其他商品需要查詢，隨時都可以直接輸入型號查詢喔！🥰";
    }
    
    // 將所有商品依「系列」分組
    var groups = {};
    for (var i = 0; i < items.length; i++) {
      var s = items[i].series || "其他特惠促銷";
      if (!groups[s]) groups[s] = [];
      groups[s].push(items[i]);
    }
    
    var seriesNames = Object.keys(groups);
    var cleanQuery = query ? query.toString().trim() : "";
    
    // 如果沒有輸入特定的查詢系列，顯示簡潔的折疊目錄大綱
    if (!cleanQuery) {
      var replyText = "✨🎁 勁揚建材 - 特惠促銷系列目錄 🎁✨\n";
      replyText += "━━━━━━━━━━━━━━━━━━━━\n";
      for (var i = 0; i < seriesNames.length; i++) {
        var sName = seriesNames[i];
        replyText += "📂 " + sName + " (" + groups[sName].length + " 筆商品)\n";
      }
      replyText += "━━━━━━━━━━━━━━━━━━━━\n";
      replyText += "💡 您可以直接輸入「系列名稱」（例如：星月六角）展開查看該系列的商品庫存與促銷內容喔！🥰\n\n";
      replyText += "🌐 您也可以點擊下方「網頁版折疊目錄」按鈕，在手機上直接瀏覽折疊式商品目錄！🫱🪪";
      
      // 建立 Buttons Template
      var webAppUrl = getPromoWebAppUrl_(senderUserId);
      var actions = [
        {
          "type": "uri",
          "label": "🌐 網頁版折疊目錄",
          "uri": webAppUrl
        }
      ];
      
      // 加入前 3 個系列的點擊快速展開按鈕
      var maxButtons = Math.min(seriesNames.length, 3);
      for (var i = 0; i < maxButtons; i++) {
        actions.push({
          "type": "message",
          "label": "👉 " + seriesNames[i],
          "text": seriesNames[i]
        });
      }
      
      var messages = [
        { "type": "text", "text": replyText },
        {
          "type": "template",
          "altText": "促銷商品目錄選單",
          "template": {
            "type": "buttons",
            "text": "👇 點擊下方以快速展開系列或瀏覽網頁：",
            "actions": actions
          }
        }
      ];
      return messages;
    }
    
    // 若有輸入查詢內容，進行系列名稱匹配
    var matchedSeriesName = "";
    var normQuery = normalizeSearchKey(cleanQuery);
    for (var i = 0; i < seriesNames.length; i++) {
      if (normalizeSearchKey(seriesNames[i]) === normQuery) {
        matchedSeriesName = seriesNames[i];
        break;
      }
    }
    if (matchedSeriesName === "" && normQuery.length >= 2) {
      for (var i = 0; i < seriesNames.length; i++) {
        if (normalizeSearchKey(seriesNames[i]).indexOf(normQuery) !== -1) {
          matchedSeriesName = seriesNames[i];
          break;
        }
      }
    }
    
    // 如果找不到匹配的系列，回覆提示
    if (!matchedSeriesName) {
      return "找不到系列「" + cleanQuery + "」的促銷商品。您可以輸入「查看促銷」取得完整系列目錄，或直接輸入型號（如 EQ-1721）查詢商品庫存喔！🥰";
    }
    
    // 展開該系列的商品明細
    var groupItems = groups[matchedSeriesName];
    var replyText = "✨🎁 「" + matchedSeriesName + "」系列 - 特惠促銷商品 🎁✨\n";
    replyText += "━━━━━━━━━━━━━━━━━━━━\n";
    
    for (var i = 0; i < groupItems.length; i++) {
      var item = groupItems[i];
      replyText += "🌸 商品編號：" + item.model + "\n";
      var unit = getUnit(item.series);
      replyText += "📦 可用庫存：" + item.stock + " " + unit + "\n";
      replyText += "📢 促銷說明：" + item.promoText + "\n";
      replyText += "━━━━━━━━━━━━━━━━━━━━\n";
    }
    
    replyText += "💡 溫馨提醒：特惠商品數量有限！如果有中意的商品，可以直接輸入「型號 + 預留」（例如：" + groupItems[0].model + " 預留），或回覆「是」聯絡小姐幫您保留喔！🫱🪪";
    return replyText;
    
  } catch (e) {
    return "讀取促銷商品資料出錯：" + e.toString();
  }
}

// 💡 輔助函數：模糊匹配型號候選清單 (海納百川容錯，對高齡/輸入不便者極度友善)
function findFuzzyModelCandidates(cleanInput, data, idxModel) {
  // 1. 移除非字母數字的字元，轉為小寫
  var normInput = cleanInput.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  // 2. 提取輸入中的所有數字序列（長度為 3 到 5 位）
  var numbers = cleanInput.match(/\d{3,5}/g);
  if (!numbers) {
    var cleanDigits = normInput.match(/\d{3,5}/g);
    if (cleanDigits) {
      numbers = cleanDigits;
    }
  }
  
  if (!numbers || numbers.length === 0) {
    return [];
  }
  
  var candidates = [];
  var seenModels = {};
  
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (!row || row.length === 0) continue;
    var modelVal = row[idxModel] ? row[idxModel].toString().trim() : "";
    if (modelVal === "") continue;
    
    // 提取該型號的編號部分並標準化
    var modelCode = getModelCodeKey(modelVal);
    if (!modelCode || seenModels[modelCode]) continue;
    seenModels[modelCode] = true;
    
    var normModel = modelCode.toLowerCase();
    
    // 檢查此型號是否包含輸入中的任一數字
    var hasNumberMatch = false;
    for (var n = 0; n < numbers.length; n++) {
      if (normModel.indexOf(numbers[n]) !== -1) {
        hasNumberMatch = true;
        break;
      }
    }
    
    if (hasNumberMatch) {
      // 計算字母比對分數
      var queryLetters = normInput.replace(/[0-9]/g, "");
      var modelLetters = normModel.replace(/[0-9]/g, "");
      
      var letterScore = 0;
      for (var l = 0; l < modelLetters.length; l++) {
        if (queryLetters.indexOf(modelLetters[l]) !== -1) {
          letterScore++;
        }
      }
      
      candidates.push({
        model: modelVal,
        code: modelCode,
        row: row,
        score: letterScore
      });
    }
  }
  
  // 依字母比對分數從高到低排序
  candidates.sort(function(a, b) {
    return b.score - a.score;
  });
  
  return candidates;
}

function getPromoWebAppUrl_(senderUserId) {
  var suffix = "?page=promo";
  if (senderUserId && senderUserId !== "N/A") {
    suffix += "&userId=" + encodeURIComponent(senderUserId);
  }
  try {
    var baseUrl = ScriptApp.getService().getUrl();
    if (baseUrl) {
      return baseUrl.replace(/\/$/, "") + suffix;
    }
  } catch (err) {
    console.warn("getPromoWebAppUrl_ fallback: " + err.toString());
  }
  return "https://script.google.com/macros/s/AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw/exec" + suffix;
}

// 寫入客戶預留紀錄至 Google 試算表
function writeReserveToSheet_(item) {
  var ssId = "1C_R1DdTj5brxftl9fPabTKBGzcG-lxWWxWoyi-ItA48";
  var timeStr = Utilities.formatDate(new Date(item.createdAt), "GMT+8", "yyyy-MM-dd HH:mm:ss");
  var custStr = item.customerName || (item.userId ? "ID: " + item.userId : "未填寫");
  
  ReservationRepository_appendReserveRecord(ssId, [
    timeStr,
    custStr,
    item.model || "",
    item.series || "",
    item.stock || "",
    item.promoText || ""
  ], 100);
}

// ==========================================
// 助理工作中心 (Assistant Work Center) 核心功能
// ==========================================

function handleAssistantPostback_(event) {
  var replyToken = event.replyToken;
  var lineUserId = event.source && event.source.userId ? event.source.userId : "";
  var userContext = getLineUserContext(lineUserId);
  var operatorName = userContext.displayName || userContext.username || "助理";
  var operatorRole = userContext.role;

  var postbackData = event.postback.data;
  var params = parseQueryString_(postbackData);
  var action = params.action;
  if (!action) return false;

  if (operatorRole === "boss" && action !== "view_blocked_reason" && action !== "assistant_show_abnormal") {
    replyToLine(replyToken, "主管帳戶為唯讀權限，無法修改或操作工作項目。", true);
    return true;
  }

  if (action === "assistant_start_flow") {
    var tasks = getAssistantTasks_();
    var activeTasks = tasks.filter(function(t) {
      return t.assignedRole === "assistant" && ["Created", "Started", "Waiting", "Blocked"].includes(t.status);
    });
    if (activeTasks.length === 0) {
      replyToLine(replyToken, "目前沒有待處理的工作，辛苦了！", true);
      return true;
    }
    
    var sorted = getSortedTasks_(activeTasks);
    var topTask = sorted[0];
    
    var fromStatus = topTask.status;
    if (topTask.status === "Created") {
      topTask.status = "Started";
      topTask.startedAt = new Date().toISOString();
      topTask.updatedAt = new Date().toISOString();
      topTask.updatedBy = operatorName;
      updateTaskInSheet_(topTask);
      appendAuditLog_(topTask.id, "assistant_work_started", operatorName, operatorRole, fromStatus, "Started", "開始處理最高優先工作");
    }
    
    var cardMsg = buildSingleTaskCard_(topTask, userContext);
    replyToLine(replyToken, cardMsg, true);
    return true;
  }

  if (action === "change_status") {
    var id = params.id;
    var to = params.to;
    var task = getTaskById_(id);
    if (!task) {
      replyToLine(replyToken, "找不到該工作項目。", true);
      return true;
    }
    var fromStatus = task.status;
    task.status = to;
    if (to === "Started" && !task.startedAt) {
      task.startedAt = new Date().toISOString();
    }
    task.updatedAt = new Date().toISOString();
    task.updatedBy = operatorName;
    updateTaskInSheet_(task);
    
    var actionName = "assistant_work_started";
    if (to === "Finished") actionName = "assistant_work_finished";
    else if (to === "Cancelled") actionName = "assistant_work_cancelled";
    appendAuditLog_(task.id, actionName, operatorName, operatorRole, fromStatus, to, "狀態變更為 " + to);
    
    var cardMsg = buildSingleTaskCard_(task, userContext);
    replyToLine(replyToken, cardMsg, true);
    return true;
  }

  if (action === "missing_data_flow") {
    var id = params.id;
    var task = getTaskById_(id);
    if (!task) {
      replyToLine(replyToken, "找不到該工作項目。", true);
      return true;
    }
    
    var qItems = [
      { type: "action", action: { type: "postback", label: "缺客戶資料", data: "action=missing_data_select&id=" + id + "&reason=" + encodeURIComponent("缺客戶資料"), displayText: "缺客戶資料" } },
      { type: "action", action: { type: "postback", label: "缺商品型號", data: "action=missing_data_select&id=" + id + "&reason=" + encodeURIComponent("缺商品型號"), displayText: "缺商品型號" } },
      { type: "action", action: { type: "postback", label: "缺數量", data: "action=missing_data_select&id=" + id + "&reason=" + encodeURIComponent("缺數量"), displayText: "缺數量" } },
      { type: "action", action: { type: "postback", label: "缺送貨日期", data: "action=missing_data_select&id=" + id + "&reason=" + encodeURIComponent("缺送貨日期"), displayText: "缺送貨日期" } },
      { type: "action", action: { type: "postback", label: "缺送貨地址", data: "action=missing_data_select&id=" + id + "&reason=" + encodeURIComponent("缺送貨地址"), displayText: "缺送貨地址" } },
      { type: "action", action: { type: "postback", label: "缺加工尺寸", data: "action=missing_data_select&id=" + id + "&reason=" + encodeURIComponent("缺加工尺寸"), displayText: "缺加工尺寸" } },
      { type: "action", action: { type: "postback", label: "其他原因", data: "action=missing_data_other&id=" + id, displayText: "其他原因" } }
    ];
    
    replyToLine(replyToken, {
      type: "text",
      text: "請選擇缺少的資料類型：",
      quickReply: { items: qItems }
    }, true);
    return true;
  }

  if (action === "missing_data_select") {
    var id = params.id;
    var reason = params.reason;
    var task = getTaskById_(id);
    if (!task) {
      replyToLine(replyToken, "找不到該工作項目。", true);
      return true;
    }
    
    var fromStatus = task.status;
    task.status = "Waiting";
    task.blockedReason = reason;
    task.updatedAt = new Date().toISOString();
    task.updatedBy = operatorName;
    updateTaskInSheet_(task);
    
    var creatorLineId = findUserLineId_(task.createdBy);
    if (creatorLineId) {
      var ok = sendLinePushMessage_(creatorLineId, "🔔 助理通知：您交辦的工作「" + task.title + "」缺少資料，原因：【" + reason + "】，請儘速補齊資料！");
      appendAuditLog_(task.id, ok ? "assistant_notification_sent" : "assistant_notification_failed", operatorName, operatorRole, fromStatus, "Waiting", "通知交辦人：" + task.createdBy);
    } else {
      appendAuditLog_(task.id, "assistant_notification_failed", operatorName, operatorRole, fromStatus, "Waiting", "找不到交辦人：" + task.createdBy);
    }
    
    appendAuditLog_(task.id, "assistant_work_waiting", operatorName, operatorRole, fromStatus, "Waiting", reason);
    replyToLine(replyToken, "已將狀態標記為【等待中】，並通知交辦人！", true);
    return true;
  }

  if (action === "missing_data_other") {
    var id = params.id;
    CacheService.getScriptCache().put("state_" + lineUserId, "waiting_missing_" + id, 300);
    replyToLine(replyToken, "請直接輸入缺少資料的說明（或輸入「取消」）：", true);
    return true;
  }

  if (action === "problem_flow") {
    var id = params.id;
    var qItems = [
      { type: "action", action: { type: "postback", label: "庫存不足", data: "action=problem_select&id=" + id + "&reason=" + encodeURIComponent("庫存不足"), displayText: "庫存不足" } },
      { type: "action", action: { type: "postback", label: "保留衝突", data: "action=problem_select&id=" + id + "&reason=" + encodeURIComponent("保留衝突"), displayText: "保留衝突" } },
      { type: "action", action: { type: "postback", label: "加工異常", data: "action=problem_select&id=" + id + "&reason=" + encodeURIComponent("加工異常"), displayText: "加工異常" } },
      { type: "action", action: { type: "postback", label: "送貨無法安排", data: "action=problem_select&id=" + id + "&reason=" + encodeURIComponent("送貨無法安排"), displayText: "送貨無法安排" } },
      { type: "action", action: { type: "postback", label: "客戶資料錯誤", data: "action=problem_select&id=" + id + "&reason=" + encodeURIComponent("客戶資料錯誤"), displayText: "客戶資料錯誤" } },
      { type: "action", action: { type: "postback", label: "價格／訂單問題", data: "action=problem_select&id=" + id + "&reason=" + encodeURIComponent("價格／訂單問題"), displayText: "價格／訂單問題" } },
      { type: "action", action: { type: "postback", label: "其他原因", data: "action=problem_other&id=" + id, displayText: "其他原因" } }
    ];
    replyToLine(replyToken, {
      type: "text",
      text: "請選擇發生的問題類型：",
      quickReply: { items: qItems }
    }, true);
    return true;
  }

  if (action === "problem_select") {
    var id = params.id;
    var reason = params.reason;
    var task = getTaskById_(id);
    if (!task) {
      replyToLine(replyToken, "找不到該工作項目。", true);
      return true;
    }
    
    var fromStatus = task.status;
    task.status = "Blocked";
    task.blockedReason = reason;
    task.updatedAt = new Date().toISOString();
    task.updatedBy = operatorName;
    updateTaskInSheet_(task);
    
    var creatorLineId = findUserLineId_(task.createdBy);
    if (creatorLineId) {
      sendLinePushMessage_(creatorLineId, "⚠️ 助理通知：您交辦的工作「" + task.title + "」發生問題：【" + reason + "】！");
    }
    if (task.priority === "urgent") {
      notifyBosses_("🚨 緊急工作異常通知：由 " + task.createdBy + " 交辦的「" + task.title + "」發生問題：【" + reason + "】，請協助處理！");
    }
    
    appendAuditLog_(task.id, "assistant_work_blocked", operatorName, operatorRole, fromStatus, "Blocked", reason);
    replyToLine(replyToken, "已將工作標記為【已異常】，並通知相關人員！", true);
    return true;
  }

  if (action === "problem_other") {
    var id = params.id;
    CacheService.getScriptCache().put("state_" + lineUserId, "waiting_problem_" + id, 300);
    replyToLine(replyToken, "請直接輸入問題的說明（或輸入「取消」）：", true);
    return true;
  }

  if (action === "complete_flow") {
    var id = params.id;
    var qItems = [
      { type: "action", action: { type: "postback", label: "通知交辦人", data: "action=complete_notify&id=" + id + "&notify=true", displayText: "通知交辦人" } },
      { type: "action", action: { type: "postback", label: "不用通知", data: "action=complete_notify&id=" + id + "&notify=false", displayText: "不用通知" } },
      { type: "action", action: { type: "postback", label: "完成並處理下一件", data: "action=complete_notify&id=" + id + "&notify=next", displayText: "完成並處理下一件" } }
    ];
    replyToLine(replyToken, {
      type: "text",
      text: "工作已完成，是否需要通知交辦人？",
      quickReply: { items: qItems }
    }, true);
    return true;
  }

  if (action === "complete_notify") {
    var id = params.id;
    var notify = params.notify;
    var task = getTaskById_(id);
    if (!task) {
      replyToLine(replyToken, "找不到該工作項目。", true);
      return true;
    }
    
    var fromStatus = task.status;
    task.status = "Finished";
    task.completedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    task.updatedBy = operatorName;
    updateTaskInSheet_(task);
    
    appendAuditLog_(task.id, "assistant_work_finished", operatorName, operatorRole, fromStatus, "Finished", "完成工作");
    
    if (notify === "true" || notify === "next") {
      var creatorLineId = findUserLineId_(task.createdBy);
      if (creatorLineId) {
        var msg = "✅ 助理通知：您交辦的「" + (task.customerName ? task.customerName + "－" : "") + task.title + "」已完成。";
        sendLinePushMessage_(creatorLineId, msg);
      }
    }
    
    if (notify === "next") {
      var tasks = getAssistantTasks_();
      var activeTasks = tasks.filter(function(t) {
        return t.assignedRole === "assistant" && ["Created", "Started", "Waiting", "Blocked"].includes(t.status);
      });
      if (activeTasks.length === 0) {
        replyToLine(replyToken, "工作已標記為【已完成】並發出通知！目前已無其他待處理工作，辛苦了！", true);
        return true;
      }
      var sorted = getSortedTasks_(activeTasks);
      var topTask = sorted[0];
      
      var topFrom = topTask.status;
      if (topTask.status === "Created") {
        topTask.status = "Started";
        topTask.startedAt = new Date().toISOString();
        topTask.updatedAt = new Date().toISOString();
        topTask.updatedBy = operatorName;
        updateTaskInSheet_(topTask);
        appendAuditLog_(topTask.id, "assistant_work_started", operatorName, operatorRole, topFrom, "Started", "完成上筆後自動開始處理下一件");
      }
      
      var cardMsg = buildSingleTaskCard_(topTask, userContext);
      replyToLine(replyToken, cardMsg, true);
      return true;
    } else {
      replyToLine(replyToken, "工作已標記為【已完成】！", true);
      return true;
    }
  }

  if (action === "reassign_flow") {
    var id = params.id;
    var users = JingyangAssistant_readUsers_() || [];
    var staffUsers = users.filter(function(u) {
      return ["assistant", "retailSales", "showroomSales"].includes(u.role) && u.status !== "disabled";
    });
    
    var qItems = staffUsers.slice(0, 13).map(function(u) {
      var uName = u.displayName || u.username;
      return {
        type: "action",
        action: {
          type: "postback",
          label: uName,
          data: "action=reassign_select&id=" + id + "&to=" + encodeURIComponent(uName),
          displayText: "轉交給 " + uName
        }
      };
    });
    
    replyToLine(replyToken, {
      type: "text",
      text: "請選擇轉指派的同仁：",
      quickReply: { items: qItems }
    }, true);
    return true;
  }

  if (action === "reassign_select") {
    var id = params.id;
    var to = params.to;
    var task = getTaskById_(id);
    if (!task) {
      replyToLine(replyToken, "找不到該工作項目。", true);
      return true;
    }
    
    var fromStatus = task.status;
    task.assignedTo = to;
    task.updatedAt = new Date().toISOString();
    task.updatedBy = operatorName;
    updateTaskInSheet_(task);
    
    appendAuditLog_(task.id, "assistant_work_reassigned", operatorName, operatorRole, fromStatus, task.status, "轉交給 " + to);
    
    var targetLineId = findUserLineId_(to);
    if (targetLineId) {
      sendLinePushMessage_(targetLineId, "🔔 工作轉交通知：助理 " + operatorName + " 將工作「" + task.title + "」轉交給您處理！");
    }
    
    replyToLine(replyToken, "工作已轉交給 " + to + "！", true);
    return true;
  }

  if (action === "add_note_flow") {
    var id = params.id;
    CacheService.getScriptCache().put("state_" + lineUserId, "waiting_note_" + id, 300);
    replyToLine(replyToken, "請輸入要追加的備註備記（或輸入「取消」）：", true);
    return true;
  }

  if (action === "notify_boss_flow") {
    var id = params.id;
    var task = getTaskById_(id);
    if (!task) {
      replyToLine(replyToken, "找不到該工作項目。", true);
      return true;
    }
    notifyBosses_("🔔 助理提請主管協助處理工作：由 " + task.createdBy + " 交辦的「" + task.title + "」目前遭遇問題！備註：" + (task.blockedReason || "無"));
    replyToLine(replyToken, "已向主管發送提醒通知！", true);
    return true;
  }

  if (action === "remind_creator") {
    var id = params.id;
    var task = getTaskById_(id);
    if (!task) {
      replyToLine(replyToken, "找不到該工作項目。", true);
      return true;
    }
    var creatorLineId = findUserLineId_(task.createdBy);
    if (creatorLineId) {
      sendLinePushMessage_(creatorLineId, "🔔 助理提醒您：您交辦的工作「" + task.title + "」目前處於【等待中】狀態，請儘快補齊資料！");
    }
    replyToLine(replyToken, "已向交辦人發送提醒！", true);
    return true;
  }

  if (action === "view_blocked_reason") {
    var id = params.id;
    var task = getTaskById_(id);
    if (!task) {
      replyToLine(replyToken, "找不到該工作項目。", true);
      return true;
    }
    replyToLine(replyToken, "⚠️ 此工作異常原因為：\n" + (task.blockedReason || "未註明原因"), true);
    return true;
  }

  if (action === "cancel_flow") {
    var id = params.id;
    var task = getTaskById_(id);
    if (!task) {
      replyToLine(replyToken, "找不到該工作項目。", true);
      return true;
    }
    
    if (!/^(admin|boss)$/.test(operatorRole) && task.createdBy !== operatorName) {
      replyToLine(replyToken, "權限不足！只有主管、管理員或該工作建立人可以取消此工作。", true);
      return true;
    }
    
    var fromStatus = task.status;
    task.status = "Cancelled";
    task.updatedAt = new Date().toISOString();
    task.updatedBy = operatorName;
    updateTaskInSheet_(task);
    
    appendAuditLog_(task.id, "assistant_work_cancelled", operatorName, operatorRole, fromStatus, "Cancelled", "取消工作");
    replyToLine(replyToken, "工作已成功取消。", true);
    return true;
  }

  return false;
}

function buildSingleTaskCard_(task, userContext) {
  var typeLabel = mapTypeToChinese_(task.type);
  var statusLabel = task.status;
  if (task.status === "Created") statusLabel = "已建立";
  else if (task.status === "Started") statusLabel = "執行中";
  else if (task.status === "Waiting") statusLabel = "等待中";
  else if (task.status === "Finished") statusLabel = "已完成";
  else if (task.status === "Blocked") statusLabel = "已異常";
  else if (task.status === "Cancelled") statusLabel = "已取消";

  var cardText = "【助理工作卡】\n" +
                 "━━━━━━━━━━━━━━━━━━━━\n" +
                 "📌 工作類型：" + typeLabel + "\n" +
                 "👤 客戶名稱：" + (task.customerName || "無") + "\n" +
                 "📦 商品/數量：" + (task.productName || "無") + " x " + (task.quantity || 1) + "\n" +
                 "✍️ 交辦人：" + (task.createdBy || "系統") + (task.sourceRole ? " (" + task.sourceRole + ")" : "") + "\n" +
                 "📅 到期日：" + (task.dueDate || "無") + "\n" +
                 "💡 目前狀態：" + statusLabel + "\n" +
                 "📝 備註：" + (task.note || "無") + "\n";
  if (task.blockedReason) {
    cardText += "⚠️ 異常說明：" + task.blockedReason + "\n";
  }
  cardText += "━━━━━━━━━━━━━━━━━━━━";

  var isReadOnly = (userContext.role === "boss");
  if (isReadOnly) {
    return cardText + "\n(主管唯讀模式，不可編輯/修改)";
  }

  var qItems = [];
  if (task.status === "Created") {
    qItems = [
      { type: "action", action: { type: "postback", label: "開始處理", data: "action=change_status&id=" + task.id + "&to=Started", displayText: "開始處理" } },
      { type: "action", action: { type: "postback", label: "缺少資料", data: "action=missing_data_flow&id=" + task.id, displayText: "缺少資料" } },
      { type: "action", action: { type: "postback", label: "轉交", data: "action=reassign_flow&id=" + task.id, displayText: "轉交" } },
      { type: "action", action: { type: "postback", label: "取消", data: "action=cancel_flow&id=" + task.id, displayText: "取消工作" } }
    ];
  } else if (task.status === "Started") {
    qItems = [
      { type: "action", action: { type: "postback", label: "完成", data: "action=complete_flow&id=" + task.id, displayText: "完成" } },
      { type: "action", action: { type: "postback", label: "等待回覆", data: "action=missing_data_flow&id=" + task.id, displayText: "等待回覆" } },
      { type: "action", action: { type: "postback", label: "發生問題", data: "action=problem_flow&id=" + task.id, displayText: "發生問題" } },
      { type: "action", action: { type: "postback", label: "補充備註", data: "action=add_note_flow&id=" + task.id, displayText: "補充備註" } }
    ];
  } else if (task.status === "Waiting") {
    qItems = [
      { type: "action", action: { type: "postback", label: "重新處理", data: "action=change_status&id=" + task.id + "&to=Started", displayText: "重新處理" } },
      { type: "action", action: { type: "postback", label: "完成", data: "action=complete_flow&id=" + task.id, displayText: "完成" } },
      { type: "action", action: { type: "postback", label: "提醒交辦人", data: "action=remind_creator&id=" + task.id, displayText: "提醒交辦人" } },
      { type: "action", action: { type: "postback", label: "補充備註", data: "action=add_note_flow&id=" + task.id, displayText: "補充備註" } }
    ];
  } else if (task.status === "Blocked") {
    qItems = [
      { type: "action", action: { type: "postback", label: "查看問題", data: "action=view_blocked_reason&id=" + task.id, displayText: "查看問題" } },
      { type: "action", action: { type: "postback", label: "已排除", data: "action=change_status&id=" + task.id + "&to=Started", displayText: "已排除" } },
      { type: "action", action: { type: "postback", label: "通知主管", data: "action=notify_boss_flow&id=" + task.id, displayText: "通知主管" } },
      { type: "action", action: { type: "postback", label: "補充備註", data: "action=add_note_flow&id=" + task.id, displayText: "補充備註" } }
    ];
  }

  if (qItems.length === 0) {
    return cardText;
  }

  return {
    type: "text",
    text: cardText,
    quickReply: { items: qItems }
  };
}

function updateTaskInSheet_(task) {
  try {
    var ssId = JingyangAssistant_getSpreadsheetId_();
    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName("工作任務");
    if (!sheet) return false;
    var values = sheet.getDataRange().getValues();
    var headers = values[0].map(function(h) { return String(h || "").trim(); });
    
    var idColIndex = headers.indexOf("id");
    if (idColIndex === -1) return false;
    
    var rowIndex = -1;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][idColIndex]) === String(task.id)) {
        rowIndex = i + 1;
        break;
      }
    }
    
    if (rowIndex === -1) {
      var newRow = headers.map(function(h) { return task[h] ?? ""; });
      sheet.appendRow(newRow);
      return true;
    } else {
      headers.forEach(function(header, index) {
        var val = task[header] ?? "";
        sheet.getRange(rowIndex, index + 1).setValue(val);
      });
      return true;
    }
  } catch (err) {
    Logger.log("updateTaskInSheet_ failed: " + err.toString());
    return false;
  }
}

function checkActiveDialogState_(lineUserId, userMessage, replyToken) {
  var cache = CacheService.getScriptCache();
  var stateKey = "state_" + lineUserId;
  var stateVal = cache.get(stateKey);
  if (!stateVal) return false;
  
  if (userMessage === "取消") {
    cache.remove(stateKey);
    replyToLine(replyToken, "操作已取消。", true);
    return true;
  }
  
  var parts = stateVal.split("_");
  var action = parts[0];
  var type = parts[1];
  var taskId = stateVal.slice(action.length + 1 + type.length + 1);
  
  if (action === "waiting" && type === "missing") {
    var task = getTaskById_(taskId);
    if (!task) {
      cache.remove(stateKey);
      return false;
    }
    var fromStatus = task.status;
    task.status = "Waiting";
    task.blockedReason = userMessage;
    task.updatedAt = new Date().toISOString();
    var userContext = getLineUserContext(lineUserId);
    task.updatedBy = userContext.displayName || userContext.username || "助理";
    updateTaskInSheet_(task);
    
    var creatorLineId = findUserLineId_(task.createdBy);
    if (creatorLineId) {
      var ok = sendLinePushMessage_(creatorLineId, "🔔 助理通知：您交辦的工作「" + task.title + "」缺少資料，原因：【" + userMessage + "】，請儘速補齊資料！");
      appendAuditLog_(task.id, ok ? "assistant_notification_sent" : "assistant_notification_failed", task.updatedBy, userContext.role, fromStatus, "Waiting", "通知交辦人：" + task.createdBy);
    } else {
      appendAuditLog_(task.id, "assistant_notification_failed", task.updatedBy, userContext.role, fromStatus, "Waiting", "找不到交辦人：" + task.createdBy);
    }
    
    appendAuditLog_(task.id, "assistant_work_waiting", task.updatedBy, userContext.role, fromStatus, "Waiting", userMessage);
    cache.remove(stateKey);
    replyToLine(replyToken, "已將狀態標記為【等待中】，並通知交辦人！", true);
    return true;
  }
  
  if (action === "waiting" && type === "problem") {
    var task = getTaskById_(taskId);
    if (!task) {
      cache.remove(stateKey);
      return false;
    }
    var fromStatus = task.status;
    task.status = "Blocked";
    task.blockedReason = userMessage;
    task.updatedAt = new Date().toISOString();
    var userContext = getLineUserContext(lineUserId);
    task.updatedBy = userContext.displayName || userContext.username || "助理";
    updateTaskInSheet_(task);
    
    var creatorLineId = findUserLineId_(task.createdBy);
    if (creatorLineId) {
      sendLinePushMessage_(creatorLineId, "⚠️ 助理通知：您交辦的工作「" + task.title + "」發生問題：【" + userMessage + "】！");
    }
    if (task.priority === "urgent") {
      notifyBosses_("🚨 緊急工作異常通知：由 " + task.createdBy + " 交辦的「" + task.title + "」發生問題：【" + userMessage + "】，請協助處理！");
    }
    
    appendAuditLog_(task.id, "assistant_work_blocked", task.updatedBy, userContext.role, fromStatus, "Blocked", userMessage);
    cache.remove(stateKey);
    replyToLine(replyToken, "已將工作標記為【已異常】，並通知相關人員！", true);
    return true;
  }
  
  if (action === "waiting" && type === "note") {
    var task = getTaskById_(taskId);
    if (!task) {
      cache.remove(stateKey);
      return false;
    }
    task.note = (task.note ? task.note + "\n" : "") + userMessage;
    task.updatedAt = new Date().toISOString();
    var userContext = getLineUserContext(lineUserId);
    task.updatedBy = userContext.displayName || userContext.username || "助理";
    updateTaskInSheet_(task);
    
    appendAuditLog_(task.id, "assistant_add_note", task.updatedBy, userContext.role, task.status, task.status, userMessage);
    cache.remove(stateKey);
    replyToLine(replyToken, "備註已成功追加！", true);
    return true;
  }
  
  return false;
}

function getTaskById_(id) {
  var tasks = getAssistantTasks_();
  for (var i = 0; i < tasks.length; i++) {
    if (String(tasks[i].id) === String(id)) return tasks[i];
  }
  return null;
}

function findUserLineId_(name) {
  var users = JingyangAssistant_readUsers_() || [];
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (u.displayName === name || u.username === name) {
      return u.lineUserId;
    }
  }
  return null;
}

function notifyBosses_(message) {
  var users = JingyangAssistant_readUsers_() || [];
  users.forEach(function(u) {
    if (u.role === "boss" || u.role === "admin") {
      if (u.lineUserId) {
        sendLinePushMessage_(u.lineUserId, message);
      }
    }
  });
}

function appendAuditLog_(workId, action, operator, operatorRole, fromStatus, toStatus, details) {
  try {
    var ssId = JingyangAssistant_getSpreadsheetId_();
    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName("操作紀錄");
    if (!sheet) {
      sheet = ss.insertSheet("操作紀錄");
      sheet.getRange(1, 1, 1, 9).setValues([["id", "workId", "action", "operator", "operatorRole", "fromStatus", "toStatus", "details", "createdAt"]]);
      sheet.setFrozenRows(1);
    }
    var id = "audit-" + Utilities.getUuid();
    var time = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([
      id,
      workId || "",
      action || "",
      operator || "",
      operatorRole || "",
      fromStatus || "",
      toStatus || "",
      details || "",
      time
    ]);
  } catch (err) {
    Logger.log("appendAuditLog_ failed: " + err.toString());
  }
}

function sendLinePushMessage_(targetId, message) {
  if (!targetId || !message) return false;
  var token = JingyangAssistant_getLineToken_();
  if (!token) return false;
  
  var url = "https://api.line.me/v2/bot/message/push";
  var options = {
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
    var res = UrlFetchApp.fetch(url, options);
    var success = (res.getResponseCode() === 200);
    return success;
  } catch (e) {
    Logger.log("sendLinePushMessage_ failed: " + e.toString());
    return false;
  }
}

function getSortedTasks_(tasks) {
  var todayStr = getTodayDateString_();
  return tasks.slice().sort(function(a, b) {
    var pA = a.priority === "urgent" ? 3 : (a.priority === "high" ? 2 : 1);
    var pB = b.priority === "urgent" ? 3 : (b.priority === "high" ? 2 : 1);
    if (pA !== pB) return pB - pA;
    
    var dueA = a.dueDate || "9999-99-99";
    var dueB = b.dueDate || "9999-99-99";
    
    var isExpiredA = dueA < todayStr;
    var isExpiredB = dueB < todayStr;
    if (isExpiredA !== isExpiredB) {
      return isExpiredA ? -1 : 1;
    }
    
    var isTodayA = dueA === todayStr;
    var isTodayB = dueB === todayStr;
    if (isTodayA !== isTodayB) {
      return isTodayA ? -1 : 1;
    }
    
    if (dueA !== dueB) {
      return dueA < dueB ? -1 : 1;
    }
    
    var createA = a.createdAt || "";
    var createB = b.createdAt || "";
    return createA < createB ? -1 : 1;
  });
}

function getTodayDateString_() {
  var d = new Date();
  var year = d.getFullYear();
  var month = String(d.getMonth() + 1);
  if (month.length < 2) month = "0" + month;
  var day = String(d.getDate());
  if (day.length < 2) day = "0" + day;
  return year + "-" + month + "-" + day;
}

function parseQueryString_(str) {
  var params = {};
  var pairs = (str || "").split("&");
  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i].split("=");
    if (pair[0]) {
      params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
    }
  }
  return params;
}
