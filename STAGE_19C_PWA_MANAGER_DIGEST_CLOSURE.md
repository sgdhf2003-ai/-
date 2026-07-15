# Stage 19-C PWA Manager Digest Panel Closure Note

## 1. Purpose
本文件為 **Stage 19-C PWA Manager Digest Panel** 的封存備忘錄。
- **目的**：在 Work Center 任務中心中，針對管理職位（`boss`/`admin`/`manager`）安全提供主管每日總覽。
- **解決痛點**：主管無需手動過濾個別成員，即可快速在一眼內掌握團隊的「任務卡點異常」、「逾期 backlog」以及「最近動態更新」。
- **設計架構**：本功能完全以 **frontend-only** 方式實現，不涉及資料庫變更或 LINE 主動推播，保障系統極致的輕量與安全。
- **承接歷史**：本功能延續並整合了 Stage 17（PWA 今日工作摘要）、Stage 18（LINE 快速指令連結導流）與 Stage 19-B（通知策略安全原則白皮書）。

---

## 2. Implemented Commit
- **`940b0e1` feat: add manager digest panel**
  - 在 `app.js` 新增主管角色判定 helper `isManagerRole_(role)`。
  - 在 `app.js` 新增主管總覽模組渲染器 `renderManagerDigest_(stats, activities, tasks)`。
  - 將主管總覽卡片與現有 `stats`（ getTaskSummaryStats_）與 `activities`（getRecentTaskActivities_）對接，保障指標數據完全一致。
  - 在 PWA 初始化渲染樹中，精確將該卡片插入於 Daily Work Brief 下方、Summary Cards 上方。

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
- **安全防線**：
  - 無 `doPost`/`doGet` 新增或修改。
  - 無 LINE `push`/`multicast`/`broadcast` 主動推送。
  - 無任何自動排程或計時器觸發。
  - 主管追蹤卡片上不設置任何編輯、更新或附註按鈕，僅為唯讀面板。

---

## 4. Role Behavior
- **可見角色 (Visible)**：
  - `boss` (主管)
  - `admin` (系統管理員)
  - `manager` (專案經理)
- **隱藏角色 (Hidden)**：
  - `retailSales` / `retail` / `sales` (零售業務)
  - `showroomSales` / `showroom` (門市業務)
  - `assistant` (助理)
  - 任何未知、空白或未登入身分。
- **容錯處理**：當 `state.currentUser` 或其 role 屬性遺失時，預設回傳 `false` 不顯示，保證不發生 crash。

---

## 5. Render Placement
在 PWA `renderTasks` 中，卡片的精確渲染順序如下：
1. **今日焦點** (`renderTaskDashboardFocus_`)
2. **最近任務動態** (`renderRecentActivityFeed_`)
3. **今日工作摘要** (`renderDailyWorkBrief_`)
4. **主管每日總覽** (⭐ `renderManagerDigest_` - 本次新增)
5. **分類統計卡片** (`task-summary-grid`)
6. **快速篩選器與排序控制**
7. **工作任務列表**

---

## 6. Manager Digest Content
- **標題**：👑 主管每日總覽
- **副標**：團隊任務風險與今日追蹤重點
- **A. 管理指標**：對接現有 `stats`，顯示：今天到期、已逾期、異常 (Blocked)、等資料 (Waiting)、高優先、今日完成。
- **B. 團隊追蹤風險 (Top 3)**：自任務 snapshot 中自動過濾出非完成/非取消之風險任務，排序邏輯：
  1. 卡點異常（Blocked）最久者優先
  2. 已逾期者優先
  3. 高優先權（High / Urgent）優先
  4. 今天到期（Due Today）優先
  5. 最近更新者優先
- **C. 團隊重大動態 (Top 3)**：重用 `activities` 列表，顯示同仁的最近重大異動。
- **Empty States**：
  - 當無風險任務時顯示：`目前沒有需要主管特別追蹤的高風險任務。`
  - 當無最近動態時顯示：`目前沒有新的重大任務動態。`

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
- **Stage 19-C1 (規劃審計)**：通過。
- **Stage 19-C3 (回歸驗證)**：通過。
- **Stage 19-C4 (提交審查)**：將 `app.js` 提交至 repository (`940b0e1`)。
- **Stage 19-C5 (推送與部署)**：已 push 至 GitHub，並自動觸發 Vercel 主機線上發布。
- **Stage 19-C6 (使用者驗證)**：在 Chrome 與手機 Safari 瀏覽器下測試通過，排版無水平破版，指標數據精確對齊。

---

## 10. Known Limits & Deferred Work
- **前端數據依賴**：目前的統計與風險 Top 3 是基於 PWA 當前所同步的 Task 陣列。
- **未實作主動提醒**：遵守 Stage 19-B 規範，不具備自動定時向主管 LINE 帳號推播摘要的功能。

---

## 11. Recommended Next Stages
- **Stage 19-D**：規劃並實作 PWA 助理待處理工作專屬面板 (Assistant Pending Panel)。
- **Stage 20**：研究並稽核 LINE 主動推播的可行性與可靠帳號綁定方案。
