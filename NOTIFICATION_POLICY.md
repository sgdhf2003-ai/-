# Notification Policy / 通知策略設計

## 1. Purpose
本文件定義「勁揚業務管家」系統的通知策略與安全原則。
- **通知策略藍圖**：提供業務、助理及主管等不同角色必要的工作進度提醒，同時最大程度降低干擾。
- **低風險原則**：目前僅規劃通知設計，不安裝任何 LINE 主動推播或排程觸發器。
- **拉取為主，推送為輔**：優先使用現有 PWA 工作中心（Work Center）的角色化摘要與 LINE 指令拉取連結（Pull-based Entry），暫緩自動推送（Push-based Alerts）。
- **架構延伸**：此策略立足於 Stage 17（PWA 工作中心今日摘要）與 Stage 18-B（LINE 連結查詢入口）已完成的功能之上。

---

## 2. Current Baseline
系統目前已具備以下基礎設施：
- **PWA Work Center**：包含「今日焦點」、「最近任務動態」、以及「今日工作摘要」。
- **Daily Work Brief / Role-Based Daily Brief**：根據使用者登入的角色（Retail Sales, Showroom Sales, Assistant, Supervisor/Admin）自適應生成指標統計與行動建议。
- **LINE 關鍵字查詢入口**（Version 177 已部署）：
  - 員工在 LINE 鍵入 `"今日摘要"`、`"工作中心"` 或 `"今日工作"`，系統自動回覆個人化引導詞與 PWA 任務入口連結。
  - PWA 入口 URL 格式：`https://brown-phi.vercel.app/?view=tasks`。

---

## 3. Notification Principles
未來的通知功能實作必須遵守以下安全與隱私原則：
1. **拉取優先（Default Pull, Not Push）**：引導使用者主動開啟 PWA 工作中心，避免未授權的主動推播。
2. **零敏感欄位洩漏（Zero Sensitive Leakage）**：在 LINE 的主動提醒文字中，不應夾帶明文任務內容或客戶機密資料，僅以筆數統計或引導網址代替。
3. **防疲勞機制（No Fatigue / Cap）**：不可頻繁發送通知，確保每位同仁每天收到主動推播的次數上限受嚴格管制。
4. **角色隔離與權限驗證**：任何提醒訊息在發送前，必須通過 `getLineUserContext` 與 `Users` 資料庫進行權限交叉比對。非該任務的利益關係人（如業務、指派助理、主管）不可收到相關通知。
5. **主管摘要以 PWA 為先**：優先在 PWA 網頁端實作主管日誌，而非在 LINE 直接發送大宗任務內容，確保資料流安全。
6. **保護客戶查詢通道**：通知流程不得與 LINE Bot 的顧客查庫存、問貨及促銷展示流程產生衝突。

---

## 4. Candidate Notifications
以下為未來候選的通知提醒項目及其風險評估：

| 通知項目 | 類型 | 包含資料範圍 | 風險評估 | 建議狀態 |
| :--- | :--- | :--- | :--- | :--- |
| **A. 晨間今日摘要提醒** | LINE 連結提醒 | 無細節，僅提示網址 | 資料風險：低<br>疲勞/額度風險：中 | 暫緩實作；引導同仁主動輸入指令拉取即可。 |
| **B. 逾期任務提醒** | 角色/負責人通知 | 僅提示逾期筆數與 PWA 連結 | 資料風險：中<br>疲勞/額度風險：高 | 暫緩實作；需等防重覆發送日誌設計完畢後再評估。 |
| **C. 異常/Blocked 任務提醒** | 負責人與主管通知 | 僅提示異常筆數與卡點簡述 | 資料風險：中<br>疲勞/額度風險：中 | 優先規劃主管每日摘要 PWA 介面，暫無主動推播。 |
| **D. 等資料 Waiting 提醒** | 助理專屬通知 | 僅提示等待資料的筆數 | 疲勞風險：中 | 暫緩實作。 |
| **E. 主管每日摘要 (Manager Digest)**| PWA 專屬面板 / LINE 摘要 | 跨專案統計、卡點前三項 | PWA 端風險：低<br>LINE 端風險：極高 | 優先實作 **PWA 專屬主管摘要面板**。不作 LINE 直接推送。 |
| **F. 助理待處理工作摘要** | PWA 面板 / LINE 回覆 | 打單、保留、送貨待處理筆數 | 疲勞風險：中 | 暫緩實作。 |

---

## 5. Role-Based Notification Policy
不同角色對於提醒資訊的需求劃分如下：

### 零售業務 (retailSales / retail / sales)
- **適合的提醒範圍**：送貨進度卡點、已逾期任務、收退貨及樣品流向異常。
- **避免發送的噪音**：跨部門門市預約細節、主管層級的團隊統計。

### 門市業務 (showroomSales / showroom)
- **適合的提醒範圍**：展場帶看預約提醒、門市保留款逾期、加工單排程異常。
- **避免發送的噪音**：零售端的大宗工地送貨細節。

### 助理 (assistant)
- **適合的提醒範圍**：等待資料任務逾期、行政及保留單審核提醒、指派轉交工作。
- **避免發送的噪音**：過多且重複的無實質進展警示。

### 主管 / 管理員 (boss / admin / manager)
- **適合的提醒範圍**：全體逾期總筆數、當前卡點（Blocked）任務列表、高優先急件警報。
- **避免發送的噪音**：在 LINE 發送未經過濾的敏感任務明細，網址連結不可含有暴露身分的 Access Token。

---

## 6. Push Notification Safety Requirements
未來若要啟動 LINE 主動推播（Push Message），必須在架構上滿足以下前置條件：
1. **可靠的綁定機制**：LINE `lineUserId` 必須與 `Users` 工作表的專屬帳號完全一致，防止錯配。
2. **退訂與喜好設定**：員工可在系統中設定「關閉通知時間（Quiet Hours）」或個別開啟/關閉不同警示通道。
3. **頻率上限（Frequency Cap）**：限制單日或單週發送的最大封數。
4. **防重覆邏輯（Deduplication）**：利用 `taskHash` 記錄已發送過的警告，相同任務在未變更狀態前不可重覆推播。
5. **部署與測試切換（Test Mode / Dry-run）**：提供後台一鍵關閉主動推播的開關，並支持將所有推播導向測試人員。

---

## 7. Future NotificationLogs Schema (Design Only)
未來用於防止重覆推播與額度追蹤的日誌資料表設計如下（目前暫不建立此 Sheet）：

| 欄位名稱 (Column) | 說明 (Description) |
| :--- | :--- |
| `id` | 日誌唯一 ID |
| `notificationType` | 通知類型（例如：overdueAlert, blockedWarning） |
| `targetRole` | 接收者角色類型（如 assistant） |
| `targetUserId` | 系統使用者 ID（如 user-cai） |
| `lineUserId` | LINE 用戶唯一識別碼 |
| `relatedTaskId` | 相關工作任務 ID |
| `taskHash` | 用於防止同一狀態重覆推送的檢查碼（如 `md5(taskId + status)`） |
| `messageSummary` | 發送訊息概要 |
| `sentAt` | 發送時間戳記 |
| `status` | 發送結果（success / failed） |
| `error` | 錯誤細節日誌 |
| `createdAt` | 建立時間 |

---

## 8. Recommended Implementation Roadmap
我們推薦的分階段實作路線如下：
1. **Stage 19-B1: Notification Policy Document** (本階段)
   - 建立策略文件，定義安全防線。
2. **Stage 19-C: PWA Manager Digest Panel Implementation**
   - 100% 網頁端/前端實作，專為 `boss`/`admin` 角色展示高風險任務統計。無 LINE 推播。
3. **Stage 19-D: PWA Assistant Pending Panel**
   - 網頁端助理待處理摘要面板，無 LINE 推播。
4. **Stage 20-A: LINE Push Feasibility Audit**
   - 只讀評估 LINE 官方 API 推播與使用者綁定。
5. **Stage 20-B: LINE Reminder Link Dry-run Design**
   - 實作無痛推播（僅推送 PWA 工作中心連結），不帶敏感細節。

---

## 9. Explicit Non-Goals for Now
以下項目在當前階段列為 **Non-Goals（非本階段目標）**：
- 不新增任何 LINE 推播程式碼。
- 不使用 Multicast 或 Broadcast 接口。
- 不在 Google Sheet 建立新工作表（如 `NotificationLogs`）。
- 不調整 backend API 或 doPost Webhook 路由。
- 不在 LINE 訊息中明文傳送任務清單細節。
- 不新增背景 Cron 排程。

---

## 10. Conclusion
- **LINE 主動推播可行性**：低（涉及額度控制與邏輯重覆）。
- **PWA 主管摘要可行性**：極高（可完全重用前端資料集與現有統計模組）。
- **推薦下一步**：封存本策略文件後，於 **Stage 19-C** 規劃並實作 **PWA 專屬主管工作摘要（Manager Digest Panel）**，完全避開 LINE 推播的資料外洩與額度風險。
