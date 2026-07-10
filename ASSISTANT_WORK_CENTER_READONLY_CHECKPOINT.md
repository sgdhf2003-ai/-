# Assistant Work Center Read-only Baseline Checkpoint

## 1. 文件目的
此文件旨在完整記錄 Assistant Work Center 從 LINE Bot Stage 3 到 PWA Stage 4 的只讀任務中心完成狀態、部署紀錄、安全邊界與後續開發風險。
目前此 Checkpoint 作為專案功能進入 PWA 寫入型功能之前的穩定只讀基準（Read-only Baseline），以防範未來功能擴展時造成既有功能的 regression 或安全邊界破壞。

## 2. Source of Truth
本專案的程式碼管理與目錄權威如下：
- **官方主要倉庫**: `/Users/chenhaoan/Documents/jingyang-sales-app`
- **LINE Bot 原始碼**: `line-bot-apps-script/`
- **PWA 前端**: `app.js` / `index.html` / `styles.css`
- **後端 Apps Script**: `google-apps-script/`
- **禁止使用**: 任何位於 `legacy/`、`archive/` 或 `cleanup_backups/` 目錄下的備份檔案作為正式修改與部署來源。

## 3. 目前穩定版本
- **最新穩定 Commit**: `92d976d` (feat: add PWA task status visual labels stage 4-4)
- **LINE Bot 生產部署版本**: `v176` (對應 commit `c958bf4`)
- **PWA 託管平台**: Vercel Git 自動部署流程
- **Git 狀態 (Git Status)**: Clean
- **全系統 AI 模擬回歸測試 (AI Regression Simulation)**: 全數通過 (Passed)

## 4. 重要安全原則
本專案嚴格遵守以下安全原則：
1. **憑證與私鑰安全**: 不碰觸、不修改、不洩漏任何 Token、Credentials 或 Script Properties。
2. **跨專案邊界安全**: 遵守 clasp 指令與 Cwd 的限制，禁止跨專案修改。
3. **無冗餘檔案**: 不新增不必要的檔案、不移動、不刪除任何現存專案檔案。
4. **Patch 獨立性**: 不直接套用 `cleanup_backups` 的舊版 Patch，不從備份拷貝內容到正式檔。
5. **程式入口唯一性**: 嚴格保持單一的 `doPost`、`doGet` 與 `replyToLine` 入口，避免多入口造成分流錯誤。
6. **環境操作原則**: 未經任務明確允許，不執行 deploy、commit、push。
7. **品質保證**: 每個功能完成後必須完成 AI 模擬測試驗證。
8. **寫入防護**: 在實作 PWA 寫入型功能前，必須先執行架構盤點與權限盤點。

## 5. LINE Bot 完成項目

### Stage 3-1：Assistant Start Flow
- **對應 Commit**: `37cfd91`
- **完成功能**: 
  - 助理中心開始處理流程。
  - `assistant` / `admin` / `boss` 角色均可查詢待處理並點擊開始處理。
  - `Created` 狀態的工作任務會被轉換為 `Started`（執行中）。
  - 將 `startedAt`、`updatedAt`、`updatedBy` 寫入試算表。
  - 使用 `updateTaskInSheet_` 更新試算表與 `appendAuditLog_` 寫入歷史歷程。
  - 向 LINE 端回覆單張格式化的助理工作卡片。

### Stage 3-2：Status Flow
- **對應 Commit**: `c958bf4`
- **生產版本**: `v176`
- **完成功能**:
  - 提供 `complete_flow` (完成流程問詢)。
  - 提供 `complete_notify` (執行完成與通知交辦人)。
  - 提供 `problem_flow` (異常處理回報)。
  - 提供 `missing_data_flow` (缺資料流程回報)。
  - 提供 `change_status` (變更狀態)。
  - 完整支援 `Waiting`（等待補資料）、`Blocked`（異常）、`Finished`（已完成）狀態流。
  - 提供防呆的固定選項，避免使用 CacheService 自訂輸入造成欄位溢位。
  - 當找不到交辦人 LINE ID 時，設計有 Exception 安全防線，可記錄但不報錯。
  - 狀態變更時自動調用 `appendAuditLog_` 寫入歷程。

### Promo Card Disable
- **對應 Commit**: `f6b4d8e`
- **完成功能**:
  - 促銷商品圖卡功能已被 Hard Disabled (強行停用)。
  - `isPromoCardEnabled_()` 恆傳回 `false`。
  - LINE 商品查詢流程不再附加促銷圖卡按鈕，杜絕無限循環回覆與版面凌亂。

## 6. PWA 完成項目

### Stage 4-1：只讀任務中心
- **對應 Commit**: `b1b6795`
- **完成功能**:
  - PWA 首頁網格新增「工作任務」入口。
  - 新增 `#tasksView` 任務管理視角版面。
  - 任務列表支援 狀態、指派角色、指派對象（業務員）前端只讀篩選。
  - `syncFromCloud()` 保留讀取 tasks 合併邏輯。
  - `pushSnapshotToCloud()` 的 JSON Payload 絕不寫回 `tasks`，維護唯讀性。
  - 任務卡上無任何 新增、編輯、刪除、完成 按鈕。

### Stage 4-1.1：顯示格式修正
- **對應 Commit**: `40ad891`
- **完成功能**:
  - 日期一律以台灣時區 (UTC+8) 格式化為 `YYYY/MM/DD`。
  - 將 `orderInput` 等代碼在顯示層中文化為「📝 待打訂單」。
  - 角色名稱中文化。
  - 當指派角色為 `assistant` 且 `assignedTo` 為空時，指派對象顯示為「助理群組」。

### Stage 4-1.2 / 4-1.3：角色篩選文案
- **對應 Commit**: `846c708`、`d0fd0fa`
- **完成功能**:
  - 角色篩選選單名稱中文化。
  - `boss` 顯示文案與名稱統一為「主管」。

### Stage 4-2：任務詳情只讀展開
- **對應 Commit**: `3ffe46e`
- **完成功能**:
  - 每張任務卡底部新增「查看詳情」/「收合詳情」唯讀切換按鈕。
  - 屬性中 `detailKey` 一律使用 `encodeURIComponent` 編碼以防 ID 符號破版與 DOM 注入。
  - 展開區塊以 Grid 列出詳細任務欄位，並過濾 `undefined`。
  - 本地從 `state.auditLogs` 查詢該任務最近 5 筆操作歷程（按時間遞減），並唯讀顯示。

### Stage 4-3：任務統計摘要
- **對應 Commit**: `cfeac1a`
- **完成功能**:
  - 任務清單上方新增只讀統計摘要面板：包含全部、助理待處理、等待補資料、異常、今天到期、已完成。
  - 統計面板數據計算一律在角色安全邊界（`visibleTasks`）篩選後執行，不洩漏越權資料。
  - 點擊摘要卡會直接切換狀態篩選選單值，並自動重渲染，完全只讀無 Cloud 寫回。

### Stage 4-3.1：手機底部安全距離與詳情可讀性
- **對應 Commit**: `14836c3`
- **完成功能**:
  - 在 CSS 中對 `#tasksView` 新增 `padding-bottom`，預留至少 `140px` 加 `safe-area` 空間，預防按鈕被固定底部導覽列遮擋。
  - 改善詳情區文字可選取性與顏色對比。

### Stage 4-4：任務狀態視覺標籤
- **對應 Commit**: `92d976d`
- **完成功能**:
  - 引入 `getTaskStatusMeta_(status)` Helper 統一狀態 Label 與樣式標籤。
  - 任務卡右上角引入 `task-status-badge` 狀態標籤。
  - 任務卡左側引入基於狀態 className 的條狀色彩條（如異常為紅色、完成為綠色）。
  - 移除原先 `statusMap` 變數以防重複定義。

## 7. 全系統 AI 模擬回歸測試結果
- **LINE Bot (A-G)**: 模擬商品查詢、助理待處理、開始處理、缺資料流程、回報異常流程、完成流程與權限防線，全數測試通過。
- **PWA (H-M)**: 模擬首頁入口、角色權限可見邊界、篩選統計點擊、詳情展開安全、狀態視覺標籤與唯讀 Payload 防線，全數測試通過。
- **Backend / Deploy (N)**: Dry-run check 顯示 clasprc 與 credentials 均安全，檢測狀態 VALID。
- **核心入口**: `doPost` (1個)、`doGet` (1個)、`replyToLine` (1個) 符合唯一性。
- **促銷圖卡**: 維持 Disabled。
- **商品查詢**: 流程完好存在。

## 8. 目前已知問題
- **P0 級別問題**: 無。
- **P1 級別問題**:
  - **`app.js` inline style 覆蓋 styles.css 的 background 樣式**: 
    - *問題描述*: `app.js` 在渲染詳細面板時指定了行內樣式 `background: var(--panel-2);`，這使得 `.task-detail-panel` 在外部 `styles.css` 中所自訂的半透明背景色被覆蓋失效。
    - *影響分析*: 目前文字可讀性對比度良好，不影響正常運作，此 UI 細節建議留待未來 UI 清理時處理，不需要為了此細微問題擴大 JavaScript 修改。
- **P2 級別問題**: 無。

## 9. 下一階段建議
若要進入寫入型功能（如 PWA 任務更新或新增），請先執行 **Stage 5-0** 盤點，切勿直接開發：
1. **Backend API 盤點**: 確保 Sheet 後端對應的 `updateTaskStatus` 或 `createTask` API 結構已部署或完成配置。
2. **權限模型盤點**: 確定 PWA 提交更新時的使用者角色與 API 認證機制，防範越權修改。
3. **Audit Log 格式一致性**: 確保 PWA 的 API 寫入產生的 Log 與 LINE Bot 產生的 `state.auditLogs` 欄位結構（如 workId, action, operator, fromStatus, toStatus）完全對齊。
4. **狀態互斥與競態防止**: 確保 PWA 不會意外覆寫 LINE Bot 當前由助理操作中的鎖定狀態。
5. **測試資料隔離**: 設計安全隔離的測試資料策略，避免測試資料寫入正式生產試算表。
6. **回歸驗證**: 寫入功能上線後需再次進行全系統回歸測試。

## 10. 禁止事項摘要
- **嚴禁**寫入任何真實的 Token、Secret 或 API Key 於任何 Markdown 文件中。
- **嚴禁**在 `pushSnapshotToCloud` 中加入 `tasks: state.tasks` payload。
- **嚴禁**未經 Stage 5-0 盤點就實作或發布 PWA 任務變更寫入邏輯。
