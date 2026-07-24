# JYAI Allocation Assistant - DATA MODEL

## 1. 狀態機定義 (States)
* **DRAFT**: 草稿初始狀態，已建立但尚未完成 OCR 正規化或庫存分析。
* **OCR_REVIEW**: OCR 解析信心評分低於 85%，待人工確認或修正解析內容。
* **ALLOCATION_REVIEW**: 配貨引擎已產出建議，等待人工進行第二次配貨審查與確認。
* **ALLOCATION_CONFIRMED**: 人工已確認配貨建議，鎖定配貨內容。
* **SYNC_PENDING**: 準備同步至業務管家正式保留系統（`SHEETS.holds`）。
* **SYNC_IN_PROGRESS**: 正在執行寫入工作表與發送 LINE 通知的同步事務。
* **SYNCED**: 成功同步寫入正式保留，本配貨流程結束。
* **SYNC_FAILED**: 同步寫入失敗，留存錯誤代碼。
* **CANCELLED**: 草稿已被作廢，釋放暫時鎖定的庫存。

## 2. 資料結構定義 (JSON Schemas)

### TenantContext
租戶與公司上下文資訊。
```json
{
  "tenantId": "tenant-jy-001",
  "companyId": "comp-jingyang-taiwan",
  "timezone": "Asia/Taipei",
  "locale": "zh-TW"
}
```

### AllocationDraft
配貨草稿主表。
```json
{
  "draftId": "draft_abc123xyz789",
  "tenantContext": {
    "tenantId": "tenant-jy-001",
    "companyId": "comp-jingyang-taiwan"
  },
  "status": "ALLOCATION_REVIEW",
  "sourceSystem": "LINE_BOT_OCR",
  "sourceDraftId": "ocr_msg_99823",
  "idempotencyKey": "idem-key-8c6e2a9b3d7f1e5c0d8f",
  "items": [],
  "createdAt": "2026-07-24T11:00:00Z",
  "updatedAt": "2026-07-24T11:05:00Z",
  "salesOwner": "sales_owner_clerk01",
  "storeId": "store_9921",
  "storeName": "勁揚精選店"
}
```

### AllocationDraftItem
配貨草稿明細項目。
```json
{
  "itemId": "item_row_001",
  "productCode": "EQA-6522",
  "requestedQuantity": 10,
  "parsedConfidence": 0.95,
  "rawOcrText": "EQA-6522 * 10"
}
```

### InventorySnapshot
分配計算時的庫存快照。
```json
{
  "snapshotId": "snap_inv_20260724_1100",
  "productCode": "EQA-6522",
  "timestamp": "2026-07-24T11:00:00Z",
  "warehouses": [
    {
      "warehouseName": "林口倉",
      "batches": [
        {
          "batchNumber": "7J25",
          "availableQuantity": 15
        }
      ]
    },
    {
      "warehouseName": "忠義倉",
      "batches": [
        {
          "batchNumber": "7J25",
          "availableQuantity": 5
        }
      ]
    }
  ]
}
```

### AllocationSuggestion
配貨建議主結構。
```json
{
  "suggestionId": "sug_alloc_77812",
  "draftId": "draft_abc123xyz789",
  "suggestions": [],
  "warnings": [],
  "rationale": "優先選取單一倉庫林口倉之批號 7J25 足額分配 (10 PCS)。"
}
```

### AllocationSuggestionItem
配貨分配細項。
```json
{
  "productCode": "EQA-6522",
  "warehouseName": "林口倉",
  "batchNumber": "7J25",
  "allocatedQuantity": 10
}
```

### AllocationWarning
配貨警告說明。
```json
{
  "warningCode": "BATCH_MIXING_REQUIRED",
  "severity": "WARNING",
  "message": "林口倉批號 7J25 單一庫存不足，建議跨倉或混批分配。"
}
```

### SyncRequest
同步至業務管家保留表之請求。
```json
{
  "requestId": "sync_req_0029",
  "draftId": "draft_abc123xyz789",
  "idempotencyKey": "idem-key-8c6e2a9b3d7f1e5c0d8f",
  "reservationData": {
    "item": "EQA-6522 (7J25)",
    "quantity": 10,
    "storeId": "store_9921",
    "salesOwner": "sales_owner_clerk01",
    "note": "Via Allocation Assistant Draft: draft_abc123xyz789"
  }
}
```

### SyncResult
同步結果回應。
```json
{
  "success": true,
  "reservationId": "res_hold_5521",
  "syncedAt": "2026-07-24T11:06:12Z",
  "errorCode": ""
}
```

### AuditEvent
審計追蹤事件。
```json
{
  "eventId": "evt_aud_88192",
  "timestamp": "2026-07-24T11:06:13Z",
  "operator": "clerk01",
  "action": "CONFIRM_ALLOCATION",
  "draftId": "draft_abc123xyz789",
  "details": "User clerk01 approved allocation suggestion sug_alloc_77812."
}
```
