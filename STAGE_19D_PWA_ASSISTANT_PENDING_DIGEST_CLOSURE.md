# Stage 19-D PWA Assistant Pending Digest Panel Closure Note

## 1. Purpose
本文件為 **Stage 19-D PWA Assistant Pending Digest Panel** 的封存備忘錄。
- **目的**：在 Work Center 任務中心中，為 `assistant`（助理）角色提供專屬的「助理待處理摘要」面板。
- **解決痛點**：助理同仁登入後，可在一眼內掌握所有與助理相關的「卡點異常」、「需要補件等資料任務」以及「最近動態更新」。
- **設計架構**：本功能完全以 **frontend-only** 方式實現，保障輕量化設計，不對 backend / LINE Bot 做額外開銷。
- **承接歷史**：本功能延續並整合了 Stage 17（今日工作摘要）、Stage 18（LINE 入口導流）、Stage 19-B（通知原則）與 Stage 19-C（主管每日總覽）。

---

## 2. Implemented Commit
- **`5a6ae29` feat: add assistant pending digest panel**
  - 在 `app.js` 新增助理角色判定 helper `isAssistantRole_(role)`。
  - 在 `app.js` 新增助理待處理摘要模組渲染器 `renderAssistantPendingDigest_(stats, activities, tasks)`。
  - 將助理總覽面板與現有 `stats`（getTaskSummaryStats_）與 `activities`（getRecentTaskActivities_）對接，保障指標數據完全一致。
  - 在 PWA 初始化渲染樹中，精確將該卡片插入於 Daily Work Brief 下方、Summary Cards 上方，與主管總覽卡片呈互斥關係。

---

## 3. Technical Summary
- **修改檔案**：
  - `app.js` (精確插入渲染順序與兩個 helper)
- **未修改檔案**：
  - `styles.css` (主管卡片採用高質感 inline CSS 與現有 `.daily-brief-card` 的玻璃美學對齊，零 CSS 修改風險)
  - `index.html` (DOM Shell 未變動)
  - `google-apps-script/Code.gs` (後台 Spreadsheet API 與查詢權限未變動)
  - `line-bot-apps-script/` (LINE Bot 代碼與 webhook 接收器未變動)
  - `deploy.py` (部署工具代碼未變動)
  - `service-worker.js` (快取及離線機制未變動)
  - `NOTIFICATION_POLICY.md` (通知原則策略文件未變動)
  - 既有其他 closure md 檔案 (未變動)
- **安全防線**：
  - 無 `doPost`/`doGet` 新增或修改。
  - 無 LINE `push`/`multicast`/`broadcast` 主動推送。
  - 無任何自動排程或計時器觸發。
  - 助理待處理卡片上不設置任何編輯、更新或附註按鈕，僅為唯讀面板。

---

## 4. Role Behavior
- **可見角色 (Visible)**：
  - `assistant` / `助理` (助理同仁)
- **隱藏角色 (Hidden)**：
  - `boss` (主管)
  - `admin` (系統管理員)
  - `manager` (專案經理)
  - `retailSales` / `retail` / `sales` (零售業務)
  - `showroomSales` / `showroom` (門市業務)
  - 任何未知、空白或未登入身分。
- **互斥機制**：主管角色僅能看見主管總覽（Manager Digest），助理僅能看見助理摘要（Assistant Digest），兩者在同一區塊中完全互斥且安全隔離。非主管及非助理角色則兩者皆不顯示。

---

## 5. Render Placement
在 PWA `renderTasks` 中，卡片的精確渲染順序如下：
1. **今日焦點** (`renderTaskDashboardFocus_`)
2. **最近任務動態** (`renderRecentActivityFeed_`)
3. **今日工作摘要** (`renderDailyWorkBrief_`)
4. **主管每日總覽** (⭐ `renderManagerDigest_` - 主管看) / **助理待處理摘要** (⭐ `renderAssistantPendingDigest_` - 助理看)
5. **分類統計卡片** (`task-summary-grid`)
6. **快速篩選器與排序控制**
7. **工作任務列表**

---

## 6. Assistant Pending Digest Content
- **標題**：📋 助理待處理摘要
- **副標**：助理待處理、等資料與異常協調進度
- **A. 助理指標**：對接現有 `stats`，顯示：今天到期、已逾期、異常 (Blocked)、等資料 (Waiting)、高優先、今日完成。
- **B. 待處理與補資料 (Top 3)**：自目前可見 tasks snapshot 中篩選未完成/未取消任務，並依照優先序排列：
  1. 等資料（Waiting / 等同仁補資料）優先
  2. 卡點異常（Blocked）優先
  3. 已逾期（Overdue）優先
  4. 高優先（High Priority）優先
  5. 今天到期（Due Today）優先
  6. 最近更新（updatedAt / id desc）優先
  *加權*：指派對象為當前助理帳號或助理角色者將優先提升曝光。
- **C. 最近動態 (Top 3)**：重用 `activities` 列表，顯示與任務有關的最近 3 筆重大異動。
- **Empty States**：
  - 當無待處理項目時顯示：`目前沒有需要助理特別追蹤的待處理事項。`
  - 當無最近動態時顯示：`目前沒有新的助理相關任務動態。`

---

## 7. Data Sources
- **統計數據**：來自 `getTaskSummaryStats_(visibleTasks)`。
- **動態日誌**：來自 `getRecentTaskActivities_(visibleTasks)`。
- **任務 snapshot**：使用目前前端載入之 visible tasks 陣列。
- **外部呼叫**：完全不調用 backend API，無任何 Spreadsheet 讀寫開銷。

---

## 8. Safety & Preserved Behavior
- **事件委派安全**：卡點清單與動態皆為純文字（HTML 唯讀），不綁定任何 `data-action` 或 `data-task-action`。業務同仁的正常任務按鈕（完成、報進度、改狀態）不受任何事件冒泡干擾。
- **現有功能無損**：
  - PWA 「一鍵複製今日摘要」功能不受影響，所複製內容依然基於個人角色（如業務或助理）。
  - Presets (快速篩選)、Smart Sort (智慧排序) 的篩選和定位逻辑保持 100% 完整。
  - 客戶端的型號、庫存、展示追蹤及 dual-mode LINE bot 功能保持正常。

---

## 9. Validation Summary
- **Stage 19-D1 (規劃審計)**：通過。
- **Stage 19-D3 (回歸驗證)**：通過。
- **Stage 19-D4 (提交審查)**：將 `app.js` 提交至 repository (`5a6ae29`)。
- **Stage 19-D5 (推送與部署)**：已 push 至 GitHub，並自動觸發 Vercel 主機線上發布。
- **Stage 19-D6 (使用者驗證)**：在 Chrome 與手機 Safari 瀏覽器下測試通過，排版無水平破版，指標數據精確對齊。

---

## 10. Known Limits & Deferred Work
- **前端數據依賴**：目前的統計與待處理 Top 3 是基於 PWA 當前所同步的 Task 陣列。
- **未實作主動提醒**：遵守 Stage 19-B 規範，不具備自動定時向助理 LINE 帳號推播摘要的功能。

---

## 11. Recommended Next Stages
- **Stage 20**：研究並稽核 LINE 主動推播的可行性與可靠帳號綁定方案。
