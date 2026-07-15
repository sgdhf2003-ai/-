# LINE Reminder Link Dry-run Plan

## 1. Purpose
- 本文件規劃未來 **LINE reminder link-only dry-run**（無痛提醒模擬執行）的技術方案與安全規範。
- **核心目標**：僅發送「引導員工開啟 PWA 任務中心」之連結通知，不在 LINE 訊息內夾帶任何明文的任務標題、卡點細節或客戶資料。
- **模擬運行限制**：初期階段僅進行 **Dry-run 模擬執行**，產生對應的模擬接收者報表與日誌，**絕不**真正發送任何 LINE Push 訊息，亦不建立實際的排程觸發器。
- **設計宗旨**：呼應 Stage 20-A 稽核結論，目前系統缺少完整的防重覆、防打擾及退訂（Opt-out）控制，在實施主動通知前，必須先完成此 Dry-run 技術規劃。

---

## 2. Current Baseline
目前系統已具備以下基礎設施與缺陷對比：

### A. 已就緒基礎 (Ready)
- **PWA Work Center**：已實作「今日焦點」、「最近動態 Feed」、「今日摘要」、「主管總覽」與「助理待處理摘要」等角色化視圖。
- **LINE 關鍵字查詢**：已支援員工輸入 `"今日摘要"`、`"今日工作"` 與 `"工作中心"` 以拉取（Pull-based）PWA 連結的雙向通道。
- **Push SDK 基礎**：
  - 試算表後台 (`Code.gs`)：`sendLinePushMessage(targetId, message)`
  - LINE Bot 程式碼 (`line程式碼.gs`)：`pushMessageToUser(userId, text)`

### B. 目前缺少的控制機制 (Missing)
- 缺少排程觸發管理器及防重覆推送的 `NotificationLogs` 工作表。
- 缺少使用者退訂 / 偏好設定功能（Opt-in / Opt-out）。
- 缺少免打擾時段限制（Quiet Hours）。
- 缺少每日發送上限控制（Frequency Cap）。
- 缺少全域關閉開關（Kill Switch）。
- 缺少完全安全的接收者過濾與錯誤容錯。

---

## 3. Recommended First Candidate
我們強烈推薦以 **Link-only reminder dry-run** 作為後續第一步首選方案：
- **內容限制**：僅推送工作中心任務首頁 URL，訊息內不帶有任務總數、標題、卡點分類或客戶名稱。
- **執行限制**：不真正呼叫 LINE Messaging API，僅在背景或試算表記錄「本應接收到提醒」的名單。

### 🚫 明確禁止之高風險方案（第一步不予考慮）：
1. **Task Detail Reminder**：明文夾帶具體任務標題與客戶資料，有資料洩漏高風險。
2. **Manager Digest via LINE**：在 LINE 發送跨團隊數據統計與異常列表，隱私度極低。
3. **過期與卡點任務即時推播**：在沒有日誌 deduplication 前，會造成同仁受到訊息疲勞轟炸。
4. **大宗廣播 (Broadcast / Multicast)**：耗費大量官方帳號發送額度，且違反分工權限原則。

---

## 4. Message Template Draft
Dry-run 階段設計之通知訊息草稿，區分不同角色推送不同文案：

### 一般業務版 (Daily Work Reminder)
> 「早安！請開啟今日工作中心查看您的今日工作摘要與任務清單：
> {WORK_CENTER_URL}」

### 助理專屬版 (Assistant Pending Reminder)
> 「早安！請開啟今日工作中心查看您的助理待處理摘要與等資料事項：
> {WORK_CENTER_URL}」

### 主管專屬版 (Manager Digest Reminder)
> 「早安！請開啟工作中心查看今日主管總覽與團隊追蹤風險：
> {WORK_CENTER_URL}」

### 🔒 安全原則約束：
- **禁止包含**：客戶名稱、產品型號、合約金額、卡點說明、指派人姓名等敏感資訊。
- **網址規範**：連結網址 `{WORK_CENTER_URL}` 不得在 Query Parameter 中明文攜帶 Token、密碼或容易被枚舉的使用者 ID。

---

## 5. Recipient Selection Rules
定義未來模擬執行（Dry-run）過濾合格接收者的判定規則：

### A. 所需使用者資料庫欄位 (Required Fields)
- `userId`（使用者 ID）
- `displayName`（顯示姓名）
- `role`（職位角色）
- `status`（帳號啟用狀態）
- `lineUserId`（LINE 識別碼）
- `notificationOptIn`（主動接收意願，未來新增）
- `disabledAt`（停用時間戳記，未來新增）

### B. 合格條件 (Eligible)
1. 使用者狀態在 `Users` 表格中必須為 `啟用`。
2. `lineUserId` 欄位必須存在，且為合法的 LINE UID 格式（以 `U` 開頭且長度為 33 碼）。
3. 角色職位在合法定義的內部人員角色內。
4. 主動通知設定為 Opt-in (同意接收)。
5. 執行當前時間不在 Quiet Hours（免打擾時段）。
6. 當日對該使用者的通知次數未達單日上限。
7. 全域 Kill Switch 處於開啟（允許）狀態。

### C. 排除名單範例 (Ineligible Skip Reasons)
- 使用者未綁定 LINE 帳號（`lineUserId` 空白）。
- 使用者已於 `Users` 工作表中被置為 `停用` 或已離職。
- 使用者手動設定為 Opt-out (拒絕主動接收)。
- 身分角色為 `unknown`、`guest` 或空白。
- `lineUserId` 存在重複配置的帳號（為免重複發送，重複 UID 僅保留主要帳號）。
- 執行當下落在 Quiet Hours 時段內。

---

## 6. Role-Specific Policy
針對特定角色精確投遞對應文案，不得越權傳送：
- **助理 (assistant / 助理)**：
  - 投遞「助理專屬版」文案。
  - 不得夾帶業務報表或跨團隊業績統計。
- **主管 (boss / admin / manager)**：
  - 投遞「主管專屬版」文案。
  - 僅提醒檢視跨專案團隊卡點，不包含明細。
- **零售與門市業務 (retailSales / showroomSales / sales)**：
  - 投遞「一般業務版」文案。
  - 不得傳送其他同仁的逾期案件。
- **未知或空白角色**：
  - 一律跳過，不進行任何通知模擬。

---

## 7. Dry-run Output Design
模擬執行時，系統不會向 LINE API 送出請求，僅會產出一份模擬執行日誌（Dry-run Report）供管理員評估：

```json
{
  "runId": "dryrun-20260716-080000",
  "runAt": "2026-07-16T08:00:00+08:00",
  "mode": "dry-run",
  "notificationType": "dailyLinkReminder",
  "candidateUserCount": 12,
  "eligibleUserCount": 8,
  "skippedUserCount": 4,
  "candidates": [
    {
      "userId": "user-admin",
      "name": "管理員",
      "role": "admin",
      "status": "啟用",
      "hasLineUserId": true,
      "optIn": true,
      "quietHoursBlocked": false,
      "frequencyBlocked": false,
      "duplicateBlocked": false,
      "finalEligible": true,
      "reason": "OK",
      "messagePreview": "早安！請開啟工作中心查看今日主管總覽與團隊追蹤風險：https://brown-phi.vercel.app/?view=tasks"
    },
    {
      "userId": "user-cai",
      "name": "蔡",
      "role": "sales",
      "status": "啟用",
      "hasLineUserId": false,
      "optIn": true,
      "quietHoursBlocked": false,
      "frequencyBlocked": false,
      "duplicateBlocked": false,
      "finalEligible": false,
      "reason": "Skip: Missing LINE User ID",
      "messagePreview": ""
    }
  ],
  "apiCallStats": {
    "totalFetchCount": 0,
    "successCount": 0,
    "networkErrorCount": 0
  }
}
```

---

## 8. NotificationLogs Future Schema
為防重複推送，未來系統在「正式啟用通知」前，必須擴充資料表結構。以下為設計草案，**本階段暫不建立實體表格**：

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | String | 唯一識別 ID (如 UUID) |
| `notificationType` | String | 通知警報類型 (如 dailyLinkReminder, blockedAlert) |
| `mode` | String | 發送模式 (dry-run / production) |
| `targetRole` | String | 接收者職位 |
| `targetUserId` | String | 使用者 ID |
| `lineUserId` | String | LINE 用戶識別碼 |
| `relatedTaskId` | String | 關聯之 Task ID (若為 link-only 則為空) |
| `taskHash` | String | 排重碼 (如 `md5(taskId + status + dueDate)`) |
| `messageSummary` | String | 訊息預覽摘要 |
| `sentAt` | Timestamp | 模擬或實際發送時間 |
| `status` | String | 結果狀態 (success / failed / skipped) |
| `error` | String | LINE API 錯誤訊息 (如有) |
| `createdAt` | Timestamp | 日誌建立時間 |
| `runId` | String | 對應的 Batch 執行編號 |

---

## 9. Quiet Hours / Frequency Cap
主動通知必須具備時間與額度防護罩：
- **Quiet Hours（免打擾時段）**：
  - 每日 **22:00 至 隔日 08:00** 期間，系統完全禁止發送任何主動推播。
  - 此期間的所有排程提醒一律直接 Skip，不可累積至 08:00 後補發（避免造成訊息轟炸）。
- **Frequency Cap（頻率上限）**：
  - **每日 Link 提醒**：每位使用者每天最多僅能接收 1 次。
  - **狀態變更/卡點警報**：若未來實作，同一任務的狀態未發生轉變（如 Blocked 狀態未解除），每天針對該任務最多僅推送 1 次。
- *備註*：同仁主動在 LINE 傳送關鍵字查詢所回覆的對話，屬於 Pull-based 操作，不受 Quiet Hours 與頻率上限限制。

---

## 10. Kill Switch Design
我們在後台設計中規劃以下 **Script Properties（指令檔屬性控制開關）**，供系統管理員在緊急狀態下一鍵降級：

- `DISABLE_LINE_PUSH` = `true` (全域總開關：一旦啟用，任何 LINE 主動發送邏輯立即中斷)
- `LINE_PUSH_DRY_RUN_ONLY` = `true` (模擬開關：若為 true，即使觸發發送也僅能寫入日誌，不允許對外 Fetch LINE API)
- `LINE_PUSH_ALLOWED_TYPES` = `linkReminder` (只允許發送的部分通知類型)
- `LINE_PUSH_ALLOWED_ROLES` = `assistant,boss,admin,manager` (允許推送的主體身分角色)
- `LINE_PUSH_QUIET_HOURS` = `22:00-08:00` (設定全域免打擾時間區段)

---

## 11. Deployment Plan for Future Implementation
未來若要推進此通知系統，必須嚴格遵循以下階段，不得跳級：
1. **Stage 20-B** (本階段)：建立本規劃白皮書。
2. **Stage 20-C** (規劃審計)：評估 dry-run 程式碼在 backend 與 line-bot 的擺放架構。
3. **Stage 20-D** (程式碼 Dry-run 實作)：僅編寫 recipient 篩選與日誌輸出邏輯，不串接 LINE API 發送。
4. **Stage 20-E** (回歸與模擬驗證)：驗證 disabled/opt-out 使用者是否被正確過濾。
5. **Stage 20-F** (建立 NotificationLogs 表格與 Opt-in 設定)：擴充 Google Sheet 結構與偏好設定面板。
6. **Stage 20-G** (安全上線稽核)：確認 Script Properties (Kill Switch) 安全性。
7. **Stage 20-H** (白名單灰度測試)：僅限針對單一開發者帳號（管理員帳號）進行實體 LINE 訊息投遞測試。
8. **Stage 20-I** (正式啟用通知)：正式對所有啟用同仁實施 Link-only 晨間提醒。

---

## 12. Validation Checklist for Future Dry-run
在實作模擬運行（Dry-run）後，測試驗證必須確認以下項目：
- [ ] 試算表 `Users` 表格中，`status` 為「停用」的使用者是否被正確 Skipped。
- [ ] 未綁定 LINE (`lineUserId` 為空) 的使用者是否被正確過濾，不造成程式出錯。
- [ ] 當 `LINE_PUSH_DRY_RUN_ONLY` 被設為 `true` 時，是否完全沒有對 `https://api.line.me/v2/bot/message/push` 發出請求。
- [ ] 免打擾時段內（例如晚上 23:00）執行時，是否所有使用者都因 `quietHoursBlocked` 被設為 `false` / `skipped`。
- [ ] 重複的 `lineUserId` 在篩選時是否能被正確去重（Deduplicated）。
- [ ] `messagePreview` 文字是否 100% 符合無敏感明細原則。

---

## 13. Explicit Non-Goals
- 不得發送任何真實的 LINE push 訊息給終端用戶。
- 不得使用 Multicast 或 Broadcast 接口。
- 不得在 Google Sheet 中新建任何工作表。
- 不串接任何外部排程 Trigger。
- 訊息中一律不傳遞任務明細（如客戶名、訂單內容）。
- 不進行 clasp deploy 發布。

---

## 14. Final Recommendation
- **推薦做法**：本階段完成此規劃文件 `LINE_REMINDER_LINK_DRY_RUN_PLAN.md` 之後，提交至 git 做為封存。
- **後續步驟**：
  - Stage 20-B2: Review & Commit LINE Reminder Link Dry-run Plan
  - Stage 20-B3: Push LINE Reminder Link Dry-run Plan
  - Stage 20-C1: LINE Push Dry-run Function Placement Audit (只讀評估邏輯擺放)
