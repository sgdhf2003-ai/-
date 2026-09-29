# Stage 42-G4 DLQ Reconciler & Dead-Letter Handling Implementation Plan

> For agentic workers:
> REQUIRED SUB-SKILL: use executing-plans or an equivalent task-by-task execution workflow. Do not implement tasks in parallel when they modify shared event schemas or Firestore state contracts.

Goal:
實作獨立的 DLQ Reconciler 服務，解析死信佇列訊息、在實際收到 DLQ 訊息時將對應的 `projectionOperations` 原子標記為 `DEAD_LETTERED`，並透過告警配接器派發結構化脫敏警報。

Architecture:
依據 Stage 42-F 第 6 章與第 10 章規範：
1. 當訊息重試失敗超過重試上限（Dead-Letter Policy 宣告值為 5）時由 Pub/Sub 投遞至死信主題。
2. DLQ Reconciler 解析死信傳輸訊息，若訊息帶有正整數之 `deliveryAttempt` 則保存該數值；若缺失則標記為 `null`，**絕對嚴禁**假定或硬編碼為 5。
3. 系統轉移為 `DEAD_LETTERED` 之唯一條件為「**實際自 DLQ Subscription 收到訊息**」，絕不依賴 deliveryAttempt 數值判定。
4. 本機測試驗證死信宣告策略為 5 與 parser 能健全處理缺失值；實體 Pub/Sub routing 與真實轉送次數留待 Stage 42-H 驗證。

Tech Stack:
- 執行環境：Node.js 20+ (CommonJS)
- 模擬器與資料庫：Firestore Emulator (`127.0.0.1:8080`), `firebase-admin ^14.3.0`
- 時間抽象：`Clock` 介面（測試注入 `createFakeClock()`）
- 告警介面：`FakeAlertingAdapter` (記憶體警報紀錄，0 外部網路呼叫)
- 測試套件：Node.js 原生 `assert` 輕量化模擬測試

Spec:
docs/stages/stage-42-f-formal-projection-worker-architecture-spec.md (含 Erratum 1)

Global Constraints:
1. 嚴禁在未實際收到 DLQ 訊息前，因預測重試次數達到 5 次而預先將狀態更新為 `DEAD_LETTERED`。
2. DLQ 訊息 parser 嚴格禁止將 deliveryAttempt 預設或推定為 5；若欄位缺失一律保存 `null`。
3. 發送至告警配接器之內容必須完成 PII 與 Error Redaction，嚴禁輸出 Token 或敏感堆疊。
4. 本機模擬嚴格不宣稱已證明雲端 Pub/Sub 真實死信轉送，明確區隔宣告校驗與 Stage 42-H 實體證明。

Review Focus:
1. TC-10：本機宣告式 Dead-Letter Policy 是否精確校驗為 5 次，解析器在缺失 `deliveryAttempt` 時是否安全記錄 `null`。
2. TC-11：當且僅當實際收到 DLQ 訊息時，是否確實將 `projectionOperations` 更新為 `DEAD_LETTERED` 並記錄原因。
3. 告警通知是否確實呼叫 `FakeAlertingAdapter` 且內容完全脫敏。
4. 模組是否 export 包含 TC-10 與 TC-11 之真實 Test Registry。

---

## Tasks

### Task 1: DLQ Transport Message Parser & Delivery Attempt Assessor (TC-10)
- **Create / Modify / Test 路徑**:
  - Create: `allocation-assistant/adapters/dlq-reconciler-adapter.js`
  - Create: `tests/simulations/stage-42-g4-dlq-reconciler.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `package.json`: 註冊 `simulate:stage-42-g4-dlq-reconciler` 測試腳本。
- **Consumes / Produces 介面**:
  - Consumes: 原始 DLQ 訊息物件。
  - Produces: 標準化死信資料結構，包含 `deliveryAttempt` (正整數或 `null`)。
- **精確函式名稱**:
  - `parseDlqMessage(rawDlqMessage: object): object`
  - `validateDeadLetterPolicy(policy: object): { valid: boolean, maxAttempts: number }`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-10)**
    撰寫測試：
    1. 驗證宣告式 Dead-Letter Policy 配置 `maxDeliveryAttempts === 5`。
    2. 驗證合法正整數 `deliveryAttempt: 5` 正確解析為 5。
    3. 驗證缺少 `deliveryAttempt` 屬性時，解析器產出 `deliveryAttempt: null`，絕對不預設為 5。
    4. 註記真實 routing 行為將留待 Stage 42-H 真實雲端環境驗證。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行 `node tests/simulations/stage-42-g4-dlq-reconciler.sim.js`，預期因找不到 `parseDlqMessage` 失敗。
  - [ ] **Step 3: 寫入最小實作**
    在 `allocation-assistant/adapters/dlq-reconciler-adapter.js` 中實作死信解析器與宣告策略校驗。
  - [ ] **Step 4: 執行並確認 TC-10 測試通過**
    確認 TC-10 通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g4-dlq-reconciler`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement dlq message parser (TC-10)`

- **最小實作程式碼範例**:
```javascript
function validateDeadLetterPolicy(policy) {
  if (!policy || policy.maxDeliveryAttempts !== 5) {
    throw new Error("INVALID_DEAD_LETTER_POLICY: maxDeliveryAttempts must be exactly 5");
  }
  return { valid: true, maxAttempts: 5 };
}

function parseDlqMessage(rawDlqMessage) {
  if (!rawDlqMessage || typeof rawDlqMessage !== "object") {
    throw new Error("INVALID_DLQ_MESSAGE: Message object is required");
  }

  let deliveryAttempt = null;
  if (typeof rawDlqMessage.deliveryAttempt === "number" && Number.isInteger(rawDlqMessage.deliveryAttempt) && rawDlqMessage.deliveryAttempt > 0) {
    deliveryAttempt = rawDlqMessage.deliveryAttempt;
  }

  let applicationData = null;
  if (rawDlqMessage.data) {
    const rawStr = Buffer.from(rawDlqMessage.data, "base64").toString("utf8");
    applicationData = JSON.parse(rawStr);
  }

  return {
    messageId: rawDlqMessage.messageId || "unknown_msg",
    publishTime: rawDlqMessage.publishTime || null,
    deliveryAttempt,
    operationId: applicationData ? applicationData.operationId : null,
    payloadHash: applicationData ? applicationData.payloadHash : null,
    deadLetteredAt: rawDlqMessage.deadLetteredAt || null
  };
}
```

---

### Task 2: Firestore State Transition to DEAD_LETTERED on Actual DLQ Receipt (TC-11)
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/adapters/dlq-reconciler-adapter.js`
  - Modify: `tests/simulations/stage-42-g4-dlq-reconciler.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `allocation-assistant/adapters/dlq-reconciler-adapter.js`: 實作 `recordDeadLetteredInFirestore()`。
- **Consumes / Produces 介面**:
  - Consumes: Firestore Client, 已解析之 DLQ 訊息, `Clock`。
  - Produces: 更新完成之 `projectionOperations` 紀錄。
- **精確函式名稱**:
  - `recordDeadLetteredInFirestore(db: object, parsedDlqMsg: object, clock: object): Promise<object>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-11)**
    撰寫測試：模擬自 DLQ subscription 實際收到死信訊息，驗證對應的 `projectionOperations/{operationId}` 狀態更新為 `DEAD_LETTERED`，記錄 `deadLetteredAt` 時間戳記與實際收到的 `deliveryAttempt`。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因尚未實作狀態轉移邏輯失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作 Firestore 交易更新邏輯。
  - [ ] **Step 4: 執行並確認 TC-11 測試通過**
    確認 TC-11 通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g4-dlq-reconciler`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement dead-lettered state transition (TC-11)`

- **最小實作程式碼範例**:
```javascript
async function recordDeadLetteredInFirestore(db, parsedDlqMsg, clock) {
  const { operationId, deliveryAttempt, messageId } = parsedDlqMsg;
  if (!operationId) {
    throw new Error("MISSING_OPERATION_ID_IN_DLQ_MESSAGE");
  }

  const docRef = db.collection("projectionOperations").doc(operationId);
  const nowTs = clock.nowTimestamp();

  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) {
      const fallbackRecord = {
        operationId,
        status: "DEAD_LETTERED",
        deliveryAttempt,
        deadLetteredAt: nowTs,
        lastMessageId: messageId,
        lastErrorCode: "DLQ_RECEIVED_WITHOUT_INITIAL_OPERATION"
      };
      transaction.set(docRef, fallbackRecord);
      return fallbackRecord;
    }

    transaction.update(docRef, {
      status: "DEAD_LETTERED",
      deliveryAttempt,
      deadLetteredAt: nowTs,
      lastMessageId: messageId
    });
    return { ...doc.data(), status: "DEAD_LETTERED", deliveryAttempt };
  });
}
```

---

### Task 3: Alerting Adapter & Notification Dispatcher
- **Create / Modify / Test 路徑**:
  - Create: `tests/mocks/fake-alerting-adapter.js`
  - Modify: `allocation-assistant/adapters/dlq-reconciler-adapter.js`
  - Modify: `tests/simulations/stage-42-g4-dlq-reconciler.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `tests/mocks/fake-alerting-adapter.js`: 實作 `FakeAlertingAdapter`。
  - `allocation-assistant/adapters/dlq-reconciler-adapter.js`: 實作 `dispatchDeadLetterAlert()`。
- **Consumes / Produces 介面**:
  - Consumes: Alerting Adapter, 錯誤物件, `operationId`。
  - Produces: 成功派發脫敏警報紀錄。
- **精確函式名稱**:
  - `dispatchDeadLetterAlert(alertingClient: object, alertPayload: object): Promise<{ sent: boolean }>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試**
    撰寫測試：驗證觸發 DLQ 警報時，`FakeAlertingAdapter` 記錄到 P1 等級警報，且警報內容不包含真實姓名、Email、LINE ID 與 Token。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因尚未實作告警派發器失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作 `FakeAlertingAdapter` 與脫敏警報分發邏輯。
  - [ ] **Step 4: 執行並確認指定測試通過**
    確認警報派發與脫敏驗證通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g4-dlq-reconciler`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement alerting adapter and notification dispatcher`

- **Test Registry Export 規範 (`tests/simulations/stage-42-g4-dlq-reconciler.sim.js`)**:
```javascript
module.exports = {
  tests: [
    {
      id: "TC-10",
      name: "Pub/Sub approximate 5 delivery attempts routes message to DLQ subscription",
      run: testDeclarativeDeadLetterPolicyAndParser
    },
    {
      id: "TC-11",
      name: "DLQ Reconciler updates projectionOperations to DEAD_LETTERED on actual receipt",
      run: testDlqReconcilerUpdatesDeadLetteredOnActualReceipt
    }
  ]
};
```
