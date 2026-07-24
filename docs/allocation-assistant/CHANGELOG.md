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
