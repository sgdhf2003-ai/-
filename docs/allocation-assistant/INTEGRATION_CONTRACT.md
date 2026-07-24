# JYAI Allocation Assistant - INTEGRATION CONTRACT

## 1. 全域合約屬性 (Global Contract Attributes)
* **contractVersion**: `v1.0.0`
* **tenantId**: 識別特定系統租戶，預設為 `tenant-jy-001`。
* **companyId**: 識別子公司/公司上下文，預設為 `comp-jingyang-taiwan`。
* **sourceSystem**: 發起端系統標識（例如：`LINE_BOT_OCR`、`BM_WEB_UI`）。
* **sourceDraftId**: 發起端產生的原始草稿 ID。
* **operation**: 調用之 API 操作方法。
* **idempotencyKey**: 全域唯一防重鍵（UUIDv4），確保操作只執行一次。
* **correlationId**: 全域關聯 ID，便於跨模組日誌追蹤。

## 2. API 承載規格 (Payload Specs)

### API: createDraft
建立配貨草稿。
* **Request Payload**:
```json
{
  "contractVersion": "v1.0.0",
  "tenantId": "tenant-jy-001",
  "companyId": "comp-jingyang-taiwan",
  "sourceSystem": "LINE_BOT_OCR",
  "sourceDraftId": "ocr_msg_99823",
  "idempotencyKey": "idem-key-8c6e2a9b3d7f1e5c0d8f",
  "correlationId": "corr-uuid-4455-6677",
  "rawText": "顧佳575 EQA-6522 * 10 (7J25)",
  "salesOwner": "sales_owner_clerk01"
}
```
* **Response Payload**:
```json
{
  "success": true,
  "draftId": "draft_abc123xyz789",
  "status": "DRAFT",
  "errorCode": ""
}
```

### API: analyzeAllocation
分析庫存並提供分配建議。
* **Request Payload**:
```json
{
  "draftId": "draft_abc123xyz789",
  "idempotencyKey": "idem-key-8c6e2a9b3d7f1e5c0d8f"
}
```
* **Response Payload**:
```json
{
  "success": true,
  "suggestion": {
    "suggestionId": "sug_alloc_77812",
    "rationale": "林口倉批號 7J25 充足，足額分配 10 PCS。",
    "items": [
      {
        "productCode": "EQA-6522",
        "warehouseName": "林口倉",
        "batchNumber": "7J25",
        "allocatedQuantity": 10
      }
    ],
    "warnings": []
  }
}
```

### API: confirmAllocation
確認配貨明細並變更草稿狀態。
> [!IMPORTANT]
> `confirmAllocation()` 僅鎖定配貨草稿內容，**不得**直接寫入業務管家正式保留 Sheet。正式保留寫入依然由 Business Manager integration layer 負責。
* **Request Payload**:
```json
{
  "draftId": "draft_abc123xyz789",
  "confirmedItems": [
    {
      "productCode": "EQA-6522",
      "warehouseName": "林口倉",
      "batchNumber": "7J25",
      "allocatedQuantity": 10
    }
  ],
  "idempotencyKey": "idem-key-confirm-9912"
}
```
* **Response Payload**:
```json
{
  "success": true,
  "status": "ALLOCATION_CONFIRMED",
  "errorCode": ""
}
```

### API: cancelAllocation
作廢配貨草稿。
* **Request Payload**:
```json
{
  "draftId": "draft_abc123xyz789"
}
```
* **Response Payload**:
```json
{
  "success": true,
  "status": "CANCELLED"
}
```

### API: getAllocationStatus
查詢配貨狀態。
* **Request Payload**:
```json
{
  "draftId": "draft_abc123xyz789"
}
```
* **Response Payload**:
```json
{
  "success": true,
  "status": "ALLOCATION_CONFIRMED",
  "updatedAt": "2026-07-24T11:05:00Z"
}
```

## 3. 異常處理與重試機制 (Error & Retry Semantics)
* **Error Model**: 錯誤碼遵循全域標準：
  * `DRAFT_NOT_FOUND`: 找不到配貨草稿。
  * `INSUFFICIENT_STOCK`: 可用庫存不足。
  * `IDEMPOTENCY_VIOLATION`: 防重鍵重複且內容不符。
  * `PROVIDER_TIMEOUT`: 配貨 Engine 連線逾時。
* **Timeout Semantics**: Gateway 至 Engine 的呼叫超時上限為 `3000ms`。
* **Retry Semantics**: 針對網路瞬斷，Gateway 最多重試 `3` 次，重試間隔採指數退避 (Exponential Backoff, 100ms -> 300ms -> 900ms)。

## 4. 向後相容性政策 (Backward Compatibility Policy)
* API 端點均以 `/v1/...` 作為前綴。
* 新增欄位必須為非必要屬性 (Optional fields)。
* 變更或移除既有欄位必須升級主版本號 (Major version upgrade to `/v2/...`)。
