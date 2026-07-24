# JYAI Allocation Assistant - ROADMAP

## Phase 0: Foundation (本次完成)
* **入口**: 現有 Git 基線與唯讀保留、通知流程。
* **輸出**: 專案治理合約、架構規格文件、測試範例規範。
* **測試**: 本機模擬測試集 (`simulate:all`) 及靜態部署檢查 (`deploy.py --check`) 全部 PASS。
* **退出條件**: 架構設計書與合約正式通過 Owner 審查與核准。

## Phase 1: Shadow Allocation Core (純本機 Shadow 核心 — 本次完成)
* **入口**: 業務管家 App 配貨草稿與 OCR 輸入。
* **輸出**: `AllocationDraft`, `AllocationSuggestion`, `AuditEvent` 記憶體資料結構。
* **測試**: 執行純本機 30 項模擬測試矩陣 (`npm run simulate:shadow-allocation`)，74/74 PASS。
* **退出條件**: `AllocationGateway`, `SimulationProvider`, `RuleEvaluator`, `AuditLogger` 100% 覆蓋測試且無任何 Sheet / LINE Side Effects。

## Phase 2: Read-Only Sheet Inventory Integration (唯讀 Sheet 庫存快照整合 — 本次完成)
* **入口**: 試算表庫存列資料與配貨草稿。
* **輸出**: `ReadOnlyInventoryAdapter`, `InventorySheetMapper`, `MockSheetInventoryAdapter`。
* **測試**: 執行 10 大模擬測試套件 (`npm run simulate:all`)，86/86 PASS。
* **退出條件**: 庫存列轉譯器、Mock 試算表適配器與 Gateway 整合 100% 覆蓋測試且無任何 Sheet / LINE 寫入 Side Effects。

## Phase 3: BM Web UI 配貨工作區 (前台介面與互動控制 — 本次完成)
* **入口**: 配貨草稿、庫存快照與 UI 控制事件。
* **輸出**: `AllocationUIState`, `AllocationGatewayClient`, `AllocationViewRenderer`。
* **測試**: 執行 14 大模擬測試套件 (`npm run simulate:all`)，102/102 PASS。
* **退出條件**: UI 狀態機、Client Hook、View Renderer 轉譯器與全流程 E2E 100% 覆蓋測試且無任何 Sheet / LINE 寫入 Side Effects。

## Phase 4: Formal Holds Integration & Sync Safety (下階段規劃)
* **入口**: 使用者於 UI 修改並點選確認配貨建議。
* **輸出**: 更新 `AllocationDraft` 狀態為 `ALLOCATION_CONFIRMED` 並準備進行同步。
* **測試**: 模擬前端確認操作，驗證狀態機轉換合規性。
* **退出條件**: 草稿狀態變更為 `SYNC_PENDING`，並且系統完整記錄 AuditEvent 追蹤日誌。

## Phase 1D: 重用正式保留與通知流程
* **入口**: 處於 `SYNC_PENDING` 的配貨草稿。
* **輸出**: 呼叫 `Business Manager integration layer` 寫入正式 `holds` 工作表，發送正式 LINE 提醒。
* **測試**: 整合測試驗證防重機制（Idempotency Key / Dedupe Key），確保不重複寫入與通知。
* **退出條件**: 正式保留寫入成功，LINE 推送成功，草稿狀態變更為 `SYNCED`。

## Phase 2: External Provider
* **入口**: 租戶配置為 External Provider。
* **輸出**: 透過 Gateway 調用外部 API 獲取配貨建議與狀態。
* **測試**: 使用 Mock 伺服器進行斷線、超時與未知狀態處理測試。
* **退出條件**: 外部 Provider 對接完成，處理逾時與重試機制運作正常。

## Phase 3: 多公司 / 多租戶
* **入口**: 包含多個 `tenantId` 與 `companyId` 的請求 payload。
* **輸出**: 基於多租戶上下文的安全資料隔離與配貨。
* **測試**: 多租戶越權讀寫模擬測試，驗證安全邊界。
* **退出條件**: 系統完全支援多公司、多租戶隔離配貨與同步。
