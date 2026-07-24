# JYAI Allocation Assistant - CHANGELOG

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
