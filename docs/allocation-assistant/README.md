# JYAI Allocation Assistant (JYAI 配貨助手) - README

## 1. 產品定位 (Product Positioning)
JYAI Allocation Assistant (JYAI 配貨助手) 是勁揚業務管家系統的智慧輔助模組。透過結合 OCR（光學字元辨識）與庫存多批號分析演算法，自動解析保留物品內容，並生成最佳配貨建議，藉以提升倉儲管理與業務保留處理的效率。

## 2. 目前問題 (Current Problems)
* 助理人工辨識 LINE 照片中的出貨/保留需求，耗時且容易看錯品號或數量。
* 既有庫存包含多個批號（例如 Linkou 倉及 Zhongyi 倉），人工手動配貨與選批容易造成不均或混料。
* 缺乏自動防重機制，容易因重複訊息而導致重複保留與通知主管。

## 3. 系統使用者 (Target Users)
* **一般助理 (Assistants)**: 負責匯入/建立保留草稿、檢視系統配貨建議、並在調整後送出。
* **主管/Owner**: 負責最終配貨確認與授權，批准將配貨草稿同步至正式保留系統。

## 4. 系統範圍 (System Scope)
* **包含**: OCR 正規化解析、批號與庫存水位分析、倉庫與批號推薦演算法、配貨草稿生命週期管理、人工第二次確認介面。
* **不包含**: 直接寫入正式保留 Sheet、直接發送 LINE 提醒、繞過 Gateway 的直連呼叫。

## 5. A 入口 / B 引擎架構 (A Entry / B Engine Architecture)
本系統將前端入口與後端配貨引擎徹底分離：
* **A (Business Manager App - Entry)**: 負責使用者登入、公司與租戶上下文、人工確認 UI、正式保留的建立與 LINE 通知邏輯。
* **B (Allocation Engine - Engine)**: 負責將 OCR 資料正規化、解析品號數量、分析多批號庫存，並回傳配貨建議。

## 6. 第一階段狀態 (Phase 1 Status)
第一階段僅啟用 **Internal Provider** 與 **Simulation Provider**，專注於本機模擬配貨與庫存唯讀分析，External Provider 僅定義介面，暫不啟用。

## 7. 文件導航 (Documentation Navigation)
* [ROADMAP.md](file:///Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app/docs/allocation-assistant/ROADMAP.md): 模組的分階段發展計畫。
* [BUSINESS_RULES.md](file:///Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app/docs/allocation-assistant/BUSINESS_RULES.md): 配貨規則與批號分配邏輯。
* [DATA_MODEL.md](file:///Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app/docs/allocation-assistant/DATA_MODEL.md): 資料欄位與狀態定義。
* [FLOW.md](file:///Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app/docs/allocation-assistant/FLOW.md): 保留與配貨的流程圖及交互步驟。
* [INTEGRATION_CONTRACT.md](file:///Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app/docs/allocation-assistant/INTEGRATION_CONTRACT.md): API 規格與 Provider 介面合約。
* [PROVIDER_ARCHITECTURE.md](file:///Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app/docs/allocation-assistant/PROVIDER_ARCHITECTURE.md): 多 Provider 機制與 Gateway 路由。
* [SAFETY_BOUNDARIES.md](file:///Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app/docs/allocation-assistant/SAFETY_BOUNDARIES.md): 系統安全性隔離與寫入防護邊界。
* [PERMISSION_MATRIX.md](file:///Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app/docs/allocation-assistant/PERMISSION_MATRIX.md): 權限角色矩陣。
* [TEST_CASES.md](file:///Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app/docs/allocation-assistant/TEST_CASES.md): 系統模擬測試案例與邊界情況。

## 8. 禁止事項 (Prohibited Items)
> [!CAUTION]
> * 禁止在配貨引擎內直接寫入正式 Sheet 庫存與保留表。
> * 禁止在配貨引擎內呼叫 LINE Bot API 發送通知。
> * 禁止跳過 Allocation Gateway 或人工確認程序。
