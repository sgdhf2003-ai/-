# Stage 17-B Recent Activity Feed MVP Closure Note

## 1. Purpose
- 封存 Stage 17-B Recent Activity Feed MVP 實作與穩定修正。
- 目的：讓主管、業務、及助理能即時查看最近的任務動態，提升團隊協作的信任感、資料透明度及運作可視性。
- frontend-only implementation: 完全在 PWA 前端運行，無額外後端依賴，降低部署複雜度及同步成本。

## 2. Implemented Commits
- **982379c** `feat: add recent task activity feed`
  - 新增「近期動態」欄位（Recent Activity Feed）。
  - 嵌入於「今日焦點」（今日焦點）下方與「全部任務」統計卡片（summary cards）上方。
  - 支援六種動態類型：`create`（建立）、`note`（備註）、`completed`（完成）、`waiting`（等資料）、`blocked`（異常）、`general`（更新）。
  - 預設收合，點擊標題可展開/收合清單。
  - 點擊清單項目可觸發 click delegation 將 `taskSearchKeyword` 設為該任務的 `taskId`，並呼叫 `renderTasks()` 快速篩選。
  - 僅使用本地現有任務資料欄位計算，無額外後端 API 負擔。
- **e8d8063** `fix: constrain recent activity feed on mobile`
  - 初步修復手機版點擊展開後的 clipping 溢出與遮擋。
- **7af805d** `fix: stabilize recent activity mobile layout`
  - 調整手機版容器與列表高度等 CSS Layout 設定。
- **c30786b** `fix: use safe mobile layout for recent activity`
  - 手機版 summary cards 調整為 2 欄安全版，避免擠壓。
  - 移除手機版 Recent Activity 強制 `120px` 高度，改為自然展開（頁面自然往下推）。
  - 調整 `#tasksView` 底部 padding 至 `200px` 以保護 bottom nav 不遮擋內容。
- **56840c2** `fix: wrap recent activity text on mobile`
  - 針對使用者回饋的標題/備註向右超出容器、被裁切問題進行最終修正。
  - 移除 activity title/summary 元件上的 `white-space: nowrap` 設定，改為 `white-space: normal`。
  - 於 `.activity-feed` 樹狀結構加入 `min-width: 0` 及 `max-width: 100%`，並對長字串設定 `overflow-wrap: anywhere` 及 `word-break: break-word`。
  - 確保長底線 taskId、任務標題、備註文字在手機上可正常換行，徹底解決 text overflow clipping 缺陷。

## 3. Technical Summary
- **修改檔案**：
  - [app.js](file:///Users/chenhaoan/Documents/jingyang-sales-app/app.js) (點擊監聽綁定、資料處理及 DOM 渲染結構)
  - [styles.css](file:///Users/chenhaoan/Documents/jingyang-sales-app/styles.css) (CSS-only 響應式排版、文字自動換行及滾動安全間距)
- **未改動部分**：
  - `index.html` 保持 untouched
  - Google Apps Script 後端程式碼及 LINE Bot 保持 untouched
  - 任何 Sheets schema、權限規則、API endpoint、service-worker.js 及 deploy 設定保持 untouched

## 4. Recent Activity Behavior
- **預設收合**：預設僅顯示一行最新動態（最新時間與人員）。
- **完全前端運算**：使用 client-side 取得的任務陣列（包含 note concatenated strings）進行即時解析，防止因 audit log 限制造成運作異常。
- **解析邏輯**：備註動態利用 Regex `^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) ([^(]+)\(([^)]+)\)\] (.*)$` 進行精準擷取，時間戳解析具備防呆機制，若有缺漏以系統預設值/安全 fallback 替代。
- **搜尋連動**：點擊動態項目時，會自動重設 Presets 與手動下拉選單為 "all"，並在搜尋框帶入該項 taskId，無需 any 後端請求。

## 5. Mobile Fixes
- **2 欄版 Summary Grid**：手機版 grid 改為 `repeat(2, minmax(0, 1fr))`，搭配 `11px` / `16px` 字體，在極小螢幕（如 320px）上依然非常清晰、好點擊且不發生右側擠壓裁切。
- **自然展開與內部捲動**：手機上 Recent Activity Feed 清單高度不硬塞 scrolling max-height，改為自然展開，列表項目具備 compact 內邊距，提供最自然的頁面捲動體驗。
- **滾動安全閥**：`#tasksView` 底部 padding 增加至 `calc(200px + env(safe-area-inset-bottom)) !important`，確保所有卡片完全捲動高於底部的 fixed bottom nav。
- **文字換行護欄**：使用 `word-break: break-word` 及 `overflow-wrap: anywhere` 加上 flex 子項 `min-width: 0` 確保任何長字串都不會溢出容器。

## 6. Validation Summary
- `npm run check` 通過，無語法及語意錯誤。
- 後端與 LINE Bot dry-run 佈署檢查皆通過。
- 歷經 Stage 17-B3, B7, B11, B15, B19 的五次嚴格 regression validation。
- 重現使用者錄影後找出真正的 root cause 是 nowrap clipping，成功藉由 CSS font wrap / min-width 修正。
- 最終驗收確認：Work Center、全部卡片、快篩 preset、動態收合/展開、長標題自動換行、2 欄 summary cards 正常呈現，且手機完全無左右裁切或水平溢出滾動，體驗極佳。

## 7. Preserved Behavior
- **未受影響功能**：
  - `getTaskSummaryStats_` 及 `isTaskMatchingPreset_` 運算無改動。
  - 所有 dropdown 篩選、快篩 presets 及 status 狀態卡片對應的 filter predicates 未被修改。
  - 任務卡片的 smart sort 排序加權與 lazy detail 延遲渲染正常。
  - 任務編輯 Modal、新增備註流程、修改狀態及與 LINE Bot 整合 payload 保持 regression-free。

## 8. Known Limits & Deferred
- **前端本地模擬**：動態時間流為 frontend-derived 運算，若該任務的歷程資料被覆寫或刪除，動態列表也會對應重整。
- **更新時間約略**：當任務更新時，一般更新（general update）是以 `updatedAt` 為依據，存在一定程度的近似性。
- **暫未實作項目**：
  - 後端 / LINE Bot 推送通知。
  - 每日工作日報（Daily Work Brief）與一鍵複製摘要功能。
  - 管理者完成率統計圖表。
- **後續推薦實作**：Stage 17-C Daily Work Brief / 一鍵複製今日摘要功能。

## 9. Final Status
- Stage 17-B 任務正式封存，在此 closure note 建立後即可送審。
- 最新 remote commit：`56840c2 fix: wrap recent activity text on mobile`。
