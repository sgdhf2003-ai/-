# JYAI Allocation Assistant - SAFETY BOUNDARIES

本文件確立配貨助手與業務管家正式系統的安全隔離界線，防止非授權寫入與通知。

## 1. 讀取邊界 (Read Boundary)
* 配貨助理模組僅被允許唯讀存取現有庫存表及保留物品表。
* 所有庫存分析均應使用 `InventorySnapshot` 複本，禁止對原始資料庫連接進行獨佔鎖定。

## 2. 草稿寫入邊界 (Draft Write Boundary)
* 草稿表 `AllocationDraft` 與建議表 `AllocationSuggestion` 屬於暫存性質，其寫入不會影響正式保留或出貨單據。
* 草稿資料的變更不會觸發任何自動扣庫存邏輯。

## 3. 正式保留寫入邊界 (Official Reservation Boundary)
* 配貨引擎 B 絕對不被允許直接對 `SHEETS.holds` 進行寫入。
* 正式保留必須由 Business Manager integration layer 呼叫既有的 `upsertHolds()` 後端函式執行，且執行前必須進行人工二次確認（Human-in-the-loop）。

## 4. 庫存異動邊界 (Inventory Mutation Boundary)
* 系統庫存的扣除、轉倉與異動屬於倉儲系統核心，配貨助理模組無權修改正式庫存。
* 分配建議不等於實體出庫，僅作為出貨助理操作實體備貨的決策參考。

## 5. 通知邊界 (Notification Boundary)
* 配貨助理模組內部嚴禁直接呼叫 LINE Messaging API (`pushMessage` / `replyMessage`)。
* 只有在 Business Manager integration layer 成功建立正式保留且確認授權後，方能調用 LINE Bot doPost 的專屬推送途徑進行通知。

## 6. 部署邊界 (Deployment Boundary)
* 配貨引擎模組與 Apps Script 專案實體隔離。
* 部署使用獨立的 CI/CD 或 clasp 腳本，避免程式碼在 clasp push 時覆蓋既有業務管家邏輯。

## 7. 生產環境核准邊界 (Production Approval Boundary)
* 任何將配貨草稿同步至正式保留的執行，皆必須通過 Owner 的人工雙重認證與授權。
* 未經授權，系統不得自動執行任何具有外部副作用之 API 寫入操作。
