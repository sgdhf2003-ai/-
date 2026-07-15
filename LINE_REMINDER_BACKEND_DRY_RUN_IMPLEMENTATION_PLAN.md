# LINE Reminder Backend Dry-run Implementation Plan

## 1. Purpose
- 本文件規劃未來 Stage 20-D2 如何在 `google-apps-script/Code.gs` (試算表後台) 中實作安全且唯讀的 **LINE Reminder Link dry-run report function**。
- **目標**：僅過濾出符合推送條件的人員，生成訊息預覽並輸出 JSON 格式的模擬執行報告。
- **邊界限制**：不呼叫任何外部 LINE APIs、不修改現有資料表欄位、不新增 `NotificationLogs` 工作表、不觸發實體訊息、不新增任何排程 Trigger、不進行線上部署。
- **決策依據**：呼應 Stage 20-C1 擺放位置審計，確認 `google-apps-script/Code.gs` 能最高效且安全地獲取 `Users` 資訊，是最合適的實作 placement。

---

## 2. Scope
### 允許修改之檔案：
- [google-apps-script/Code.gs](file:///Users/chenhaoan/Documents/jingyang-sales-app/google-apps-script/Code.gs) (僅限新增 private / helper dry-run 函式)

### ⛔ 禁止修改或新增之範圍 (Stage 20-D2 嚴格限制)：
- `line-bot-apps-script/` (LINE Bot 專案)
- `app.js` (PWA 前端邏輯)
- `styles.css` (PWA 樣式)
- `index.html` (PWA 主網頁)
- `deploy.py` (部署工具)
- `service-worker.js` (離線快取)
- `NOTIFICATION_POLICY.md` (通知原則)
- `LINE_REMINDER_LINK_DRY_RUN_PLAN.md` (通知策略規畫)
- 既有的 Closure MD 檔案
- Google Sheet 實體 Schema (不增減欄位)
- 密鑰 / Token / API endpoints
- 建立 `NotificationLogs` 實體工作表
- 建立 Google Apps Script Triggers

---

## 3. First-version Principle
第一版模擬執行模組設計秉持以下最安全原則：
- **Report-only**：僅回傳報告 JSON 物件，不寫入任何資料庫，不更新 UI。
- **Backend-only**：所有運算均在 Google Apps Script Server 執行，不將 `lineUserId` 清單拋給前端 Client。
- **Read-only**：對試算表僅進行 Read 操作，絕不呼叫 `writeSheet`、`appendRow` 等寫入指令。
- **Users-only**：僅檢索 `Users` 資料庫，確認人員的 LINE 綁定狀態與啟用狀態，不讀取 `Tasks`、`Reservations` 等其他工作表以避免效能瓶頸。
- **No LINE APIs**：絕不調用 `UrlFetchApp.fetch` 發送請求給 LINE endpoint，且程式碼中不保留 LINE API endpoint 網址字串。

---

## 4. Proposed Functions
規畫於 `google-apps-script/Code.gs` 中新增以下輔助函式：

### A. `buildLineReminderLinkDryRunReport_(options)`
- **說明**：主要調度器，負責統整候選名單、過濾合格對象、拼裝預覽文案並產出最終 JSON 報告。
- **守衛 (Guard)**：預設強制為 `options.mode === "dry-run"`，若非 `dry-run` 則拋出錯誤拒絕執行。

### B. `getLineReminderCandidates_()`
- **說明**：使用 `readObjects(SHEETS.users, HEADERS.users)` 檢索使用者清單，並映射出所需的 `userId`, `displayName`, `role`, `status`, `lineUserId` 資料。

### C. `isLineReminderCandidateEligible_(candidate, context)`
- **說明**：依據狀態、角色、UID 重複性與 Opt-in 預留參數進行邏輯檢定，回傳 `{ eligible: boolean, reason: string }`。

### D. `buildLineReminderMessagePreview_(candidate, context)`
- **說明**：根據 `candidate.role` 挑選安全文案樣板，並組合 PWA 首頁 URL。

### E. `getLineReminderWorkCenterUrl_()`
- **說明**：從 `ScriptProperties` 讀取 `PWA_PRODUCTION_URL` 變數（預設值為 `https://brown-phi.vercel.app`），並附加安全參數 `?view=tasks`。

### F. `getLineReminderDryRunContext_(options)`
- **說明**：生成 Batch 執行的元數據 (元數據包含 `runId`, `runAt` 等) 以及設置模擬執行防護鎖。

---

### ❌ 嚴格禁止新增之實體發送函式：
- `sendLineReminderPush_()`
- `executeLineReminderPush_()`
- `scheduleLineReminderTrigger_()`
- `writeNotificationLogs_()`
- `createNotificationLogsSheet_()`

---

## 5. Output Report Shape
最終產出之 JSON 報告格式規範如下，必須包含 `lineApiCalled: false` 以供自動化驗證：

```json
{
  "ok": true,
  "mode": "dry-run",
  "runId": "dryrun-20260716-080000",
  "runAt": "2026-07-16T08:00:00+08:00",
  "notificationType": "linkReminder",
  "targetRole": "all",
  "workCenterUrl": "https://brown-phi.vercel.app/?view=tasks",
  "candidateUserCount": 6,
  "eligibleUserCount": 3,
  "skippedUserCount": 3,
  "candidates": [
    {
      "userId": "user-admin",
      "name": "管理員",
      "role": "admin",
      "status": "啟用",
      "hasLineUserId": true,
      "optIn": "not_configured",
      "quietHoursBlocked": false,
      "frequencyBlocked": false,
      "duplicateBlocked": false,
      "finalEligible": true,
      "reason": "OK",
      "messagePreview": "早安，請開啟工作中心查看主管每日總覽與團隊追蹤風險：https://brown-phi.vercel.app/?view=tasks"
    },
    {
      "userId": "user-sales001",
      "name": "業務001",
      "role": "sales",
      "status": "停用",
      "hasLineUserId": true,
      "optIn": "not_configured",
      "quietHoursBlocked": false,
      "frequencyBlocked": false,
      "duplicateBlocked": false,
      "finalEligible": false,
      "reason": "Skip: Status is Inactive",
      "messagePreview": ""
    }
  ],
  "lineApiCalled": false,
  "messagesSent": 0,
  "warnings": ["opt_in_not_configured_defaulting_to_true_for_simulation"],
  "errors": []
}
```

---

## 6. Eligibility Rules
第一版 Dry-run 的合格過濾邏輯：

1. **啟用狀態檢查**：`status` 欄位必須完全等於 `"啟用"`，若為 `"停用"` 或空值則排除。
2. **合法內部角色**：`role` 必須屬於以下合法角色之一：
   - `admin`, `boss`, `manager`, `assistant`, `助理`, `retailSales`, `retail`, `sales`, `showroomSales`, `showroom`。
3. **LINE 識別碼存在**：`lineUserId` 欄位不得為空，且必須以 `U` 開頭。
4. **去重複 UID**：在同一次 Batch 執行中，若有多個帳號對應相同的 `lineUserId`，除首個使用者外，其餘一律標記 `duplicateBlocked: true` 並排除，避免同一部手機收到重複通知。
5. **Opt-in (主動同意，目前預設)**：因目前尚未擴充 Users 資料表，系統在此階段標記 `optIn` 為 `"not_configured"`。在 Dry-run 模擬階段為求展示成效，此處排除邏輯預設給予寬限，但在警報中加入警告標記。
6. **免打擾與頻率上限**：在此模擬階段不進行實際時間阻擋，但日誌欄位保留預設 `false` 的 Placeholder 結構，便於未來相容。

---

## 7. Role Message Previews
根據使用者角色，模擬生成不同的安全無害連結文案：

- **一般/零售/展場業務 (sales / retailSales / showroomSales / showroom)**:
  > 「早安，請開啟今日工作中心查看今日摘要與待處理事項：
  > {WORK_CENTER_URL}」
- **助理 (assistant / 助理)**:
  > 「早安，請開啟工作中心查看助理待處理摘要與等資料事項：
  > {WORK_CENTER_URL}」
- **主管/管理員 (boss / admin / manager)**:
  > 「早安，請開啟工作中心查看主管每日總覽與團隊追蹤風險：
  > {WORK_CENTER_URL}」

---

## 8. Safety Guards
為防範任何誤觸真實 LINE 推播的事故，Stage 20-D2 的程式碼中將實施以下實體守衛：
1. **唯讀指令保護**：在所有 Dry-run 新增的輔助函式中，**不准**寫入 `UrlFetchApp` 呼叫，亦不保留任何 LINE 網誌傳輸字串。
2. **靜態文案**：訊息範本中僅包含固定的提醒字詞與 URL 變數，絕不以動態字串串接任務表格內部的客戶明細。
3. **強制限縮變數**：在最終的 JSON 回傳結果中，強制輸出 `lineApiCalled: false` 與 `messagesSent: 0`。

---

## 9. Suggested Integration Point
- **擺放位置**：
  - 新增之 dry-run 函式應集中放置在 [google-apps-script/Code.gs](file:///Users/chenhaoan/Documents/jingyang-sales-app/google-apps-script/Code.gs) 的尾端。
  - 應與既有的 `sendLinePushMessage` 保持視覺與邏輯隔離，避免在複製或修改時誤改實體發送函數。
- **診斷調試接口**：
  - 僅提供內部測試診斷用途之 private 函式（以 `_` 結尾），不向 Web App `doGet` / `doPost` 路由對外暴露此功能。

---

## 10. Validation Commands for Stage 20-D2
在未來完成實作後，驗證程序必須執行以下指令進行程式碼防護檢驗：

```bash
# 檢查工作目錄
pwd
git rev-parse --show-toplevel
git status --short

# 檢查程式碼變動，確認僅有 Code.gs 被更改
git diff --name-only
git diff --stat

# 驗證新增的 private 函式完整性
grep -n "buildLineReminderLinkDryRunReport_" google-apps-script/Code.gs
grep -n "getLineReminderCandidates_" google-apps-script/Code.gs
grep -n "isLineReminderCandidateEligible_" google-apps-script/Code.gs
grep -n "buildLineReminderMessagePreview_" google-apps-script/Code.gs
grep -n "getLineReminderWorkCenterUrl_" google-apps-script/Code.gs

# 🔒 關鍵安全防護檢驗：確認 dry-run 區塊內完全沒有呼叫真實發送 wrapper 與網路請求
grep -n -C 5 "buildLineReminderLinkDryRunReport_" google-apps-script/Code.gs | grep -E "sendLinePushMessage|UrlFetchApp.fetch"

# 運行專案語法與 clasp 乾跑檢查
npm run check
python3 deploy.py backend --check
python3 deploy.py line-bot --check
```

---

## 11. Stage 20-D2 Allowed Implementation Boundaries
- **允許**：修改 `google-apps-script/Code.gs` 並新增唯讀的 `buildLineReminderLinkDryRunReport_` 邏輯。
- **禁止**：
  - 進行 clasp 實體 deploy。
  - 修改 `line-bot-apps-script` 內部的任何檔案。
  - 在 `Code.gs` 中呼叫 `UrlFetchApp.fetch` 或外部網路連線。
  - 增減 Google Sheets 欄位或建立新 Sheets。

---

## 12. Review Checklist for Stage 20-D2
- [ ] 僅修改 `google-apps-script/Code.gs`，其餘程式碼無任何變動。
- [ ] 所有新增函式均為唯讀，沒有任何 `writeSheet` / `setValue` 等寫入指令。
- [ ] 所有新增函式皆不包含 LINE Web API 呼叫，亦不調用 `sendLinePushMessage` 等發送 API。
- [ ] 輸出的 JSON 報告中，`lineApiCalled` 恆為 `false`，且 `messagesSent` 恆為 `0`。
- [ ] 模擬文案中僅包含安全連結與靜態導引詞，無任務/客戶敏感個資洩漏。
- [ ] 多個帳號綁定同一個 `lineUserId` 時，去重邏輯運作正常（其餘帳號被 skipped）。
- [ ] 已停用的帳號會被正確排除並記錄 skipped 原因。

---

## 13. Risk Rating
- **Stage 20-D2 backend dry-run helper only**: **Low** (No API calls, read-only simulation).
- **Backend dry-run with public API route**: **Medium** (Provides external trigger entry).
- **LINE Bot dry-run helper**: **Low-Medium**.
- **Frontend dry-run**: **High** (Client-side exposure of UID listings).
- **Real LINE link-only push**: **Medium** (Quota consumption / user fatigue).
- **Task detail push**: **High** (Data leak risk).
- **Manager digest push via LINE**: **Very High** (Cross-department leak risk).

---

## 14. Final Recommendation
- **行動建議**：本階段完成本規劃文件 `LINE_REMINDER_BACKEND_DRY_RUN_IMPLEMENTATION_PLAN.md` 之後，提交至 git 做為封存。
- **下一步規畫**：
  - **Stage 20-B2**：Review & Commit 本規劃文件。
  - **Stage 20-B3**：Push 本規劃文件以完成 Stage 20-D1 封存。
  - **Stage 20-D2**：依此計畫於 `Code.gs` 中實作 report-only 模擬功能，並通過乾跑驗證。
