# JYAI Allocation Assistant - PROVIDER ARCHITECTURE

## 1. 架構核心元件
本模組採用 Gateway 與多 Provider 切分設計：

* **AllocationGateway**: 統一入口與調配器。前端 UI 僅能調用 Gateway API，禁止直接連線至具體的 Provider 技術實作。Gateway 負責解析租戶上下文，並調用對應的技術 Provider。
* **AllocationProvider**: 定義統一介面合約的抽象基類或介面協定（如 `createDraft()`, `analyzeAllocation()` 等）。
* **InternalProvider**: 基於本機 Google Apps Script 執行環境及既有 Sheet 庫存的本機配貨實作（第一階段啟用）。
* **ExternalProvider**: 供未來介接第三方 ERP 或進階配貨計算服務之實作，目前僅定義介面，暫不啟用。
* **SimulationProvider**: 專門用於開發階段與自動化測試（不產生任何外部 Side Effects 或資料異動）。

## 2. 租戶選取路由原則 (Provider Selection)
* 系統讀取 `SHEETS.settings` 的租戶配置。
* **禁止 UI 直接選取技術 Provider**: 前端介面嚴禁選擇 `Internal` / `Simulation` 等底層 Provider 名稱。路由邏輯應完全封裝於後端 `AllocationGateway` 內部。
* **禁止 Provider 直接發送正式通知**: 所有 Provider 僅具備「解析評估」職責，禁止在其內部寫入正式 Sheet 或發送 LINE 提醒，其通訊通知完全歸由 Business Manager App 主流程控制。

## 3. 接縫設計 (Extraction Seam)
為了在未來順利拆分或合併模組，配貨引擎與業務系統間設計了接縫：
* 所有的庫存讀取皆經由獨立的唯讀快照介面。
* 配貨建議與警告使用獨立的資料模型，不與業務管家的 Holds Table 欄位直接耦合。

## 4. 未來拆分與合併條件

### 未來拆分成獨立微服務的條件：
1. 配貨建議計算演算法變得極度複雜，需要耗用大量 CPU/GPU 資源。
2. 跨多租戶或跨國業務量增大，Apps Script 的執行時間（6分鐘限制）頻繁超時。
3. 需要與外部第三方多個倉儲系統 (WMS) 進行即時即期 API 串接。

### 合併回單一系統的條件：
1. 演算法運算規則維持穩定，無特殊效能瓶頸。
2. 業務規模收斂，單一 Google Sheets 後台即足以應付所有保留與出貨流程。
