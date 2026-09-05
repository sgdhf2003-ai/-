# Stage 42-B: Firestore Native ACID Transaction Architecture Specification

## 1. 目標與範圍 (Goal & Scope)

### 1.1 背景與目標
本規格定義配貨助手 (Allocation Assistant) 導入 Firestore 原生 ACID 交易引擎之架構設計與合約規範，解決 Google Sheets 缺乏原生行級鎖、跨表跨庫原子交易 (Atomic Commit) 及悲觀鎖 (Pessimistic Locking) 之基礎限制。

### 1.2 職責分工與架構設計
- **`FirestoreReservationTransactionAdapter`**: 新設正式交易適配器，作為所有新發起配貨劃扣、庫存異動、銷扣流水及審計日誌的**唯一權威交易來源 (Single Source of Truth)**。
- **`ProductionSheetReservationAdapter`**: 保留並轉型為** Google Sheet 唯讀查詢與投影維護適配器 (Read-Only Query & Projection Maintenance Adapter)**。
- **單號與命名空間路由規則 (Namespace & Routing Rules)**:
  - **歷史／Google Sheet 單號**: 形如 `RES-YYYYMMDD-XXX` 或既有 Sheet 列號，路由至 `ProductionSheetReservationAdapter` 進行唯讀查詢。
  - **新 Firestore 交易單號**: 採用 `FS-RES-YYYYMMDD-XXXX` 命名空間前綴，路由至 `FirestoreReservationTransactionAdapter` 執行原子交易。
- **Google Sheet 分工邊界與 Projection 儲存**:
  - **一般流程唯讀 (Read-Only)**: 前端 UI 與一般應用流程讀取查詢，全數經由唯讀通道存取。
  - **受控 Projection Worker 單向寫入 (Controlled Projection Worker)**: 僅限 Firestore `runTransaction` 成功 Commit 後，由背景 Event Trigger (如 Cloud Firestore Trigger) 觸發受控 Worker 單向 Push 至 Google Sheet 投影。
  - **嚴禁應用層雙寫 (No Dual-Writing)**: 嚴禁於應用層或 API 端點同時對 Firestore 與 Google Sheet 發起雙向同步寫入。
  - **Google Sheet Schema 不變原則**: Google Sheet 既有表結構保持原樣，不新增欄位、不修改欄位語意（正式 Ledger 7 欄位維持 `["reservationNumber", "action", "item", "quantity", "remainingQuantity", "status", "updatedAt"]`）。

---

## 2. Firestore Collections 與 Schema 設計

### 2.1 日期字串與原生 Timestamp 欄位嚴格區分
- **業務日期字串欄位 (`ISO Date String`)**:
  - `holdDate`, `expiryDate`, `expectedDeliveryDate`: 統一採用 `YYYY-MM-DD` 格式之 ISO 日期字串 (例如 `2026-08-31`)，代表純粹商業業務日期。
- **系統執行時間欄位 (`Firestore Native Timestamp`)**:
  - `createdAt`, `updatedAt`, `timestamp`, `executedAt`: 內部統一採用 `FirebaseFirestore.Timestamp` (例如 `FieldValue.serverTimestamp()`)，記錄精確系統執行時間，避免時區與客戶端時鐘偏差；僅於對外 API / UI 輸出時轉為 ISO 8601 Timestamp 字串 (如 `2026-08-31T08:30:00.000Z`)。

### 2.2 `holds` Collection (配貨劃扣保留單)
- Document ID: `reservationNumber` (例如 `FS-RES-20260831-001`)
- 欄位定義：
  ```typescript
  interface HoldDocument {
    id: string;                      // 同 reservationNumber
    reservationNumber: string;       // 劃扣保留單號 (FS-RES-*)
    customerId: string;              // 店家/客戶 ID
    customerName: string;            // 店家/客戶名稱
    salesOwner: string;              // 業務負責人
    productCode: string;             // 品項代碼 (例如 STU-6101)
    quantity: number;                // 劃扣數量 (正整數)
    allocationType: string;          // 劃扣類型 (例如 已收訂 (劃扣))
    location: string;                // 倉庫地點
    holdDate: string;                // 劃扣日期 (ISO Date String: YYYY-MM-DD)
    expiryDate: string;              // 到期日期 (ISO Date String: YYYY-MM-DD)
    expectedDeliveryDate: string;   // 預計出貨日 (ISO Date String: YYYY-MM-DD)
    remarks: string;                 // 備註
    status: 'HOLD' | 'FULFILLED' | 'PARTIAL_FULFILLED' | 'CANCELLED'; // 劃扣狀態
    createdAt: FirebaseFirestore.Timestamp; // 建立時間 (原生 Timestamp)
    updatedAt: FirebaseFirestore.Timestamp; // 更新時間 (原生 Timestamp)
  }
  ```

### 2.3 `inventory` Collection (庫存主檔)
- Document ID: `productCode` (例如 `STU-6101`)
- 欄位定義與不變量約束 (Invariant Guarantee)：
  - **非負數約束**: `availableQuantity >= 0` 且 `reservedQuantity >= 0`
  - **劃扣保留上限約束**: `reservedQuantity >= releasedQuantity` (取消釋放時，已劃扣庫存必須大於或等於釋放數量)
  - **總量不變量**: `totalQuantity === availableQuantity + reservedQuantity`
  ```typescript
  interface InventoryDocument {
    id: string;                      // 同 productCode
    productCode: string;             // 品項代碼
    availableQuantity: number;       // 可分配庫存 (必須 >= 0)
    reservedQuantity: number;        // 已劃扣/保留庫存 (必須 >= 0 且 >= 釋放數量)
    totalQuantity: number;           // 總庫存 (availableQuantity + reservedQuantity)
    updatedAt: FirebaseFirestore.Timestamp; // 更新時間 (原生 Timestamp)
  }
  ```

### 2.4 `ledger` Collection (劃扣/出貨銷扣流水帳)
- Document ID: `LEDGER_${operationId}` (**決定性 Document ID，防止 Transaction 重試重複建立紀錄**)
- 數量正負號規則：
  - `CANCEL_RELEASE`: `quantity = +releasedQuantity` (正數，代表庫存解鎖並加回可分配池)，`remainingQuantity = 0` (劃扣單已完全取消釋放)。
  ```typescript
  interface LedgerDocument {
    id: string;                      // 決定性 ID: LEDGER_${operationId}
    reservationNumber: string;       // 劃扣保留單號
    action: 'CREATE_HOLD' | 'FULFILL' | 'CANCEL_RELEASE'; // 動作類型
    productCode: string;             // 品項代碼
    quantity: number;                // 異動數量 (CANCEL_RELEASE 時為 +releasedQuantity)
    remainingQuantity: number;       // 剩餘劃扣數量 (CANCEL_RELEASE 時為 0)
    status: string;                  // 劃扣/出貨狀態 (CANCELLED)
    timestamp: FirebaseFirestore.Timestamp; // 時間戳記 (原生 Timestamp)
    operationId: string;             // 交易操作 ID (冪等鍵)
  }
  ```

### 2.5 `auditLogs` Collection (系統審計日誌)
- Document ID: `AUDIT_${operationId}` (**決定性 Document ID，防止 Transaction 重試重複建立紀錄**)
- 欄位定義：
  ```typescript
  interface AuditLogDocument {
    id: string;                      // 決定性 ID: AUDIT_${operationId}
    eventType: string;               // 事件類型 (例如 CANCEL_RELEASE)
    reservationNumber: string;       // 劃扣保留單號
    operator: string;                // 操作者帳號/姓名
    operatorRole: string;            // 操作者角色 (admin / boss / assistant)
    operationId: string;             // 交易操作 ID (冪等鍵)
    timestamp: FirebaseFirestore.Timestamp; // 時間戳記 (原生 Timestamp)
  }
  ```

### 2.6 `operations` Collection (交易冪等與狀態追蹤)
- Document ID: `operationId` (例如 `OP-20260831-CANCEL-001`)
- 欄位定義：
  ```typescript
  interface OperationDocument {
    id: string;                      // 同 operationId
    action: string;                  // 交易動作 (例如 CANCEL_RELEASE)
    reservationNumber: string;       // 劃扣保留單號
    status: 'COMMITTED';             // 交易狀態 (僅在成功 Commit 時寫入)
    executedAt: FirebaseFirestore.Timestamp; // 執行時間 (原生 Timestamp)
    resultProof: {
      inventoryReleased: boolean;
      holdUpdated: boolean;
      auditLogged: boolean;
      atomic: boolean;
      readbackVerified: boolean;
      operationPersisted: boolean;
    };
  }
  ```

---

## 3. 取消釋放 (Cancel-Release) 先讀後寫 8 步驟原生 ACID 交易流程

Firestore 要求交易內**所有讀取與驗證必須完全先於所有寫入**。`FirestoreReservationTransactionAdapter.executeCancelReleaseTransaction` 必須遵循以下嚴格先讀後寫順序：

```text
================================================================================
【第一階段：所有 Reads 與驗證階段 (All Reads & Validations First)】
================================================================================
[Step 1: operationId 冪等讀取檢查]
   └─ const opRef = operationsRef.doc(operationId);
   └─ const opDoc = await transaction.get(opRef);
   └─ 若 opDoc.exists -> 拋出 DUPLICATE_OPERATION_BLOCKED 錯誤，交易立即 Abort (0 寫入)。

[Step 2: Hold 狀態讀取檢查]
   └─ const holdRef = holdsRef.doc(reservationNumber);
   └─ const holdDoc = await transaction.get(holdRef);
   └─ 若 !holdDoc.exists -> 拋出 HOLD_NOT_FOUND 錯誤，交易立即 Abort (0 寫入)。
   └─ 若 holdDoc.data().status === 'CANCELLED' -> 拋出 ALREADY_CANCELLED 錯誤，交易立即 Abort (0 寫入)。

[Step 3: Inventory 庫存讀取與雙向不變量驗證]
   └─ const invRef = inventoryRef.doc(productCode);
   └─ const invDoc = await transaction.get(invRef);
   └─ 若 !invDoc.exists -> 拋出 INVENTORY_NOT_FOUND 錯誤，交易立即 Abort (0 寫入)。
   └─ 劃扣庫存邊界檢查: 若 invDoc.data().reservedQuantity < releasedQuantity:
   └─    └─ 拋出 INSUFFICIENT_RESERVED_INVENTORY 錯誤，交易立即 Abort (0 寫入)。
   └─ 計算 newAvailable = invDoc.data().availableQuantity + releasedQuantity
   └─ 計算 newReserved = invDoc.data().reservedQuantity - releasedQuantity
   └─ 驗證不變量: 若 newAvailable < 0 或 newReserved < 0 -> 拋出 INVALID_INVENTORY_STATE 錯誤，交易立即 Abort (0 寫入)。

================================================================================
【第二階段：所有 Writes 提交階段 (All Writes Execution Next - 採用 Deterministic Doc IDs)】
================================================================================
[Step 4: Inventory 庫存更新]
   └─ transaction.update(invRef, { availableQuantity: newAvailable, reservedQuantity: newReserved, updatedAt: FieldValue.serverTimestamp() })

[Step 5: Hold 狀態更新為 CANCELLED]
   └─ transaction.update(holdRef, { status: 'CANCELLED', updatedAt: FieldValue.serverTimestamp() })

[Step 6: Ledger 寫入 (使用決定性 Doc ID: LEDGER_${operationId})]
   └─ const ledgerRef = ledgerCollection.doc(`LEDGER_${operationId}`);
   └─ transaction.set(ledgerRef, { reservationNumber, action: 'CANCEL_RELEASE', productCode, quantity: releasedQuantity, remainingQuantity: 0, status: 'CANCELLED', timestamp: FieldValue.serverTimestamp(), operationId })

[Step 7: Audit 寫入 (使用決定性 Doc ID: AUDIT_${operationId})]
   └─ const auditRef = auditCollection.doc(`AUDIT_${operationId}`);
   └─ transaction.set(auditRef, { eventType: 'CANCEL_RELEASE', reservationNumber, operator, operatorRole, operationId, timestamp: FieldValue.serverTimestamp() })

[Step 8: Operation 狀態持久化與 Transaction Commit]
   └─ transaction.set(opRef, { action: 'CANCEL_RELEASE', reservationNumber, status: 'COMMITTED', executedAt: FieldValue.serverTimestamp(), resultProof: { ... } })
   └─ runTransaction 原子提交所有寫入。任一讀寫衝突或例外，自動回滾 (0 異動)。
```

---

## 4. 失敗處理、`readbackVerified` 分層與 Ambiguous Outcome 對帳流程

### 4.1 `readbackVerified` 的明確兩階段分層架構
`readbackVerified` 證明標籤必須嚴格區分為「交易內驗證」與「Commit 後對帳」兩個獨立層次：

1. **Transaction 內驗證 (Transaction-Internal Snapshot Verification)**:
   - 於 `runTransaction` 區塊內部，`readbackVerified` 僅能驗證 **Transaction Snapshot 記憶體狀態與 Pre-Commit 斷言**（包含不變量檢查、正確的即將寫入值與歷史 Snapshot 比對）。
   - 在交易成功 Commit 瞬間，`readbackVerified: true` 作為不可變的結果證明之一寫入 `operations/{operationId}`。
2. **Commit 後對帳 (Post-Commit Independent Reconciliation)**:
   - Commit 成功後對資料庫進行的實際 Readback 讀回對帳，屬於**獨立的背景對帳 / Projection 檢查流程 (Reconciliation Process)**。
   - **禁令 (No Mutating Operations Proof)**: **嚴禁在 Commit 成功後重新回寫 `operations/{operationId}` 文件來修改或補上原子證明標籤**。`operations/{operationId}` 文件於交易提交時即已凍結不可變。

### 4.2 Fail-Closed 原則與 FAILED 狀態寫入限制
- 8 步驟中任一步驟發生錯誤、資料不一致或讀取失敗，交易必須**整體 Abort (0 異動)**。
- **`status: 'FAILED'` 寫入限制**: 交易失敗時，**不可在同一個已 Abort 的 Transaction 內部寫入 `operations` 或 `auditLogs`**，因為 Transaction Abort 會丟棄該交易內的所有寫入。失敗記錄與例外診斷必須由**外部 Try-Catch / 伺服端 Logging / 監控服務**於交易區塊外單獨處理紀錄。
- 若 Firestore 未傳回完整 6 標籤 Proof (`inventoryReleased`, `holdUpdated`, `auditLogged`, `atomic`, `readbackVerified`, `operationPersisted`)，適配器必須傳回 `CANCEL_TRANSACTION_INCOMPLETE`，且**嚴禁傳回 `releasedQuantity`**。

### 4.3 Ambiguous Outcome (交易成功但 HTTP Timeout) 處理流程
當 Firestore `runTransaction` 於伺服端成功提交 Commit，但 HTTP 傳輸回應在返回 Client 途中因網路逾時中斷時，Client 處於「交易結果不明 (Ambiguous Outcome)」狀態：

```text
[Client 發生 Response Timeout / Network Error]
   │
   ▼
[發起 operationId Readback 查詢: findOperationId(operationId)]
   │
   ├─► 若 operations 文件 (`operationId`) 存在且 status === 'COMMITTED':
   │      └─ 以 operations/{operationId} 文件作為唯一結果確認來源 (Single Source of Truth)。
   │      └─ 讀取該 operationId 持久化之 resultProof 與 異動結果。
   │      └─ 回傳 ok: true, releasedQuantity, updatedHold (視為成功完成，無需重複寫入)。
   │
   └─► 若 operations 文件不存在:
          └─ 判定該交易先前未在伺服端 Commit。
          └─ 允許使用原 operationId 安全發起重試。
```

---

## 5. Security Rules 與伺服端權限矩陣依據

### 5.1 對齊 `Code.gs` / `AllocationEndpointDispatcher.js` 實際程式碼證據
權限控制完全以 `google-apps-script/Code.gs`、`allocation-assistant/dispatchers/allocation-endpoint-dispatcher.js` 與 `tests/simulations/security-permission-closure.sim.js` 之實際程式碼邏輯與測試證據為準：

| 操作動作 / 函式名稱 | `admin` | `boss` | `assistant` | `sales` | `retail` | 程式碼與測試實質依據 |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `upsertHoldAction` | ✅ | ✅ | ✅ | ✅ | ✅ | `AllocationEndpointDispatcher.js` L80-L100; `security-permission-closure.sim.js` Test 1 PASS |
| `fulfillHoldAction` | ✅ | ✅ | ✅ | ❌ (拒絕) | ❌ (拒絕) | `AllocationEndpointDispatcher.js` L150-L170; `security-permission-closure.sim.js` Test 2 PASS |
| `cancelReleaseHoldAction` | ✅ | ✅ | ✅ | ❌ (拒絕) | ❌ (拒絕) | `AllocationEndpointDispatcher.js` L210-L240; `security-permission-closure.sim.js` Test 3 PASS |
| `specialChannelHold` | ✅ | ✅ | 【待驗證】 | ❌ (拒絕) | ❌ (拒絕) | 未經明確驗證之端點統一標示為【待驗證 (To Be Verified)】，採 Fail-Closed 預設拒絕 |

- **放寬限制原則**: **嚴禁自行推測或放寬 `sales` 或 `retail` 權限**。
- `sales` 與 `retail` 角色嘗試發起 `cancelReleaseHoldAction` 時，後端 API 必須於交易開始前 Fail-Closed 退回 HTTP 403 / `PERMISSION_DENIED`，**零寫入且不執行交易**。

### 5.2 收緊 Firestore Security Rules (禁止前端直讀直寫)
核心交易集合**禁止前端 Client 直接讀取或寫入**，完全防禦繞過後端的私自讀寫：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 封鎖所有前端 SDK 直讀與直寫權限；僅能透過 Server Admin SDK / 後端代理存取
    match /holds/{document=**} { allow read, write: if false; }
    match /inventory/{document=**} { allow read, write: if false; }
    match /ledger/{document=**} { allow read, write: if false; }
    match /auditLogs/{document=**} { allow read, write: if false; }
    match /operations/{document=**} { allow read, write: if false; }
  }
}
```

---

## 6. Adapter 介面規範

### 6.1 `FirestoreReservationTransactionAdapter` 介面
`FirestoreReservationTransactionAdapter` 必須實現 `executeCancelReleaseTransaction(params)` 方法：

```typescript
interface CancelReleaseParams {
  reservationNumber: string;
  existingHold: HoldRecord;
  releasedQuantity: number;
  operator: string;
  operatorRole: string;
  operationId: string;
}

interface TransactionResultProof {
  ok: boolean;
  errorCode?: string;
  message?: string;
  inventoryReleased?: boolean;
  holdUpdated?: boolean;
  auditLogged?: boolean;
  atomic?: boolean;
  readbackVerified?: boolean;
  operationPersisted?: boolean;
  releasedQuantity?: number;
  updatedHold?: HoldRecord;
}
```

---

## 7. Google Sheet 角色與受控單向投影

### 7.1 分工與受控 Worker 單向寫入
- **一般流程唯讀 (Read-Only)**: `ProductionSheetReservationAdapter` 僅讀取 Sheet 提供歷史對帳與查詢。
- **受控 Projection Worker**: 僅由獨立之背景 Worker (受控 Projection Worker) 於 Firestore 交易 Commit 成功後，訂閱 Firestore 變更事件單向寫入 Sheet 投影。
- **Google Sheet Schema 不變原則**: 現有 Google Sheet `LEDGER_HEADERS` 欄位維持 `["reservationNumber", "action", "item", "quantity", "remainingQuantity", "status", "updatedAt"]`，**不得修改 `updatedAt` 語意或強行塞入 `operationId`**。
- **Projection 冪等儲存區**: 投影冪等標記 `PROJECTION_${operationId}` 暫定寫入獨立的 `ProjectionState` 對帳頁簽。建立 `ProjectionState` 或任何 Sheet 欄位異動**全數列為未來另行審批事項**。在未獲審批前，Worker 嚴禁竄改現有 Sheet 結構。
- **同步失敗隔離**: 投影寫入失敗僅紀錄死信佇列 (DLQ)，**不得影響、回滾或修飾已成功提交之 Firestore 交易**。
- **嚴禁應用層雙寫**: 應用層與 API 端點嚴禁同時對 Firestore 與 Google Sheet 發起同步雙向寫入。

---

## 8. 測試策略 (Testing Strategy)

必須建置基於 **Firebase Emulator Suite** 的整合測試環境：

1. **成功交易測試**: 驗證先讀後寫 8 步驟原子提交，5 個 Collection 均使用決定性 Doc ID 生成文件，且 `availableQuantity >= 0` 與 `reservedQuantity >= releasedQuantity` 不變量成立。
2. **重複 `operationId` 測試**: 驗證第二次傳入相同 `operationId` 回傳 `DUPLICATE_OPERATION_BLOCKED`，庫存未二次增加。
3. **Step 1-3 讀取驗證失敗模擬**: 於讀取階段拋出 Exception，驗證交易立即 Abort 且未觸發任何寫入。
4. **權限拒絕測試**: 模擬 `sales` 或 `retail` 角色發起取消釋放，後端於交易前攔截回傳 403 / `PERMISSION_DENIED`。
5. **Ambiguous Outcome Readback 測試**: 模擬 Timeout 後發起 `findOperationId` 對帳查詢，確認回傳已持久化之 Proof。
6. **零正式副作用**: 測試全數於 本機 Emulator 執行，不得產生正式雲端資源或 Google Sheet 變更。

---

## 9. 明確限制與階段邊界 (Explicit Boundaries & Limits)

> [!CAUTION]
> 1. 本檔案僅為 Stage 42-B 架構規格書，**目前尚未建立正式 Firestore Client 程式碼與 `FirestoreReservationTransactionAdapter`**。
> 2. **目前尚未建立 GCP / Firebase 專案與 Firestore 雲端資源**。
> 3. **目前尚未完成與配貨助手 Production Wiring 之實體連接**。
> 4. 現有 `ProductionSheetReservationAdapter` **僅作為 Google Sheet 查詢與投影維護用途**。在正式 Firestore Client 未完全實作、配置並通過評測前，當缺少 `hasNativeAcidTransaction === true` 或 `hasNativeTransactionAbortGuarantee === true` 時，現有適配器**必須維持 Fail-Closed 狀態**（交易前即零寫入退回 `PRODUCTION_TRANSACTION_CAPABILITY_MISSING`）。
