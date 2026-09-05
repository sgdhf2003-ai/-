# Stage 42-C: Firestore Native Transaction Implementation Plan

## 1. 目標與概述 (Goal & Overview)

本實作計畫依據 `docs/stages/stage-42-b-firestore-transaction-architecture-spec.md` 架構規格書制定，詳細規範未來劃扣助手導入 `FirestoreReservationTransactionAdapter` 之開發階段分工、依賴注入機制、先讀後寫交易順序、冪等性防護、投影隔離及 Firebase Emulator Suite 測試涵蓋範圍。

> [!CAUTION]
> 本文件僅為開發實作計畫，**不包含任何正式程式碼修改、不建立 Firebase/GCP 資源、不操作 Google Sheet/LINE API、不部署、亦不進行 Git Commit/Push**。

---

## 2. 實作分層架構 (Implementation Architecture Layering)

`FirestoreReservationTransactionAdapter` 採用四層解耦架構：

```text
+-----------------------------------------------------------------------+
| 1. Client Injection & Capability Probe (受信任 Factory 注入與介面檢測)     |
|    - 由受信任 Server Factory 注入經驗證之 Client 實體                   |
|    - 檢查 runTransaction、hasNativeTransactionAbortGuarantee 介面合約 |
|    - 嚴禁把外部傳入之布林屬性直接視為安全憑證                          |
+-----------------------------------------------------------------------+
                                   │
                                   ▼
+-----------------------------------------------------------------------+
| 2. Validation & Auth Verification Layer (參數驗證與權限控制層)           |
|    - 驗證 operationId, reservationNumber, releasedQuantity              |
|    - 對齊 Code.gs 檢查 operatorRole (僅允許 admin, boss, assistant)    |
+-----------------------------------------------------------------------+
                                   │
                                   ▼
+-----------------------------------------------------------------------+
| 3. Atomic Transaction Core (先讀後寫 8 步驟原生 ACID 原子交易核心)         |
|    - 第一階段：Reads Phase (operations, holds, inventory 讀取與斷言)    |
|    - 第二階段：Writes Phase (inventory, holds, ledger, audit, operations)|
+-----------------------------------------------------------------------+
                                   │
                                   ▼
+-----------------------------------------------------------------------+
| 4. Response & Proof Formatter (證明格式化與對帳回應層)                  |
|    - 格式化 6 標籤 Proof (inventoryReleased, holdUpdated, auditLogged...) |
+-----------------------------------------------------------------------+
```

---

## 3. Firestore Admin SDK 與 Trusted Server Factory 注入方式

### 3.1 受信任 Factory 注入與明確介面檢測 (Capability Interface Check)
適配器不採用 `options.hasNativeTransactionAbortGuarantee` 等由外部呼叫端任意傳入之布林值作為安全證明，而是由後端**受信任的 Server Factory (`ServerFirestoreClientFactory`)** 於伺服端安全執行環境創建並注入 Client 實體。適配器僅對明確介面合約進行能力檢測：

```typescript
// 概念介面規範 (未包含於本輪修改)
class FirestoreReservationTransactionAdapter {
  constructor(options: {
    firestoreDb: any;
    configProvider?: ConfigProvider;
  }) {
    this.db = options.firestoreDb;
    this.configProvider = options.configProvider;

    // 由受信任之 Server Factory 確保 Client 安全信任邊界 (isTrustedServerBackend)
    const isRunTxFunction = Boolean(this.db && typeof this.db.runTransaction === 'function');
    const hasAbortGuarantee = Boolean(this.db && this.db.hasNativeTransactionAbortGuarantee === true);
    const isTrustedBackend = Boolean(this.db && this.db.isTrustedServerBackend === true);

    this.hasNativeAcidTransaction = isRunTxFunction && hasAbortGuarantee && isTrustedBackend;
    this.hasNativeTransactionAbortGuarantee = hasAbortGuarantee && isTrustedBackend;
  }

  // 若能力檢測未通過，executeCancelReleaseTransaction 於交易前 Fail-Closed 退回：
  // { ok: false, errorCode: "PRODUCTION_TRANSACTION_CAPABILITY_MISSING" }
}
```

### 3.2 伺服端運行環境
- 適配器僅於 Server-side 環境（Node.js API Endpoint / Serverless Cloud Functions）運行。
- 由 `ServerFirestoreClientFactory` 透過 `firebase-admin/firestore` 注入 Admin SDK 實體，標註 `isTrustedServerBackend = true` 信任邊界。

---

## 4. Collections 讀寫順序與 Deterministic Document IDs

交易必須嚴格分為 **All Reads First** 與 **All Writes Next** 兩個階段：

### 4.1 第一階段：All Reads & Validations (Reads Phase)
1. **`operations/{operationId}`**: `await transaction.get(opRef)`
   - 若 `exists` -> 拋出 `DUPLICATE_OPERATION_BLOCKED`，交易 Abort。
2. **`holds/{reservationNumber}`**: `await transaction.get(holdRef)`
   - 若 `!exists` -> 拋出 `HOLD_NOT_FOUND`，交易 Abort。
   - 若 `status === 'CANCELLED'` -> 拋出 `ALREADY_CANCELLED`，交易 Abort。
3. **`inventory/{productCode}`**: `await transaction.get(invRef)`
   - 若 `!exists` -> 拋出 `INVENTORY_NOT_FOUND`，交易 Abort。
   - 劃扣庫存上限斷言：若 `reservedQuantity < releasedQuantity` -> 拋出 `INSUFFICIENT_RESERVED_INVENTORY`，交易 Abort。
   - 計算 `newAvailable = availableQuantity + releasedQuantity`，`newReserved = reservedQuantity - releasedQuantity`。
   - 非負數斷言：若 `newAvailable < 0` 或 `newReserved < 0` -> 拋出 `INVALID_INVENTORY_STATE`，交易 Abort。

### 4.2 第二階段：All Writes Execution (Writes Phase with Deterministic Doc IDs)
4. **`inventory/{productCode}`**: `transaction.update(invRef, { availableQuantity: newAvailable, reservedQuantity: newReserved, updatedAt: FieldValue.serverTimestamp() })`
5. **`holds/{reservationNumber}`**: `transaction.update(holdRef, { status: 'CANCELLED', updatedAt: FieldValue.serverTimestamp() })`
6. **`ledger/LEDGER_${operationId}`**: `transaction.set(ledgerRef, { reservationNumber, action: 'CANCEL_RELEASE', productCode, quantity: +releasedQuantity, remainingQuantity: 0, status: 'CANCELLED', timestamp: FieldValue.serverTimestamp(), operationId })`
7. **`auditLogs/AUDIT_${operationId}`**: `transaction.set(auditRef, { eventType: 'CANCEL_RELEASE', reservationNumber, operator, operatorRole, operationId, timestamp: FieldValue.serverTimestamp() })`
8. **`operations/{operationId}`**: `transaction.set(opRef, { action: 'CANCEL_RELEASE', reservationNumber, status: 'COMMITTED', executedAt: FieldValue.serverTimestamp(), resultProof: { ... } })`

---

## 5. Abort, Retry, Timeout 與 Ambiguous Outcome 處理機制

### 5.1 Abort 處理
- 交易內任一 Step 拋出 Exception 時，`runTransaction` 自動回滾，所有文件維持 0 異動。
- **不可在交易內寫入 `status: 'FAILED'`**，例外日誌由外部 Try-Catch 傳送至監控 Log。

### 5.2 Deterministic Doc IDs 防禦 SDK 內部 Retry
- 交易寫入採用 `LEDGER_${operationId}` 與 `AUDIT_${operationId}` 決定性 ID，即使 Firestore SDK 因網路延遲於內部重試 `runTransaction`，亦不會產生重複流向或重複審計紀錄。

### 5.3 `readbackVerified` 分層與不可變證明規範
- **Transaction 內**: 僅驗證 Snapshot 記憶體狀態與 Pre-Commit 斷言。
- **Commit 後**: 讀回對帳屬於獨立背景 reconciliation 流程。
- **禁令**: **嚴禁在 Commit 成功後重新回寫 `operations/{operationId}` 來補修改證明標籤**。

### 5.4 Ambiguous Outcome 與 Readback 對帳
- 當發起端遇到 HTTP Timeout 時，發起 `findOperationId(operationId)` 查詢 `operations/{operationId}`：
  - 若已存在且 `status === 'COMMITTED'` -> 讀取持久化之 `resultProof` 回傳成功。
  - 若不存在 -> 安全重新發起重試。

---

## 6. Controlled Projection Worker 與 Projection Idempotency Schema

```text
[Firestore Native ACID Transaction]
   │ (runTransaction Commit 成功)
   ▼
[Cloud Firestore Event Trigger]
   │ (非同步 Pub/Sub 攜帶 Worker 身份憑證)
   ▼
[Controlled Projection Worker]
   │ (Worker 身份驗證 + Projection State 冪等對帳)
   ▼
[Google Sheet (獨立 ProjectionState 對帳頁簽 - 待審批事項)]
```

### 6.1 Projection Idempotency Schema (投影冪等對帳與 Sheet 邊界)
1. **Google Sheet 既有表結構不變原則**:
   - 正式 ProductionSheetReservationAdapter 的 `LEDGER_HEADERS` 欄位維持 `["reservationNumber", "action", "item", "quantity", "remainingQuantity", "status", "updatedAt"]`。
   - **嚴禁改寫 `updatedAt` 語意**，亦嚴禁強行將 `operationId` 塞入現有 Sheet 不存在的欄位。
2. **獨立 `ProjectionState` 儲存區與未來審批事項**:
   - 投影冪等對帳標記 `PROJECTION_${operationId}` 暫定寫入獨立的 `ProjectionState` 對帳頁簽 (`[projectionKey, operationId, reservationNumber, projectedAt, status]`)。
   - 建立 `ProjectionState` 頁簽或任何 Google Sheet 表結構變更，**全數列為未來另行審批事項**。
   - 在 Migration 未獲 Owner 明確審批前，Worker 嚴禁竄改現有 Sheet 結構或將 `operationId` 寫入不存在之欄位。

### 6.2 受控 Worker 安全機制
1. **Worker 身份驗證 (Worker Authentication)**: 僅允許攜帶專屬 IAM Service Account / 內部金鑰驗證之受控後端 Worker 執行 Google Sheet 投影寫入。
2. **重試與死信佇列 (DLQ)**: 投影失敗寫入 DLQ 重試，**嚴禁影響或回滾已提交之 Firestore 交易**。
3. **前端直呼禁止 (No Direct Call)**: 一般 API 端點與前端 UI 嚴禁直接呼叫 Sheet 投影寫入介面。

---

## 7. 單號與命名空間路由策略 (Namespace Routing)

- **`FS-RES-YYYYMMDD-XXXX`**: Firestore 原生劃扣單號，路由至 `FirestoreReservationTransactionAdapter` 執行 ACID 交易。
- **`RES-YYYYMMDD-XXX` / 既有 Sheet 列號**: 歷史單號，路由至 `ProductionSheetReservationAdapter` 進行唯讀查詢。

---

## 8. Security Rules 與後端權限矩陣對齊

### 8.1 Firestore Security Rules (全封鎖直讀直寫)
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```

### 8.2 後端角色權限邊界
- `admin`, `boss`, `assistant`: 允許執行 `cancelReleaseHoldAction`。
- `sales`, `retail`: 嚴格禁止執行 `cancelReleaseHoldAction` (回傳 HTTP 403 / `PERMISSION_DENIED`)。

---

## 9. Firebase Emulator 測試範圍規劃

未來單元與整合測試將於 **Firebase Emulator Suite** 環境進行，涵蓋以下 8 大測試案例：

1. **成功交易測試**: 驗證先讀後寫 8 步驟原子提交，5 個 Collection 均使用決定性 Doc ID 生成文件，庫存 +releasedQuantity 且不變量成立。
2. **Step 1-3 讀取驗證失敗模擬**: 於 Reads 階段拋出 Exception，驗證交易立即 Abort，Writes 階段完全未觸發。
3. **Firestore SDK Transaction Retry 測試**: 模擬併發衝突觸發 Retry，驗證決定性 Doc ID 防止重複 Ledger/Audit 文件生成。
4. **重複 `operationId` 攔截測試**: 驗證傳入已存在之 `operationId` 回傳 `DUPLICATE_OPERATION_BLOCKED`，0 異動。
5. **Timeout Readback 對帳測試**: 模擬 Timeout 後發起 `findOperationId` 對帳查詢，確認傳回已持久化之 Proof。
6. **庫存不變量違規測試**: 模擬 `reservedQuantity < releasedQuantity`，驗證回傳 `INSUFFICIENT_RESERVED_INVENTORY` 且 0 異動。
7. **權限拒絕測試**: 模擬 `sales` 或 `retail` 角色發起取消釋放，後端於交易前攔截回傳 403 / `PERMISSION_DENIED`。
8. **Projection Failure 隔離與 Worker 安全測試**: 模擬 Sheet 投影失敗與未授權 Worker 存取，驗證 Firestore 交易結果維持 `COMMITTED`，且非法 Worker 存取被拒絕。

---

## 10. 明確限制與階段邊界 (Explicit Boundaries & Limits)

> [!IMPORTANT]
> **本開發計畫執行前之嚴格邊界與禁止事項**：
> 1. **不修改任何正式程式碼** (`allocation-assistant/`, `google-apps-script/` 等)。
> 2. **不建立任何 GCP / Firebase 雲端專案與資源**。
> 3. **不寫入或操作正式 Google Sheets**。
> 4. **不呼叫 LINE API**。
> 5. **不部署** (`clasp push`, `deploy.py` 等)。
> 6. **不進行 Git Commit 或 Push**。
