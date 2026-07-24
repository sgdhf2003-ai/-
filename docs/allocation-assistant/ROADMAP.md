# JYAI Allocation Assistant - ROADMAP

## Phase 0: Foundation (基線規範與合約 — 已完工)
* **入口**: 現有 Git 基線與唯讀保留、通知流程。
* **輸出**: 專案治理合約、架構規格文件、測試範例規範。
* **測試**: 本機模擬測試集 (`simulate:all`) 及靜態部署檢查 (`deploy.py --check`) 全部 PASS。
* **退出條件**: 架構設計書與合約正式通過 Owner 審查與核准。

## Phase 1: Shadow Allocation Core (純本機 Shadow 核心 — 已完工)
* **入口**: 業務管家 App 配貨草稿與 OCR 輸入。
* **輸出**: `AllocationDraft`, `AllocationSuggestion`, `AuditEvent` 記憶體資料結構。
* **測試**: 執行純本機 30 項模擬測試矩陣 (`npm run simulate:shadow-allocation`)，74/74 PASS。
* **退出條件**: `AllocationGateway`, `SimulationProvider`, `RuleEvaluator`, `AuditLogger` 100% 覆蓋測試且無任何 Sheet / LINE Side Effects。

## Phase 2: Read-Only Sheet Inventory Integration (唯讀 Sheet 庫存快照整合 — 已完工)
* **入口**: 試算表庫存列資料與配貨草稿。
* **輸出**: `ReadOnlyInventoryAdapter`, `InventorySheetMapper`, `MockSheetInventoryAdapter`。
* **測試**: 執行 10 大模擬測試套件 (`npm run simulate:all`)，86/86 PASS。
* **退出條件**: 庫存列轉譯器、Mock 試算表適配器與 Gateway 整合 100% 覆蓋測試且無任何 Sheet / LINE 寫入 Side Effects。

## Phase 3: BM Web UI 配貨工作區 (前台介面與互動控制 — 已完工)
* **入口**: 配貨草稿、庫存快照與 UI 控制事件。
* **輸出**: `AllocationUIState`, `AllocationGatewayClient`, `AllocationViewRenderer`。
* **測試**: 執行 14 大模擬測試套件 (`npm run simulate:all`)，102/102 PASS。
* **退出條件**: UI 狀態機、Client Hook、View Renderer 轉譯器與全流程 E2E 100% 覆蓋測試且無任何 Sheet / LINE 寫入 Side Effects。

## Phase 4: Formal Holds Integration & Sync Safety (正式保留同步與防重防線 — 已完工)
* **入口**: 已確認配貨草稿 `ALLOCATION_CONFIRMED` 與保留請求。
* **輸出**: `SyncRequest`, `SyncResult`, `FormalReservationAdapter`, `MockFormalReservationAdapter`, `AllocationSyncEngine`, `SyncIdempotencyGuard`。
* **測試**: 執行 18 大模擬測試套件 (`npm run simulate:all`)，115/115 PASS。
* **退出條件**: 同步合約、Mock 保留適配器、SyncEngine 狀態機、IdempotencyGuard 防重與 Unknown-Outcome 回復 100% 覆蓋測試且無任何 Sheet / LINE 寫入 Side Effects。

## Phase 5: UI Sandbox Integration & Interactive Demo Guide (前台沙盒介面掛載與真實體驗展示 — 已完工)
* **入口**: Phase 1~4 核心引擎、UI 狀態機與同步防重防線。
* **輸出**: `AllocationSandboxView`, `SandboxInventoryProvider`, `SandboxDemoCards`, `DEMO_PRESETS`。
* **測試**: 執行 22 大模擬測試套件 (`npm run simulate:all`)，131/131 PASS。
* **退出條件**: 沙盒 Tab 容器、唯讀警示橫幅、快照 Provider 串接、Fail-Closed 防寫保護、3 組 Demo 卡片與 E2E 流程 100% 覆蓋測試且無任何 Sheet / LINE 寫入 Side Effects。

## Option 2+: UAT Demo Guide & Pre-launch Gate Checklist (UAT 驗收教案與上線前置檢核表 — 已完工)
* **入口**: Phase 5 前台沙盒介面與 DEMO 卡片體驗。
* **輸出**: `UAT_DEMO_GUIDE.md`, `PRE_LAUNCH_CHECKLIST.md`。
* **驗證**: 完整包含沙盒測試操作指引、3 組展示情境步聚、Sheet Schema 核對、Script Properties 權限與業務簽核四項評估指標。
* **退出條件**: 雙文件 100% 完整無占位符，模擬測試 131/131 PASS 並且通過 deploy.py dry-run 檢驗。

## Phase 6: Production Mounting & Sandbox Rollout (正式 Apps Script 生産環境掛載與沙盒 Web App 發佈 — 本次完成)
* **入口**: Phase 5 前台沙盒介面、Demo 卡片與 Option 2+ UAT 檢核規範。
* **輸出**: `google-apps-script/Code.gs`, `google-apps-script/AllocationAssistantView.html`, `index.html`, `Version 75 Deployment`。
* **測試**: 執行 24 大模擬測試套件 (`npm run simulate:all`)，139/139 PASS。
* **退出條件**: Code.gs Helper 進入點、HTML 主視圖與底部 Tab 頁籤成功掛載、clasp push 成功發佈 Web App Version 75、Production 唯讀驗證測試 100% 覆蓋且無 Sheet / LINE 寫入 Side Effects。
