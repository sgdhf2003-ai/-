# JYAI Allocation Assistant - PERMISSION MATRIX

本文件定義 JYAI 配貨助手模組第一階段採用的角色權限矩陣。

## 1. 權限角色矩陣

| 功能名稱 (Feature) | 一般助理 (Assistant) | 系統主管 (Owner) | 系統後台/API (System/API) |
| :--- | :---: | :---: | :---: |
| 建立配貨草稿 (`createDraft`) | 🟢 允許 | 🟢 允許 | 🟢 允許 |
| 檢視配貨建議 (`analyzeAllocation`) | 🟢 允許 | 🟢 允許 | 🟢 允許 |
| 調整與確認配貨內容 (`confirmAllocation`) | 🟢 允許 | 🟢 允許 | 🟢 允許 |
| 作廢配貨草稿 (`cancelAllocation`) | 🟢 允許 | 🟢 允許 | 🟢 允許 |
| **同步至正式保留系統並發送通知** | 🔴 拒絕 | 🟢 允許 | 🔴 拒絕 |
| **第一階段正式同步功能** | 🔴 禁用 | 🔴 禁用 | 🔴 禁用 |

*備註：在第一階段（Phase 0 & 1A），「確認建立並通知」之正式同步功能暫停啟用，所有操作僅於 Simulation 與唯讀環境執行。*

## 2. 既有權限模型差異記錄
目前業務管家的 Sheets 權限模型主要區分為：
1. `admin` (系統管理員/Owner)
2. `user` (一般業務人員)

**配貨助手對應調整與建議：**
* 既有 `user` 角色在 PWA 前端具有廣泛的 Holds 新增權限。
* 在配貨助手模組中，將嚴格限制一般 `user` 直接將草稿同步寫入正式 Holds Sheet 的權限。
* **本次決策**: 僅記錄此權限差異，本階段**不修改**正式 Sheets 及 PWA 後台既有權限驗證邏輯，以防影響現有業務運行。
