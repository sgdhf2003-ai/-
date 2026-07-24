# JYAI Allocation Assistant - BUSINESS RULES

## 1. 倉庫與批號分配原則
* **單一倉庫優先 (Single Warehouse Priority)**: 分配庫存時，優先由單一倉庫（如林口倉或忠義倉）足額出貨。只有在單一倉庫均不足量時，才考慮跨倉庫組合分配。
* **不可任意混批 (No Arbitrary Batch Mixing)**: 同一品項的出貨應盡可能使用相同批號，避免造成客戶收貨時批號雜亂。
* **混批須客戶同意 (Mixing Requires Customer Consent)**: 當庫存不足必須使用多個批號出貨時，配貨建議必須標示「需要混批」，且最終確認前必須取得客戶或業務代表的明確同意。
* **小量剩餘批號優先 (Small Remaining Batch Priority)**: 當有多個批號可供選取時，優先分配剩餘數量較少、足以一次出清的批號，以減少倉庫零星批號的呆滯庫存。
* **倉庫於保留階段決定 (Warehouse Decided at Reservation Stage)**: 保留物品建立時即須鎖定分配之倉庫，以便後續出貨階段實體備貨。

## 2. 庫存與可信度處理規則
* **系統庫存與實體庫存可能不一致 (System vs Physical Inventory Mismatch)**: 由於盤點時間差或手動登記延遲，Sheet 上的系統庫存可能與現場實體庫存不符。配貨建議僅為決策參考，最終出貨仍以現場為主。
* **不可超額分配 (No Overallocation)**: 系統配貨數量絕對不可超過該批號在 Sheet 上的現有可用庫存。若總可用庫存不足，則系統應提出「庫存不足警告」並將草稿轉入人工處理。
* **低可信度必須人工確認 (Low Confidence Manual Override)**: 當 OCR 解析出的品號、數量或客戶可信度評分低於 85% 時，系統必須標示為 `OCR_REVIEW`，要求助理手動核對並更正。
* **不可因 OCR 信心不足自動建立正式保留**: 若 OCR 解析存在任何疑慮，絕對禁止自動同步至正式系統。
* **最終正式建立必須二次確認 (Final Confirmation)**: 所有配貨草稿，不論 OCR 信心分數多高，皆須在 Business Manager App 中經由人工進行第二次核對與確認，方可同步寫入正式 Sheets 並發送通知。
