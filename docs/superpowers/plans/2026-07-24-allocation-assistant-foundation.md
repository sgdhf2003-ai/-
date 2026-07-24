# JYAI Allocation Assistant Foundation - Implementation Plan

## 1. 專案目標與定位
本計畫旨在為 `jingyang-sales-app` 專案導入 **JYAI Allocation Assistant (JYAI 配貨助手)** 模組，奠定其架構設計與資料合約基石，以利後續階段開發 OCR 正規化解析、批號分配演算法及人工二次確認功能。

## 2. 系統架構設計

### 統一分層架構 (Unified Layers)
1. **Business Manager App (A 入口)**: 負責權限驗證、租戶上下文加載、確認配貨及執行正式保留同步與發送 LINE 通知。
2. **Allocation Gateway**: 連接 A 入口與配貨引擎的中介層，根據租戶配置動態路由至特定的 Provider。
3. **AllocationProvider**: 抽象介面合約，定義配貨引擎的標準 API 操作。
4. **Internal Provider (第一階段啟用)**: 基於 Google Apps Script 執行環境及 Sheet 庫存的本機配貨建議實作。
5. **Simulation Provider (本機測試)**: 離線模擬測試 Provider，無生產環境 side effects。
6. **External Provider (暫不啟用)**: 未來介接第三方 WMS/ERP 之技術 Provider。

### 職責劃分 (Separation of Concerns)
* **B (配貨 Engine)**: 僅負責 OCR 正規化、品號數量解析、庫存 snapshot 比對，並回傳配貨建議。不允許直接修改 Sheets 正式保留表與庫存表，不允許調用 LINE Bot API。
* **A (業務管家 App)**: 負責調用 Sheet 寫入 API 建立正式保留、發送 LINE 通知、及人工二次確認。

## 3. 安全邊界與防重機制

### 安全限制
* 本次 Foundation 階段為 **100% 唯讀盤點與文件建立**。
* 嚴禁任何 Sheet 寫入、LINE Bot 部署或生產環境程式碼變更。

### 防重機制
* 每次配貨草稿同步時均攜帶唯一的 `idempotencyKey`（防重鍵）以避免重複建立保留。
* LINE Bot 採用 HMAC SHA-256 簽章及時間戳記過濾，防止重放攻擊 (Replay Attack)。
* 正式保留日誌設有每日防護鍵 (Task-day guard key)，避免同一天對同一項任務發送多封通知。

## 4. 驗證與測試計畫

### 靜態檢查與模擬測試
1. 執行 `npm run check` 確認代碼語法正確性。
2. 執行 `npm run simulate:all` 跑完所有 45 項本機模擬測試，包含 `task-notification-log`、`task-due-candidates`、`secure-push`、`login-binding` 等。
3. 執行 `python3 deploy.py backend --check` 及 `python3 deploy.py line-bot --check` 驗證 clasp 部署配置與程式碼中無密鑰洩漏。
4. 執行 `git diff --check` 驗證無格式或多餘空白錯誤。

### 手動審查
* 請系統 Owner 逐一檢查 [docs/allocation-assistant/](file:///Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app/docs/allocation-assistant/) 目錄下的所有 Foundation 設計文件。

## 5. 交接與下一個步驟
* 當 Owner 審查並批准此 Foundation 文檔後，下一階段的精確步驟是啟動 **Phase 1A**，實作草稿結構與本地 `SimulationProvider` 計算核心。
