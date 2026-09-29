# Stage 42-G3 Projection Worker State Machine & Sheets Client Implementation Plan

> For agentic workers:
> REQUIRED SUB-SKILL: use executing-plans or an equivalent task-by-task execution workflow. Do not implement tasks in parallel when they modify shared event schemas or Firestore state contracts.

Goal:
實作 Projection Worker 核心狀態機，包含 180 秒分散式租約認領、初次認領時建立 Erratum 1 `projectionSnapshot`、呼叫 Sheets API 前強制 Firestore 權威租約重新校驗、Fake Google Sheets 12 欄物理結構 Search-and-Append，以及明確之錯誤分類處置。

Architecture:
依據 Stage 42-F 第 8 章、第 9 章與第 14 章，以及 Erratum 1 規範：
1. Worker 接收 CloudEvent 解包後，在 Firestore 交易中認領 `projectionOperations/{operationId}`。若為首次建立，原子初始化並儲存由 Application Envelope 產生之 `projectionSnapshot`；重發時嚴禁覆蓋快照。
2. 租約到期時間為 `Firestore Timestamp`（`NOW + 180s`）。若狀態為 `PROCESSING` 且租約有效，重複訊息固定回傳 ACK 且執行 0 次 Sheet 寫入。
3. 呼叫 Google Sheets API 前，強制執行 authoritative read 比對四項條件（`status`, `leaseOwner`, `claimVersion`, `leaseExpiresAt > clock.nowTimestamp()`）。
4. 試算表寫入嚴格檢驗 `quantity` 之大於 0 有限正整數性，完成後狀態更新為 `SUCCEEDED`，並設定 `projectionSnapshotExpiresAt = completedAt + 90 天`。

Tech Stack:
- 執行環境：Node.js 20+ (CommonJS)
- 模擬器與資料庫：Firestore Emulator (`127.0.0.1:8080`), `firebase-admin ^14.3.0`
- 時間抽象：`Clock` 介面（測試注入 `createFakeClock()`）
- 試算表介面：`FakeGoogleSheetsClientAdapter` (記憶體表格，0 真實 Sheet 寫入)
- 測試套件：Node.js 原生 `assert` 輕量化模擬測試

Spec:
docs/stages/stage-42-f-formal-projection-worker-architecture-spec.md (含 Erratum 1)

Global Constraints:
1. 嚴格禁止向真實 Google Sheet 進行網路呼叫，所有測試均使用 `FakeGoogleSheetsClientAdapter`。
2. 試算表欄位結構固定為 12 欄物理結構（A: projection_key, B: operation_id, ..., L: payload_hash），工作表名稱統一為 `PROJECTION_LOG`。
3. 數值欄位 `quantity` 必須嚴格驗證 `Number.isFinite(quantity) && Number.isInteger(quantity) && quantity > 0`，`quantity <= 0` 時必須 Fail-Closed。
4. 呼叫 Sheet 前之權威租約檢查必須使用 `Clock` 介面產生的 Firestore Timestamp 進行比較，嚴格禁止依賴本機 process-local `new Date()`。
5. 不可重試錯誤（格式錯誤、雜湊衝突）一律更新為 `MANUAL_REVIEW_REQUIRED` 並回傳固定 ACK（HTTP 200）。

Review Focus:
1. TC-03：有效租約內的重複 delivery 是否確實回傳固定 ACK 且 0 次 Sheet 寫入。
2. TC-04：在呼叫 Google Sheets API 前，若租約已被其他 Worker 接手或過期，是否安全 Fail-Closed 並產生 0 次 Sheet 寫入。
3. TC-05 / TC-06：過期租約接手是否正確遞增 `claimVersion`，過期 Worker 送出之結案更新是否被拒絕。
4. Erratum 1：初次認領時是否正確建立 `projectionSnapshot`，重複 delivery 時是否維持唯讀不覆蓋。
5. 模組是否 export 包含 TC-03, TC-04, TC-05, TC-06, TC-08, TC-09, TC-18 之真實 Test Registry。

---

## Tasks

### Task 1: Projection Operations State Claim, Snapshot Storage & Fencing Protocol (TC-03, TC-05)
- **Create / Modify / Test 路徑**:
  - Create: `allocation-assistant/services/projection-worker-service.js`
  - Create: `tests/simulations/stage-42-g3-projection-worker.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `package.json`: 註冊 `simulate:stage-42-g3-projection-worker` 測試腳本。
- **Consumes / Produces 介面**:
  - Consumes: Firestore Client, 解包後之 Application Envelope, Worker 實例識別碼, `Clock`。
  - Produces: 認領狀態物件（`status`, `claimVersion`, `action: 'PROCEED' | 'SKIP_ACK' | 'CONFLICT'`）。
- **精確函式名稱**:
  - `claimProjectionOperation(db: object, envelope: object, workerInstanceId: string, clock: object): Promise<object>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-03, TC-05 與 Snapshot Fail-Closed 校驗)**
    撰寫測試：
    1. 初次認領建立 `status = 'PROCESSING'`、`claimVersion = 1`，並建立 Erratum 1 `projectionSnapshot`。
    2. 有效租約重複抵達（TC-03）：回傳 `action = 'SKIP_ACK'`，產生 0 次寫入。
    3. 租約過期接手（TC-05）：使用 `fakeClock.advanceMillis(181000)`，新 Worker 接手認領成功且 `claimVersion` 遞增為 2，既有 `projectionSnapshot` 不被覆蓋。
    4. Snapshot Fail-Closed 防護驗證：
       - 驗證解構無未宣告變數（無 ReferenceError）。
       - 驗證 fallback schema（帶有 `customerCode`、`items[0].sku`、`payload.reservationNumber` 等非規範欄位）被 Fail-Closed 拒絕。
       - 驗證非法 quantity（字串 `"10"`、小數 `10.5`、`NaN`、負數 `-1`、`0`）被拒絕為 `INVALID_QUANTITY`。
       - 驗證合法 operationId 但 Snapshot 欄位不合法時：寫入最小化 `MANUAL_REVIEW_REQUIRED` 紀錄，保存 sanitized `errorCode`，`projectionSnapshot` 為 `null`（不建立虛構快照），0 Sheet 寫入。
       - 驗證缺失 operationId 時：標記為 malformed event，0 Firestore 文件寫入，0 Sheet 寫入。
    5. 重複訊息與既有紀錄防破壞驗證：
       - 驗證畸形 duplicate 事件（如缺失 payloadHash、非 64 碼字串）抵達時，不得將既有 `SUCCEEDED` 或 `PROCESSING` 改為 `MANUAL_REVIEW_REQUIRED`，回傳 `REJECT_INVALID_DUPLICATE`。
       - 驗證畸形 duplicate 事件抵達時，不得清空或覆蓋既有 `projectionSnapshot`。
       - 驗證僅當 incoming payloadHash 為合法 64 碼 SHA-256 但內容與既有 hash 不同時，才正確轉為 `MANUAL_REVIEW_REQUIRED`（且不覆蓋既有快照）。
       - 驗證 rejectedDuplicateCount 缺失時初始化為 1，既有值為負數或損毀時 Fail-Closed 拒絕，禁止直接使用 (value || 0) + 1 掩蓋錯誤。
       - 驗證 `quantity === 0` 必須 Fail-Closed 判定為 `INVALID_QUANTITY`。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行 `node tests/simulations/stage-42-g3-projection-worker.sim.js`，預期因找不到 `claimProjectionOperation` 或 `validateAndExtractProjectionSnapshot` 失敗。
  - [ ] **Step 3: 寫入最小實作**
    在 `allocation-assistant/services/projection-worker-service.js` 中實作交易認領狀態機與 Snapshot 初始化。
  - [ ] **Step 4: 執行並確認 TC-03, TC-05 與 Fail-Closed 測試通過**
    確認 TC-03、TC-05 與全部 Fail-Closed 校驗案例通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g3-projection-worker`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement worker claim lease, snapshot storage and fencing (TC-03, TC-05)`

- **最小實作程式碼範例**:
```javascript
const ALLOWED_EVENT_TYPES = Object.freeze([
  "HOLD_CREATED",
  "HOLD_FULFILLED",
  "HOLD_CANCELLED",
  "HOLD_RECONCILED"
]);

function validateAndExtractProjectionSnapshot(envelope) {
  if (!envelope || typeof envelope !== "object") {
    return { valid: false, errorCode: "MALFORMED_ENVELOPE" };
  }
  const {
    operationId,
    eventId,
    reservationNumber,
    eventType,
    occurredAt,
    payloadHash,
    payload,
    operator
  } = envelope;

  if (typeof operationId !== "string" || operationId.trim() === "") {
    return { valid: false, isMalformedOperationId: true, errorCode: "INVALID_OPERATION_ID" };
  }
  if (typeof eventId !== "string" || eventId.trim() === "") {
    return { valid: false, errorCode: "INVALID_EVENT_ID" };
  }
  if (typeof reservationNumber !== "string" || reservationNumber.trim() === "") {
    return { valid: false, errorCode: "INVALID_RESERVATION_NUMBER" };
  }
  if (typeof eventType !== "string" || !ALLOWED_EVENT_TYPES.includes(eventType.trim())) {
    return { valid: false, errorCode: "INVALID_EVENT_TYPE" };
  }
  if (typeof occurredAt !== "string" || occurredAt.trim() === "") {
    return { valid: false, errorCode: "INVALID_OCCURRED_AT" };
  }
  if (typeof payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(payloadHash)) {
    return { valid: false, errorCode: "INVALID_PAYLOAD_HASH" };
  }
  const pseudonymousActorId = operator && operator.pseudonymousActorId;
  if (typeof pseudonymousActorId !== "string" || pseudonymousActorId.trim() === "") {
    return { valid: false, errorCode: "INVALID_OPERATOR_ACTOR_ID" };
  }

  // Payload 驗證：唯一 canonical schema { storeId, productCode, quantity }，嚴禁多路 fallback
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, errorCode: "INVALID_PAYLOAD_SCHEMA" };
  }
  const { storeId, productCode, quantity } = payload;
  if (typeof storeId !== "string" || storeId.trim() === "") {
    return { valid: false, errorCode: "INVALID_STORE_ID" };
  }
  if (typeof productCode !== "string" || productCode.trim() === "") {
    return { valid: false, errorCode: "INVALID_PRODUCT_CODE" };
  }
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    return { valid: false, errorCode: "INVALID_QUANTITY" };
  }

  return {
    valid: true,
    snapshot: {
      reservationNumber: reservationNumber.trim(),
      eventType: eventType.trim(),
      storeId: storeId.trim(),
      productCode: productCode.trim(),
      quantity,
      pseudonymousActorId: pseudonymousActorId.trim(),
      occurredAt,
      payloadHash
    }
  };
}

async function claimProjectionOperation(db, envelope, workerInstanceId, clock) {
  // Snapshot 驗證必須在 Firestore 寫入前完成
  const validation = validateAndExtractProjectionSnapshot(envelope);

  // D. 若 operationId 本身缺失或無效：無法建立 Firestore 文件，直接回傳固定 ACK 並終止，0 寫入
  if (!validation.valid && validation.isMalformedOperationId) {
    return { action: "REJECT_MALFORMED", errorCode: validation.errorCode, shouldWriteDoc: false };
  }

  const operationId = envelope.operationId.trim();
  const docRef = db.collection("projectionOperations").doc(operationId);
  const admin = require("firebase-admin");

  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    const nowTs = clock.nowTimestamp();
    const nowMillis = nowTs.toMillis();
    const leaseDurationMs = 180 * 1000;
    const newExpiresTs = admin.firestore.Timestamp.fromMillis(nowMillis + leaseDurationMs);

    // 若文件不存在
    if (!doc.exists) {
      // A. operationId 合法、文件不存在、Snapshot 不合法：可建立最小 MANUAL_REVIEW_REQUIRED 紀錄，projectionSnapshot=null，0 Sheet 寫入
      if (!validation.valid) {
        transaction.set(docRef, {
          operationId,
          eventId: envelope.eventId || null,
          projectionKey: `PROJECTION_${operationId}`,
          status: "MANUAL_REVIEW_REQUIRED",
          claimVersion: 1,
          leaseOwner: null,
          leaseExpiresAt: null,
          payloadHash: envelope.payloadHash || null,
          attemptCount: 1,
          firstAttemptAt: nowTs,
          lastAttemptAt: nowTs,
          completedAt: null,
          projectionSnapshot: null, // 絕不建立虛構快照
          projectionSnapshotExpiresAt: null,
          lastErrorCode: validation.errorCode
        });
        return { action: "CONFLICT", errorCode: validation.errorCode };
      }

      // 初次建立且 Snapshot 合法：初始化 PROCESSING 與 projectionSnapshot
      const { snapshot: projectionSnapshot } = validation;
      const { payloadHash, eventId } = envelope;
      const newRecord = {
        operationId,
        eventId,
        projectionKey: `PROJECTION_${operationId}`,
        status: "PROCESSING",
        claimVersion: 1,
        leaseOwner: workerInstanceId,
        leaseExpiresAt: newExpiresTs,
        payloadHash,
        attemptCount: 1,
        firstAttemptAt: nowTs,
        lastAttemptAt: nowTs,
        completedAt: null,
        projectionSnapshot,
        projectionSnapshotExpiresAt: null
      };

      transaction.set(docRef, newRecord);
      return { action: "PROCEED", claimVersion: 1, record: newRecord };
    }

    // 既有文件存在 (doc.exists)
    const data = doc.data();

    // Helper: 嚴格計算 rejectedDuplicateCount，禁止 (value || 0) + 1 掩蓋資料庫損毀
    function getNextRejectedDuplicateCount(currentDocData) {
      if (currentDocData.rejectedDuplicateCount === undefined || currentDocData.rejectedDuplicateCount === null) {
        return 1;
      }
      const count = currentDocData.rejectedDuplicateCount;
      if (!Number.isInteger(count) || count < 0) {
        throw new Error("CORRUPT_DOCUMENT_STATE: rejectedDuplicateCount is corrupt");
      }
      return count + 1;
    }

    const incomingHash = envelope.payloadHash;
    const isValidIncomingHashFormat = typeof incomingHash === "string" && /^[0-9a-f]{64}$/.test(incomingHash);

    // 1 & 2. 若 incoming payloadHash 缺失或格式不合法：視為 malformed duplicate，絕不破壞既有 status 或快照
    if (!isValidIncomingHashFormat) {
      const nextDupCount = getNextRejectedDuplicateCount(data);
      transaction.update(docRef, {
        lastAttemptAt: nowTs,
        rejectedDuplicateCount: nextDupCount
      });
      return { action: "REJECT_INVALID_DUPLICATE", errorCode: "INVALID_PAYLOAD_HASH", reason: "MALFORMED_DUPLICATE_PAYLOAD_HASH" };
    }

    // 3. 只有 incoming payloadHash 格式合法且與既有完整 hash 不同，才轉 MANUAL_REVIEW_REQUIRED（不覆蓋快照）
    if (data.payloadHash !== incomingHash) {
      transaction.update(docRef, {
        status: "MANUAL_REVIEW_REQUIRED",
        lastAttemptAt: nowTs,
        lastErrorCode: "PAYLOAD_HASH_MISMATCH"
      });
      return { action: "CONFLICT", errorCode: "PAYLOAD_HASH_MISMATCH" };
    }

    // C. operationId 合法、既有文件存在、payloadHash 相同，但重複 Envelope 其他欄位畸形：
    // 不得把既有 SUCCEEDED/PROCESSING 狀態改壞，不得清空或覆蓋 projectionSnapshot
    // 固定 ACK / REJECT_INVALID_DUPLICATE，0 Sheet 寫入，更新 rejectedDuplicateCount
    if (!validation.valid) {
      const nextDupCount = getNextRejectedDuplicateCount(data);
      transaction.update(docRef, {
        lastAttemptAt: nowTs,
        rejectedDuplicateCount: nextDupCount
      });
      return { action: "REJECT_INVALID_DUPLICATE", errorCode: validation.errorCode, reason: "MALFORMED_DUPLICATE_ENVELOPE" };
    }

    // 正常合法之重複抵達
    if (data.status === "SUCCEEDED") {
      return { action: "SKIP_ACK", reason: "ALREADY_COMPLETED" };
    }

    const activeExpiresMillis = data.leaseExpiresAt ? data.leaseExpiresAt.toMillis() : 0;
    if (data.status === "PROCESSING" && activeExpiresMillis > nowMillis) {
      // TC-03: 有效租約重複抵達，回傳固定 ACK 且 0 寫入
      return { action: "SKIP_ACK", reason: "LEASE_ACTIVE_IN_ANOTHER_WORKER" };
    }

    // TC-05: 租約已過期或狀態為重試失敗，原子接手認領
    const nextVersion = (data.claimVersion || 0) + 1;
    transaction.update(docRef, {
      status: "PROCESSING",
      claimVersion: nextVersion,
      leaseOwner: workerInstanceId,
      leaseExpiresAt: newExpiresTs,
      attemptCount: (data.attemptCount || 0) + 1,
      lastAttemptAt: nowTs
      // Erratum 1 規範：重發時嚴禁覆蓋 projectionSnapshot
    });

    return { action: "PROCEED", claimVersion: nextVersion, record: data };
  });
}
```

---

### Task 2: Pre-Sheet-Write Authoritative Firestore Re-Validation with FakeClock (TC-04, TC-06)
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/services/projection-worker-service.js`
  - Modify: `tests/simulations/stage-42-g3-projection-worker.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `allocation-assistant/services/projection-worker-service.js`: 實作 `verifyAuthoritativeLeaseBeforeSheetWrite()`。
- **Consumes / Produces 介面**:
  - Consumes: Firestore Client, `operationId`, claimedVersion, currentWorkerId, `Clock`。
  - Produces: 驗證通過布林值；若失效則拋出具體原因。
- **精確函式名稱**:
  - `verifyAuthoritativeLeaseBeforeSheetWrite(db: object, operationId: string, claimedVersion: number, currentWorkerId: string, clock: object): Promise<{ valid: boolean, errorCode?: string }>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-04, TC-06)**
    撰寫測試：
    1. 驗證四項條件全部符合時回傳 `valid = true`。
    2. 使用 `fakeClock.advanceMillis(181000)` 模擬租約過期，驗證回傳 `LEASE_EXPIRED` (TC-04)。
    3. 模擬其他 Worker 接手導致 `claimVersion` 提升，舊 Worker 驗證回傳 `CLAIM_VERSION_MISMATCH` (TC-06)。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因尚未實作寫入前權威校驗失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作 Firestore 權威重新讀取與 4 條件嚴格校驗。
  - [ ] **Step 4: 執行並確認 TC-04, TC-06 通過**
    確認 TC-04 與 TC-06 測試通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g3-projection-worker`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement pre-sheet-write authoritative check (TC-04, TC-06)`

- **最小實作程式碼範例**:
```javascript
async function verifyAuthoritativeLeaseBeforeSheetWrite(db, operationId, claimedVersion, currentWorkerId, clock) {
  const docRef = db.collection("projectionOperations").doc(operationId);
  const doc = await docRef.get();
  if (!doc.exists) {
    return { valid: false, errorCode: "DOCUMENT_NOT_FOUND" };
  }
  const data = doc.data();
  const nowMillis = clock.nowTimestamp().toMillis();
  const expiresMillis = data.leaseExpiresAt ? data.leaseExpiresAt.toMillis() : 0;

  if (data.status !== "PROCESSING") {
    return { valid: false, errorCode: "STATUS_NOT_PROCESSING" };
  }
  if (data.leaseOwner !== currentWorkerId) {
    return { valid: false, errorCode: "LEASE_OWNER_MISMATCH" };
  }
  if (data.claimVersion !== claimedVersion) {
    return { valid: false, errorCode: "CLAIM_VERSION_MISMATCH" };
  }
  if (expiresMillis <= nowMillis) {
    return { valid: false, errorCode: "LEASE_EXPIRED" };
  }

  return { valid: true };
}
```

---

### Task 3: Fake Google Sheets Client Adapter & Search-and-Append Engine (TC-08, TC-18)
- **Create / Modify / Test 路徑**:
  - Create: `tests/mocks/fake-google-sheets-client-adapter.js`
  - Modify: `allocation-assistant/services/projection-worker-service.js`
  - Modify: `tests/simulations/stage-42-g3-projection-worker.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `tests/mocks/fake-google-sheets-client-adapter.js`: 實作純記憶體 12 欄物理表格模擬配接器。
  - `allocation-assistant/services/projection-worker-service.js`: 實作 `upsertProjectionLogSheetRow()`。
- **Consumes / Produces 介面**:
  - Consumes: Sheets Client, 12 欄投影資料列, `Clock`。
  - Produces: 試算表寫入結果（`APPENDED` | `ALREADY_EXISTS`）。
- **精確函式名稱**:
  - `upsertProjectionLogSheetRow(sheetsClient: object, rowData: any[]): Promise<{ action: string }>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-08, TC-18)**
    撰寫測試：
    1. 驗證 12 欄物理資料格式，特別驗證 `quantity` 必須為有限整數，`quantity = 0` 不得被掩蓋。
    2. 模擬 Sheet 成功但後續更新失敗時，重試不產生重複列（TC-08）。
    3. 模擬 403 權限錯誤拋出 `SHEET_PERMISSION_DENIED` Fail-Closed（TC-18）。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因尚未實作追加引擎或配接器失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作 Fake Sheets Client 與 12 欄 Search-and-Append 引擎。
  - [ ] **Step 4: 執行並確認 TC-08, TC-18 通過**
    確認 TC-08 與 TC-18 測試通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g3-projection-worker`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement fake sheets adapter and search-and-append (TC-08, TC-18)`

- **最小實作程式碼範例**:
```javascript
async function upsertProjectionLogSheetRow(sheetsClient, rowData) {
  if (!Array.isArray(rowData) || rowData.length !== 12) {
    throw new Error("INVALID_SHEET_ROW: Row must contain exactly 12 columns");
  }
  const quantity = rowData[6];
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("INVALID_QUANTITY_VALUE: quantity must be a positive finite integer (> 0)");
  }

  const projectionKey = rowData[0];
  const existingRows = await sheetsClient.findRowsByColumn("PROJECTION_LOG", "A", projectionKey);
  if (existingRows.length > 0) {
    return { action: "ALREADY_EXISTS" };
  }

  await sheetsClient.appendRow("PROJECTION_LOG", rowData);
  return { action: "APPENDED" };
}
```

---

### Task 4: Projection Finalization & Error Taxonomy Dispatcher (TC-09)
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/services/projection-worker-service.js`
  - Modify: `tests/simulations/stage-42-g3-projection-worker.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `allocation-assistant/services/projection-worker-service.js`: 實作 `finalizeProjectionSuccess()` 與 `handleProjectionError()`。
- **Consumes / Produces 介面**:
  - Consumes: Firestore Client, `operationId`, `claimVersion`, `Clock`。
  - Produces: 最終狀態更新與標準化回傳代碼。
- **精確函式名稱**:
  - `finalizeProjectionSuccess(db: object, operationId: string, claimVersion: number, clock: object): Promise<void>`
  - `handleProjectionError(db: object, operationId: string, claimVersion: number, error: Error, clock: object): Promise<{ ack: boolean }>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-09)**
    撰寫測試：
    1. 成功結案：更新狀態為 `SUCCEEDED`，設定 `completedAt`，並計算 `projectionSnapshotExpiresAt = completedAt + 90 天`。
    2. 不可重試錯誤（如格式損毀、403、非法欄位）：狀態更新為 `MANUAL_REVIEW_REQUIRED`，回傳 `{ ack: true }`（TC-09）。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因尚未實作結案與分發邏輯失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作結案與錯誤分類處置函式。
  - [ ] **Step 4: 執行並確認 TC-09 通過**
    確認結案與 TC-09 通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g3-projection-worker`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement projection finalization and error taxonomy (TC-09)`

- **最小實作程式碼範例**:
```javascript
async function finalizeProjectionSuccess(db, operationId, claimVersion, clock) {
  const docRef = db.collection("projectionOperations").doc(operationId);
  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) throw new Error("OPERATION_NOT_FOUND");
    const data = doc.data();
    if (data.claimVersion !== claimVersion) throw new Error("CLAIM_VERSION_MISMATCH");

    const completedAt = clock.nowTimestamp();
    const admin = require("firebase-admin");
    const ninetyDaysMs = 90 * 86400 * 1000;
    const projectionSnapshotExpiresAt = admin.firestore.Timestamp.fromMillis(completedAt.toMillis() + ninetyDaysMs);

    transaction.update(docRef, {
      status: "SUCCEEDED",
      completedAt,
      projectionSnapshotExpiresAt,
      lastAttemptAt: completedAt
    });
  });
}

async function handleProjectionError(db, operationId, claimVersion, error, clock) {
  const docRef = db.collection("projectionOperations").doc(operationId);
  const nowTs = clock.nowTimestamp();
  const nonRetryableCodes = ["PAYLOAD_HASH_MISMATCH", "UNSUPPORTED_SCHEMA_VERSION", "SHEET_PERMISSION_DENIED", "FAIL_CLOSED_SNAPSHOT_VALIDATION"];
  const isNonRetryable = nonRetryableCodes.includes(error.message) || (error.code && nonRetryableCodes.includes(error.code));

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) return;
    const data = doc.data();
    if (data.claimVersion !== claimVersion) return;

    if (isNonRetryable) {
      transaction.update(docRef, {
        status: "MANUAL_REVIEW_REQUIRED",
        lastAttemptAt: nowTs,
        lastError: { message: error.message, time: nowTs }
      });
    } else {
      transaction.update(docRef, {
        status: "FAILED_RETRYABLE",
        lastAttemptAt: nowTs,
        lastError: { message: error.message, time: nowTs }
      });
    }
  });

  return { ack: isNonRetryable };
}
```

- **Test Registry Export 規範 (`tests/simulations/stage-42-g3-projection-worker.sim.js`)**:
```javascript
module.exports = {
  tests: [
    {
      id: "TC-03",
      name: "Duplicate message during active lease returns fixed ACK and zero sheet writes",
      run: testDuplicateMessageDuringActiveLease
    },
    {
      id: "TC-04",
      name: "Worker re-validates authoritative Firestore lease before Sheet API call fail-closed",
      run: testPreSheetWriteAuthoritativeCheck
    },
    {
      id: "TC-05",
      name: "Expired processing lease allows new worker takeover and increments claimVersion",
      run: testExpiredProcessingLeaseTakeover
    },
    {
      id: "TC-06",
      name: "Stale worker with lower claimVersion is rejected during Firestore state finalization",
      run: testStaleWorkerFencingTokenRejected
    },
    {
      id: "TC-08",
      name: "Crash after sheet write does not create duplicate row on subsequent retry",
      run: testCrashAfterSheetWriteNoDuplicate
    },
    {
      id: "TC-09",
      name: "Non-retryable error transitions to MANUAL_REVIEW_REQUIRED and returns ACK",
      run: testNonRetryableErrorHandling
    },
    {
      id: "TC-18",
      name: "Google Sheets API 403 permission denied fails closed with SHEET_PERMISSION_DENIED",
      run: testSheetPermissionDeniedFailClosed
    }
  ]
};
```
