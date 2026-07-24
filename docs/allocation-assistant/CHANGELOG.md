## [v1.7.0-assistant-ocr-fulfillment] - 2026-07-25

### Added
* **業務助理 LINE OCR、模糊候選與出貨收尾閉環 (Phase 7 Sales Assistant Loop)**:
  * **OcrCandidateMatcher & ImageOcrAdapter**: 實作影像單據辨識與 Top 3 模糊候選品項選項按鈕 (`candidateOptions`).
  * **LiffMicroEditPopup**: 實作 LIFF 微型修正彈窗，含 `[10]`, `[50]`, `[500]`, `[1000]` 快捷標籤、語音/打字覆蓋解析 (`改 2000`)、大數量/庫存溢出黃色警示與原圖放大核對按鈕.
  * **FormalHoldWritebackAdapter**: 實作 Google Sheet 去保留寫入適配器，產生結構化正式單號 (`RES-YYYYMMDD-XXX`) 並將狀態更新為 `RESERVED`.
  * **FulfillmentAdapter**: 實作雙軌出貨收尾結案機制，支援 Option 2 待出貨輪播卡片 (`[🚚 全額出貨]`, `[✏️ 部分出貨]`, `[❌ 取消保留]`) 與 Option 3 文字快捷指令 (`出貨 #RES-20260725-001`, `結案 001`, `取消 #003`).
* **Production 雙端 clasp 部署發佈**:
  * 成功發佈 Backend Apps Script Web App **Version 77** (Deployment ID: `AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw`).
  * 成功發佈 LINE Bot Apps Script **Version 190** (Deployment ID: `AKfycbxioavjvzENr9duOtomZQRmbycbDtJOzKNAuSgcnE1ptNquTStiWMZwygLEHaYfPxOn`).
  * 全套 27 大模擬測試套件總數擴充至 149 / 149 PASS.

## [v1.6.0-production-sandbox-rollout] - 2026-07-24

### Added
* **正式 Apps Script 生産環境掛載與沙盒 Web App 發佈 (Production Mounting & Rollout)**:
  * 於 `google-apps-script/Code.gs` 實作 `getAllocationAssistantView()` 樣板載入器。
  * 建立 `google-apps-script/AllocationAssistantView.html` 樣板檔案。
  * 於 `index.html` 前端主視圖與導覽選單成功掛載配貨助手獨立 Tab 頁籤 (`#nav-allocation`) 與沙盒視圖容器 (`#view-allocation-sandbox`).
  * 成功執行 Apps Script 部署 (Deployment ID: `AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw` @ Version 75).
* **正式環境唯讀驗證測試套件 (Production Validation Simulation Suites)**:
  * 新增 `simulate:allocation-production-wireup` 與 `simulate:allocation-production-validation` npm 指令。
  * 全套模擬測試總數擴充至 139 / 139 PASS (共 24 大模擬測試集).

### Security Declaration
* **零正式 Sheet 修改 (Zero Sheet Mutations)**: 測試與掛載過程中無新增或刪除任何正式試算表保留列。
* **零 LINE 訊息發送 (Zero LINE Messages Sent)**: 隔離 LINE Bot 推播 API，無發送任何推播。
* **全額 Fail-Closed 防寫保護 (Full Fail-Closed Protection)**: 保持 `SANDBOX_WRITE_FORBIDDEN` 100% 作用。

## [v1.5.0-ui-sandbox-integration-demo] - 2026-07-24

### Added
* **前台沙盒介面掛載與真實體驗展示模組 (UI Sandbox Integration & Interactive Demo)**:
  * 實作 `AllocationSandboxView` 前台獨立 Tab 視圖容器與 `#view-allocation-sandbox` 掛載點。
  * 實作黃色顯眼警示橫幅 `SandboxWarningBanner` (`配貨建議試算 (唯讀沙盒模式)`).
  * 實作 `SandboxInventoryProvider` 動態對接 ReadOnlyInventoryAdapter 快照與傳送/寫入攔截防護 (`SANDBOX_WRITE_FORBIDDEN`).
  * 實作 `SandboxDemoCards` 內建 3 組真實 Demo 體驗卡片與一鍵試算觸發器 (`DEMO_EQA_6522`, `DEMO_GUJIA_575`, `DEMO_LOW_CONFIDENCE`).
* **沙盒 E2E 模擬測試套件 (Sandbox Simulation Suites)**:
  * 新增 `simulate:allocation-sandbox-view`, `simulate:allocation-sandbox-provider`, `simulate:allocation-sandbox-demo`, `simulate:allocation-sandbox-e2e` npm 指令。
  * 模擬測試總數擴充至 131 / 131 PASS (共 22 大模擬測試集).

### Security Declaration
* **零生產環境變更 (No Production Changes)**: 本階段未新增或修改任何生產環境程式碼。
* **零通知發送 (No Notifications Sent)**: 未呼叫任何 LINE Bot 推送 API 或外部 HTTP 請求。
* **零部署異動 (No clasp push/deploy)**: clasp 設定與 Apps Script 部署版本無任何異動。

## [v1.4.0-formal-holds-sync-safety] - 2026-07-24

### Added
* **正式保留同步與防重防線模組 (Formal Holds Integration & Sync Safety)**:
  * 實作 `SyncRequest` 與 `SyncResult` 合約驗證器。
  * 實作 `FormalReservationAdapter` 抽象基類與 `MockFormalReservationAdapter` 離線模擬器 (支援 UNKNOWN_OUTCOME 狀態復原查詢與 `EXPLICIT_FAIL` 模擬).
  * 實作 `AllocationSyncEngine` 狀態機轉移器 (`ALLOCATION_CONFIRMED` -> `SYNC_PENDING` -> `SYNC_IN_PROGRESS` -> `SYNCED` / `SYNC_FAILED`).
  * 實作 `SyncIdempotencyGuard` 獨立防重守衛與 payload 衝突排查機制。
* **完整同步與復原模擬測試套件 (Sync Simulation Suites)**:
  * 新增 `simulate:allocation-sync-adapter`, `simulate:allocation-sync-engine`, `simulate:allocation-sync-recovery`, `simulate:allocation-sync-full` npm 指令。
  * 模擬測試總數擴充至 115 / 115 PASS (共 18 大模擬測試集).

### Security Declaration
* **零生產環境變更 (No Production Changes)**: 本階段未新增或修改任何生產環境程式碼。
* **零通知發送 (No Notifications Sent)**: 未呼叫任何 LINE Bot 推送 API 或外部 HTTP 請求。
* **零部署異動 (No clasp push/deploy)**: clasp 設定與 Apps Script 部署版本無任何異動。

## [v1.3.0-ui-app-interactivity] - 2026-07-24

### Added
* **配貨助手前台介面與互動控制層 (UI & App Interactivity)**:
  * 實作 `AllocationUIState` 純 DOM 解耦 UI 狀態機與 ViewModel 轉譯器 (`DRAFT` -> `OCR_REVIEW` -> `ALLOCATION_REVIEW` -> `ALLOCATION_CONFIRMED`).
  * 實作 `AllocationGatewayClient` 非同步 Client Hook，封裝 Gateway 呼叫、Idempotency/CorrelationId 自動補全與 Error Normalization.
  * 實作 `AllocationViewRenderer` 樣板轉譯器（HTML Card, Warning Banners, Consent Toggle, Approval Checklist Validation & Lock Markers）.
* **完整 UI E2E 模擬測試套件 (UI Simulation Suites)**:
  * 新增 `simulate:allocation-ui-state`, `simulate:allocation-gateway-client`, `simulate:allocation-view-renderer`, `simulate:allocation-ui-e2e` npm 指令。
  * 模擬測試總數擴充至 102 / 102 PASS (共 14 大模擬測試集).

### Security Declaration
* **零生產環境變更 (No Production Changes)**: 本階段未新增或修改任何生產環境程式碼。
* **零通知發送 (No Notifications Sent)**: 未呼叫任何 LINE Bot 推送 API 或外部 HTTP 請求。
* **零部署異動 (No clasp push/deploy)**: clasp 設定與 Apps Script 部署版本無任何異動。

## [v1.2.0-readonly-sheet-integration] - 2026-07-24

### Added
* **純唯讀 Sheet 快照轉譯與適配層 (Read-Only Inventory Sheet Integration)**:
  * 實作 `ReadOnlyInventoryAdapter` 抽象基類與 Fail-Closed 機制。
  * 實作 `InventorySheetMapper` 純函式轉譯器（支援數量字串解析、負數校驗、無效列過濾與實體盤點未確認標記 `PHYSICAL_COUNT_UNCONFIRMED`）。
  * 實作 `MockSheetInventoryAdapter` 支援多倉庫存原始列資料注入與 `EMPTY_SHEET_DATA` 警告處理。
  * 升級 `SimulationProvider` 與 `AllocationGateway` 支援動態注入/連結 `ReadOnlyInventoryAdapter` 並產出即時配貨建議。
* **完整模擬測試套件 (Simulation Suites)**:
  * 新增 `simulate:allocation-adapter`, `simulate:allocation-mock-sheet`, `simulate:allocation-provider-snapshot` npm 指令。
  * 模擬測試總數擴充至 86 / 86 PASS。

### Security Declaration
* **零生產環境變更 (No Production Changes)**: 本階段未新增或修改任何生產環境程式碼。
* **零通知發送 (No Notifications Sent)**: 未呼叫任何 LINE Bot 推送 API 或外部 HTTP 請求。
* **零部署異動 (No clasp push/deploy)**: clasp 設定與 Apps Script 部署版本無任何異動。

## [v1.1.0-shadow-allocation] - 2026-07-24

### Added
* **純本機 Shadow Allocation Core Engine**:
  * 實作 `TenantContext`, `AllocationDraft`, `InventorySnapshot`, `AllocationSuggestion`, `AllocationWarning`, `AuditEvent` 資料合約與驗證器。
  * 實作 `AllocationGateway` 路由與調配器。
  * 實作 `SimulationProvider` (記憶體內草稿狀態與 idempotency 重放/衝突檢測) 與 fail-closed `ExternalProvider` (拋出 `EXTERNAL_PROVIDER_DISABLED`)。
  * 實作 `evaluateAllocationRules` 純函式規則引擎 (單倉優先、小量剩餘優先、OCR < 0.85 門檻、混批授權警告)。
  * 實作 `AuditLogger` 不可變日誌追蹤器。
* **完整模擬測試套件 (Simulation Suites)**:
  * 實作 `tests/simulations/shadow-allocation.sim.js` 涵蓋 30 項綜合情境矩陣。
  * 新增 `simulate:allocation-contract`, `simulate:allocation-gateway`, `simulate:allocation-provider`, `simulate:allocation-rules`, `simulate:allocation-audit`, `simulate:shadow-allocation` npm 指令。

### Security Declaration
* **零生產環境變更 (No Production Changes)**: 本階段未新增或修改任何生產環境程式碼。
* **零通知發送 (No Notifications Sent)**: 未呼叫任何 LINE Bot 推送 API 或外部 HTTP 請求。
* **零部署異動 (No clasp push/deploy)**: clasp 設定與 Apps Script 部署版本無任何異動。

## [v1.0.0-foundation] - 2026-07-24

### Added
* **架構決策 (Architecture Decisions)**:
  * 確立 B Engine 與 A Entry 的職責邊界，配貨 Engine 不得直接寫入 Sheet 或呼叫 LINE。
  * 定義 `AllocationGateway` 統一路由介面。
  * 定義 `InternalProvider`, `ExternalProvider`, 與 `SimulationProvider` 多 Provider 架構。
* **文件建立 (Created Files)**:
  * `README.md`: 產品定位與模組結構導航。
  * `ROADMAP.md`: 分階段開發路線圖與退出條件。
  * `BUSINESS_RULES.md`: 倉庫與批號分配的商業演算法規則。
  * `DATA_MODEL.md`: 欄位結構與狀態機定義。
  * `FLOW.md`: 循序互動圖與步驟說明。
  * `INTEGRATION_CONTRACT.md`: 整合 Payload 與 API 規格。
  * `PROVIDER_ARCHITECTURE.md`: Gateway 元件與 Provider 拆分機制。
  * `SAFETY_BOUNDARIES.md`: 安全唯讀邊界與二次確認要求。
  * `PERMISSION_MATRIX.md`: 一般助理與系統 Owner 角色權限矩陣。
  * `TEST_CASES.md`: 邊界與異常處理測試案例集。
  * `CURRENT_HANDOFF.md`: 交接日誌與下一個精確步驟。

### Security Declaration
* **零生產環境變更 (No Production Changes)**: 本階段未新增或修改任何生產環境程式碼。
* **零通知發送 (No Notifications Sent)**: 未呼叫任何 LINE Bot 推送 API 或 OneSignal 推送。
* **零部署異動 (No clasp push/deploy)**: clasp 設定與 Apps Script 部署版本無任何異動。
