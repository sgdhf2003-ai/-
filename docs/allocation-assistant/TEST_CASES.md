# JYAI Allocation Assistant - TEST CASES

## 1. 庫存配貨模擬測試案例 (Allocation Scenarios)

### EQA-6522 / 7J25 基準案例
* **輸入**: 品號 `EQA-6522`，數量 `10`，批號指定 `7J25`
* **庫存狀態**: 林口倉 (7J25: 15 PCS)
* **預期結果**: 建議分配：林口倉 - 7J25 - 10 PCS。狀態為 `ALLOCATION_REVIEW`。

### 案例 1：單批足量 (Single Batch Sufficient)
* **輸入**: 品號 `EQA-6522`，數量 `5`
* **庫存狀態**: 林口倉 (7J25: 15 PCS)
* **預期結果**: 建議分配：林口倉 - 7J25 - 5 PCS。理由：優先選用單一倉庫足額批號。

### 案例 2：單批不足 (Single Batch Insufficient)
* **輸入**: 品號 `EQA-6522`，數量 `20`
* **庫存狀態**: 林口倉 (7J25: 15 PCS)
* **預期結果**: 系統發出警告 `STOCK_INSUFFICIENT`，將草稿轉入人工修正。

### 案例 3：多批可供選擇 (Multiple Batches Available)
* **輸入**: 品號 `EQA-6522`，數量 `5`
* **庫存狀態**: 林口倉 (7J25: 3 PCS, 8K12: 8 PCS)
* **預期結果**: 建議分配：林口倉 - 8K12 - 5 PCS。理由：優先分配單批能足額之批號，避免混批。

### 案例 4：需要混批但未授權 (Mixing Required But Unauthorized)
* **輸入**: 品號 `EQA-6522`，數量 `10`
* **庫存狀態**: 林口倉 (7J25: 5 PCS, 8K12: 6 PCS)
* **預期結果**: 系統發出警告 `BATCH_MIXING_REQUIRED`，狀態卡在 `ALLOCATION_REVIEW`，等待人工確認授權混批。

### 案例 5：跨倉才足量 (Cross-Warehouse Required)
* **輸入**: 品號 `EQA-6522`，數量 `12`
* **庫存狀態**: 林口倉 (7J25: 8 PCS)，忠義倉 (7J25: 6 PCS)
* **預期結果**: 系統發出警告 `CROSS_WAREHOUSE_REQUIRED`，列出跨倉建議分配方案。

### 案例 6：Sheet 庫存與實體庫存不一致 (Sheet vs Physical Mismatch)
* **輸入**: 系統建議配貨 林口倉 - 7J25 - 10 PCS
* **庫存狀態**: 實體出貨時發現林口倉無實體貨品（系統帳差）
* **預期結果**: 助理在 UI 將已確認之建議修改為 忠義倉 - 7J25，重新發起 `confirmAllocation`。

## 2. OCR 可信度測試案例 (OCR Confidence Scenarios)

### 案例 7：OCR 品號低可信度 (OCR Item Low Confidence)
* **輸入**: OCR 解析文字為 `EQ?-6522?`，可信度評分 `70%`
* **預期結果**: 系統標示狀態為 `OCR_REVIEW`，前端高亮顯示該欄位，阻擋自動配貨。

### 案例 8：OCR 數量低可信度 (OCR Qty Low Confidence)
* **輸入**: OCR 解析數量模糊為 `10`（可能為10或19），可信度 `60%`
* **預期結果**: 系統標示狀態為 `OCR_REVIEW`，助理必須人工核對 LINE 原始訊息。

## 3. 防重與例外測試案例 (Deduplication & Exception Scenarios)

### 案例 9：重複 sourceDraftId (Duplicate sourceDraftId)
* **輸入**: 傳入相同 `sourceDraftId`
* **預期結果**: 系統攔截並回傳已存在之 `draftId` 與其當前狀態，防止重複解析。

### 案例 10：重複 idempotencyKey (Duplicate idempotencyKey)
* **輸入**: 同步請求發送兩次相同的 `idempotencyKey`
* **預期結果**: 第二次請求被 Gateway 拒絕，回傳 `IDEMPOTENCY_VIOLATION`。

### 案例 11：Provider 連線逾時 (Provider Timeout)
* **輸入**: Engine 計算耗時超過 `3000ms`
* **預期結果**: Gateway 自動發起重試，若重試 3 次皆超時，則回傳 `PROVIDER_TIMEOUT` 並記錄日誌。

### 案例 12：External Provider 回傳未知狀態 (External Provider Unknown State)
* **輸入**: 外部 API 回傳未定義之狀態代碼
* **預期結果**: 系統回傳 `SYNC_FAILED`，ErrorCode 標註 `UNKNOWN_EXTERNAL_STATE`，進入人工調查。

### 案例 13：正式保留成功但 Response 遺失 (Reservation Success, Response Lost)
* **輸入**: 寫入 Google Sheet 成功，但連線中斷未收到回應
* **預期結果**: 助理在 UI 點選重試，重試請求攜帶相同 `idempotencyKey`，後端發現已同步，直接回傳 `SYNCED` 與原有 `ReservationId`。

### 案例 14：通知成功但回應未知 (Notification Success, Response Unknown)
* **輸入**: LINE API 成功發送，但因連線問題回傳未知錯誤
* **預期結果**: 系統在 Audit Log 中將該通知狀態標記為 `UNKNOWN_OUTCOME`，保留人工核對路徑。

## 4. 權限邊界測試案例 (Authorization Scenarios)

### 案例 15：Owner 未授權 (Owner Unauthorized)
* **輸入**: 助理點選同步，但未取得主管 (Owner) 的數位確認戳記 (Approval Token)
* **預期結果**: 寫入攔截，拋出 `UNAUTHORIZED_SYNC_BLOCKED` 錯誤。

### 案例 16：非 Owner 嘗試第二次確認 (Non-Owner Second Confirmation)
* **輸入**: 一般助理帳號嘗試越權調用 `confirmAllocation` 並直接觸發正式保留
* **預期結果**: 後端 API 權限檢測攔截，回傳 `PERMISSIONS_DENIED`。
