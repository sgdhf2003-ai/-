# Stage 20-D Backend LINE Reminder Dry-run Closure

## 1. Purpose
- 封存 Stage 20-D Backend LINE Reminder Link dry-run helper 的開發與部署。
- **目標**：在 backend Apps Script 中加入唯讀、安全的 report-only dry-run helper，供未來 LINE reminder recipient selection 與 message preview 模擬使用。
- **限制條件**：
  - 第一版僅產生唯讀 JSON-safe dry-run 報告。
  - **不**進行真實 LINE 推播。
  - **不**呼叫 LINE APIs (如 `UrlFetchApp.fetch`)。
  - **不**修改 Google Sheet Schema。
  - **不**新增 `NotificationLogs` 工作表。
  - **不**新增 Google Apps Script event triggers。
  - **不**暴露任何 public Web App API doGet/doPost 進入點。

---

## 2. Background
本階段之演進歷程與前提條件如下：
- **Stage 20-A** LINE Push Feasibility Audit 通過。
- **Stage 20-B** LINE Reminder Link Dry-run Plan 已封存。
- **Stage 20-C1** Function Placement Audit 通過，確認 placement 擺放在 backend `Code.gs` 最符合安全與低耗能原則。
- **Stage 20-D1** Backend Dry-run Implementation Plan 已封存。
- **Stage 20-D2** 實作 backend helper（Code.gs）。
- **Stage 20-D3** Regression validation 審計通過。
- **Stage 20-D4** Review & Commit 完成。
- **Stage 20-D5** Push 至 github 伺服器完成。
- **Stage 20-D6** Deploy readiness 部署準備審計通過。
- **Stage 20-D7** Backend Deploy 成功。
- **Stage 20-D8** Post-deploy read-only validation 部署後運行安全審核通過。

---

## 3. Implemented Commit
- **Commit Hash**: `0fb9405`
- **Commit Message**: `feat: add backend line reminder dry-run report`

### 變動檔案：
- [google-apps-script/Code.gs](file:///Users/chenhaoan/Documents/jingyang-sales-app/google-apps-script/Code.gs) (僅限新增 private/internal helpers)

### 新增之輔助函式：
- `buildLineReminderLinkDryRunReport_(options)`
- `getLineReminderCandidates_()`
- `isLineReminderCandidateEligible_(candidate, context, lineUserIdsSeen)`
- `buildLineReminderMessagePreview_(candidate, context)`
- `getLineReminderWorkCenterUrl_()`
- `getLineReminderDryRunContext_(options)`

---

## 4. Deployment
- **Deployed Side**: Backend Apps Script Only.
- **LINE Bot deployed**: No.
- **Frontend deployed**: No.
- **Deployment Command**: `python3 deploy.py backend`
- **Backend Version**: `55`
- **Deployment ID**: `AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw`
- **Web App URL**: `https://script.google.com/macros/s/AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw/exec`

---

## 5. Technical Behavior
- **安全防禦守衛**：`buildLineReminderLinkDryRunReport_` 強制檢定 `options.mode === "dry-run"`，拒絕任何其他模式運行。
- **乾跑日誌參數**：回傳之報告中強制鎖定 `lineApiCalled: false` 與 `messagesSent: 0`。
- **資料來源限制**：僅讀取 `Users` 試算表。
- **不加載欄位**：不讀取任務清單（`Tasks`）、不查詢客戶明細、不計算團隊業績指標。

---

## 6. Report Output
模擬執行報告回傳之 JSON 欄位包含：
- `ok`: 執行成功指標
- `mode`: 恆為 `"dry-run"`
- `runId`: batch 唯一識別碼 (`dryrun-YYYYMMDD-HHmmss`)
- `runAt`: 執行時間戳記 (`yyyy-MM-dd HH:mm:ss`)
- `notificationType`: `"linkReminder"`
- `targetRole`: 篩選職位
- `workCenterUrl`: PWA 首頁 URL 連結
- `candidateUserCount`: 總檢索人數
- `eligibleUserCount`: 合格接收人數
- `skippedUserCount`: 排除過濾人數
- `candidates`: 使用者名單明細
- `lineApiCalled`: 恆為 `false`
- `messagesSent`: 恆為 `0`
- `warnings`: 警告日誌
- `errors`: 錯誤日誌

### `candidates` 內部物件包含：
- `userId` (系統使用者代碼)
- `name` (顯示名稱)
- `role` (職位身分)
- `status` (啟用狀態)
- `hasLineUserId` (是否有綁定 LINE)
- `optIn` (接收喜好設定，目前為 placeholder `"not_configured"`)
- `quietHoursBlocked` (免打擾阻擋，模擬為 `false`)
- `frequencyBlocked` (頻率上限阻擋，模擬為 `false`)
- `duplicateBlocked` (重複 UID 阻擋，模擬為 `true` / `false`)
- `finalEligible` (最終發送判定)
- `reason` (排除原因，如 `OK`, `Skip: Status is not 啟用`, `Skip: Duplicate LINE User ID`)
- `messagePreview` (訊息文字預覽，非合格對象則為空字串)

---

## 7. Eligibility Rules
判定合格接收者的規則鏈：
1. **帳號必須啟用**：`status === "啟用"`。
2. **LINE ID 必須存在**：`lineUserId` 欄位不得為空值。
3. **角色合規**：必須為 `admin, boss, manager, assistant, 助理, sales, retailSales, showroomSales` 等指定職位。
4. **UID 去重複**：多個帳號共享同一個 `lineUserId` 時，僅保留首個被處理的帳號，其餘均設為 `duplicateBlocked: true` 並排除。
5. **Opt-in 預留**：目前設定為 `optIn = "not_configured"`，模擬測試給予寬限，但正式發送前必須補齊資料庫喜好設定。

---

## 8. Message Preview Safety
- **Link-only 文案**：不包含任務名稱、客戶個資、卡點原因或統計筆數。
- **角色化樣板**：
  - **主管**：*「早安，請開啟工作中心查看主管每日總覽與團隊追蹤風險...」*
  - **助理**：*「早安，請開啟工作中心查看助理待處理摘要與等資料事項...」*
  - **一般業務**：*「早安，請開啟今日工作中心查看今日摘要與待處理事項...」*
- **URL 安全**：`view=tasks` 為固定 Query，不得夾帶身分 Token 或金鑰。

---

## 9. Safety Guarantees
已驗證無以下副作用操作：
- **不調用真實網路**：沒有任何 `UrlFetchApp.fetch` 被新增。
- **不呼叫 Messaging API**：不執行 `sendLinePushMessage` 或 `pushMessageToUser` 實體推送。
- **不修改資料表結構**：不增減 Sheet 欄位，不寫入 `setValue` 或 `appendRow`。
- **不新增背景觸排**：無 Google GAS 排程 Trigger。
- **不外洩 API endpoint**：無 `api.line.me` 傳輸網址寫入新增區塊。
- **無 PropertiesService 寫入**：僅 read-only 讀取 `PWA_PRODUCTION_URL` 參數。

---

## 10. Existing Behavior Preserved
- 既有 backend API doPost / doGet Webhook 保持 100% 相同，無新 route 引入。
- listMyTasks, createTask, updateTaskStatus 等核心工作流未被改動。
- PWA 前端與 LINE Bot webhook 回覆完全保持原樣，不影響任何顧客庫存/預約查詢通道。

---

## 11. Validation Summary
- **Stage 20-D3** Backend LINE Reminder Dry-run Regression Validation 通過。
- **Stage 20-D6** Deploy Readiness Audit 通過。
- **Stage 20-D7** Backend Deploy 成功。
- **Stage 20-D8** Post-deploy validation 通過。
- `npm run check` 檢查成功，GAS Clasp 乾跑檢查 VALID。
- 運作時環境無任何 memory leaks 或 routing 異常。

---

## 12. Known Limits / Deferred
- 該 dry-run helper 為 backend private helper，暫無 Web UI 控制或 public 測試 URL。
- 資料庫暫無 Opt-in / Opt-out 設定欄位與免打擾（Quiet Hours）開關。
- 尚未新增 `NotificationLogs` 排重儲存工作表。
- **主動推播（LINE Push Alert）維持阻擋狀態**。在上述 governance 機制完全實作前，不應直接轉為真推播。

---

## 13. Final Status
- Stage 20-D 唯讀模擬執行功能已成功部署於 **Backend Version 55**，運作穩定，無 rollback 需求。
- **下一步建議**：
  - **Stage 20-D10**：Review & Commit 本 Closure Note。
  - **Stage 20-D11**：Push 本 Closure Note 至 Github 以歸檔。
  - 未來可規劃 **Stage 20-E** 診斷調試接口或進行測試專員白名單推播測試規畫。
