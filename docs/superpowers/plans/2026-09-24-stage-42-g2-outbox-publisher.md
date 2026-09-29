# Stage 42-G2 Transactional Outbox & Publisher Implementation Plan

> For agentic workers:
> REQUIRED SUB-SKILL: use executing-plans or an equivalent task-by-task execution workflow. Do not implement tasks in parallel when they modify shared event schemas or Firestore state contracts.

Goal:
實作 Transactional Outbox 建立、受控 Clock 下的租約認領、Publisher Completion Fencing 發布防護，以及 5 分鐘 Outbox 對帳補償掃描機制。

Architecture:
依據 Stage 42-F 第 4 章、第 6 章與第 10 章規範，業務交易發起時在同一個 Firestore 交易中原子且冪等建立 `projectionOutbox/{operationId}`。獨立的 Outbox Publisher 定期批次認領過期或未處理的 Outbox 紀錄（60 秒發布租約），透過 `FakePubSubClientAdapter` 發布至 Pub/Sub 主題。成功後透過 `markOutboxPublished` 驗證發布者租約擁有權與到期時間，防止過期 Publisher 覆蓋新 Publisher 狀態。

Tech Stack:
- 執行環境：Node.js 20+ (CommonJS)
- 模擬器與資料庫：Firestore Emulator (`127.0.0.1:8080`), `firebase-admin ^14.3.0`
- 時間抽象：`Clock` 介面（測試注入 `createFakeClock()`）
- 模擬介面：`FakePubSubClientAdapter` (記憶體訊息佇列，0 真實 GCP 呼叫)
- 測試套件：Node.js 原生 `assert` 輕量化模擬測試

Spec:
docs/stages/stage-42-f-formal-projection-worker-architecture-spec.md (含 Erratum 1)

Global Constraints:
1. 嚴格禁止向真實 GCP Pub/Sub 建立 Topic 或發送網路請求，所有測試均使用 `FakePubSubClientAdapter`。
2. `eventId` 必須在 Outbox 建立時產生，同一 `operationId` 於重發時絕對沿用原始 `eventId`。
3. `publishAttemptId` 為每次發布嘗試之獨立唯一 UUIDv4。
4. 所有租約到期時間（`publisherLeaseExpiresAt`）一律使用 Firestore Timestamp，時間比較一律使用 `Timestamp.toMillis()`。
5. 核心租約與過期邏輯嚴禁使用 process-local `new Date()` 或 `Date.now()`，必須透過 `Clock` 介面注入。
6. 測試中推進時間必須使用 `FakeClock.advanceMillis()`，嚴禁直接修改資料庫欄位為過去 ISO 字串。

Review Focus:
1. `stageProjectionOutboxInTransaction` 是否先在交易內讀取既有 Outbox，並在相同 hash 時沿用 `eventId`、不同 hash 時安全 fail-closed。
2. 交易 abort 時，業務集合與 Outbox 集合是否達成 0 寫入。
3. `markOutboxPublished` 是否同時校驗 `publisherLeaseOwner`, `publishAttemptId`, `status == PENDING` 及 `publisherLeaseExpiresAt` 有效性。
4. 5 分鐘補償掃描重發時是否確實沿用原始 `eventId` 且指派新的 `publishAttemptId`。
5. 模組是否 export 包含 TC-01 與 TC-14 之真實 Test Registry。

---

## Tasks

### Task 1: Transactional Outbox Creator & In-Transaction Idempotency Guard
- **Create / Modify / Test 路徑**:
  - Create: `allocation-assistant/adapters/outbox-publisher-adapter.js`
  - Create: `tests/simulations/stage-42-g2-outbox-publisher.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `package.json`: 註冊 `simulate:stage-42-g2-outbox-publisher` 測試腳本。
- **Consumes / Produces 介面**:
  - Consumes: Firestore Transaction, `operationId`, `allocationData`, `operatorId`, `Clock`。
  - Produces: 建立或沿用之 `projectionOutbox` 文件資料。
- **精確函式名稱**:
  - `stageProjectionOutboxInTransaction(transaction: object, db: object, params: object, clock: object): Promise<object>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試**
    在 `tests/simulations/stage-42-g2-outbox-publisher.sim.js` 中寫入測試：
    1. 交易 abort 時，業務資料與 Outbox 均為 0 寫入。
    2. 首次呼叫時建立新 Outbox，`status = 'PENDING'`，`eventId` 格式正確。
    3. 相同 `operationId` 且相同 `payloadHash` 重送時，回傳既有 Outbox 並沿用原始 `eventId`。
    4. 相同 `operationId` 但不同 `payloadHash` 重送時，fail-closed 拋出 `OUTBOX_IDEMPOTENCY_CONFLICT`。
    5. 模擬兩次併發建立僅產生一份 Outbox 文件。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行 `node tests/simulations/stage-42-g2-outbox-publisher.sim.js`，預期因找不到 `stageProjectionOutboxInTransaction` 失敗。
  - [ ] **Step 3: 寫入最小實作**
    在 `allocation-assistant/adapters/outbox-publisher-adapter.js` 中實作交易內讀取、雜湊比對與安全 set 邏輯。
  - [ ] **Step 4: 執行並確認指定測試通過**
    執行測試，確認交易防護與冪等性全部 PASS。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g2-outbox-publisher`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement transactional outbox creator and idempotency guard`

- **最小實作程式碼範例**:
```javascript
const crypto = require("crypto");
const { computePayloadHash64 } = require("../contracts/projection-contract");

async function stageProjectionOutboxInTransaction(transaction, db, params, clock) {
  const { operationId, reservationNumber, allocationData, operatorId } = params;
  if (!operationId || !reservationNumber || !allocationData || !operatorId) {
    throw new Error("INVALID_OUTBOX_PARAMS: operationId, reservationNumber, allocationData, and operatorId are required");
  }

  const payloadHash = computePayloadHash64(allocationData);
  const outboxRef = db.collection("projectionOutbox").doc(operationId);
  const existingDoc = await transaction.get(outboxRef);

  if (existingDoc.exists) {
    const existingData = existingDoc.data();
    if (existingData.payloadHash !== payloadHash) {
      throw new Error("OUTBOX_IDEMPOTENCY_CONFLICT: payload hash mismatch for existing operationId");
    }
    // 冪等重送：沿用既有 eventId，不覆蓋不新增
    return existingData;
  }

  const eventId = `evt_${crypto.randomUUID()}`;
  const nowTs = clock.nowTimestamp();
  const outboxEntry = {
    operationId,
    reservationNumber,
    eventId,
    payloadHash,
    payload: allocationData,
    status: "PENDING",
    createdAt: nowTs,
    lastAttemptAt: null,
    publishAttemptCount: 0,
    publisherLeaseOwner: null,
    publisherLeaseExpiresAt: null,
    operator: {
      pseudonymousActorId: operatorId
    }
  };

  transaction.set(outboxRef, outboxEntry);
  return outboxEntry;
}

---

### Task 2: 60-Second Lease Claim Protocol with FakeClock
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/adapters/outbox-publisher-adapter.js`
  - Modify: `tests/simulations/stage-42-g2-outbox-publisher.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `allocation-assistant/adapters/outbox-publisher-adapter.js`: 實作 `claimOutboxBatchForPublishing()`。
- **Consumes / Produces 介面**:
  - Consumes: Firestore Client, Publisher 實例識別碼, 批次上限（預設 10）, `Clock`。
  - Produces: 成功認領 60 秒發布租約之 Outbox 文件陣列。
- **精確函式名稱**:
  - `claimOutboxBatchForPublishing(db: object, publisherInstanceId: string, options: object, clock: object): Promise<object[]>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試**
    寫入租約認領測試：未過期租約無法被其他 Publisher 搶占；使用 `fakeClock.advanceMillis(61000)` 推進時間後，過期租約能被新 Publisher 成功認領接手。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因尚未實作 `claimOutboxBatchForPublishing` 失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作批次查詢與交易認領邏輯，使用 `clock.nowTimestamp()` 與 Firestore Timestamp 運算。
  - [ ] **Step 4: 執行並確認指定測試通過**
    確認租約認領與 FakeClock 時間推進接手測試通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g2-outbox-publisher`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement outbox lease claim protocol with clock`

- **最小實作程式碼範例**:
```javascript
async function claimOutboxBatchForPublishing(db, publisherInstanceId, options = {}, clock) {
  const batchSize = options.batchSize || 10;
  const nowTs = clock.nowTimestamp();
  const nowMillis = nowTs.toMillis();
  const leaseDurationMs = 60 * 1000;
  const admin = require("firebase-admin");

  const snapshot = await db.collection("projectionOutbox")
    .where("status", "==", "PENDING")
    .limit(batchSize)
    .get();

  const claimed = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const leaseExpiresAtMillis = data.publisherLeaseExpiresAt ? data.publisherLeaseExpiresAt.toMillis() : 0;
    if (!data.publisherLeaseOwner || leaseExpiresAtMillis <= nowMillis) {
      // 租約可用或已過期，執行原子認領
      const newExpiresMillis = nowMillis + leaseDurationMs;
      const newExpiresTs = admin.firestore.Timestamp.fromMillis(newExpiresMillis);

      await doc.ref.update({
        publisherLeaseOwner: publisherInstanceId,
        publisherLeaseExpiresAt: newExpiresTs,
        lastAttemptAt: nowTs,
        publishAttemptCount: (data.publishAttemptCount || 0) + 1
      });
      claimed.push({ ...data, publisherLeaseOwner: publisherInstanceId, publisherLeaseExpiresAt: newExpiresTs });
    }
  }
  return claimed;
}
```

---

### Task 3: Pub/Sub Publisher Adapter Boundary & Completion Fencing (TC-01)
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/adapters/outbox-publisher-adapter.js`
  - Create: `tests/mocks/fake-pubsub-client-adapter.js`
  - Modify: `tests/simulations/stage-42-g2-outbox-publisher.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `tests/mocks/fake-pubsub-client-adapter.js`: 實作 `FakePubSubClientAdapter`。
  - `allocation-assistant/adapters/outbox-publisher-adapter.js`: 實作 `publishOutboxBatch()` 與 `markOutboxPublished()`。
- **Consumes / Produces 介面**:
  - Consumes: Outbox 項目、FakePubSubClientAdapter, Publisher 身分, `Clock`。
  - Produces: 發布結果，並由 `markOutboxPublished` 驗證完成防護。
- **精確函式名稱**:
  - `publishOutboxBatch(db: object, pubsubClient: object, publisherInstanceId: string, clock: object): Promise<object>`
  - `markOutboxPublished(db: object, claimContext: object, clock: object): Promise<{ success: boolean, errorCode?: string }>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-01)**
    撰寫 `runTC01()`：
    1. 驗證 Publisher 發布後若未標記前崩潰，重試時沿用原始 `eventId` 並指派新 `publishAttemptId`。
    2. 驗證 `markOutboxPublished` 進行 Completion Fencing：若 `publisherLeaseOwner` 不符、`publishAttemptId` 不符、狀態非 `PENDING` 或 `publisherLeaseExpiresAt` 已過期，拒絕標記為 `PUBLISHED` 並回傳 `PUBLISH_LEASE_LOST`。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因尚未實作防護邏輯失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作 Fake Pub/Sub Client 與 `markOutboxPublished` 嚴格校驗。
  - [ ] **Step 4: 執行並確認 TC-01 測試通過**
    確認 TC-01 通過且過期標記被安全攔截。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g2-outbox-publisher`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement publisher adapter and completion fencing (TC-01)`

- **最小實作程式碼範例 (`markOutboxPublished`)**:
```javascript
async function markOutboxPublished(db, claimContext, clock) {
  const { operationId, publisherLeaseOwner, publishAttemptId } = claimContext;
  const outboxRef = db.collection("projectionOutbox").doc(operationId);

  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(outboxRef);
    if (!doc.exists) {
      return { success: false, errorCode: "OUTBOX_NOT_FOUND" };
    }
    const data = doc.data();

    // 租約與完成防護校驗 (Completion Fencing)
    const nowMillis = clock.nowTimestamp().toMillis();
    const expiresMillis = data.publisherLeaseExpiresAt ? data.publisherLeaseExpiresAt.toMillis() : 0;

    if (data.status !== "PENDING") {
      return { success: false, errorCode: "ALREADY_PROCESSED" };
    }
    if (data.publisherLeaseOwner !== publisherLeaseOwner) {
      return { success: false, errorCode: "PUBLISH_LEASE_LOST" };
    }
    if (expiresMillis <= nowMillis) {
      return { success: false, errorCode: "PUBLISH_LEASE_EXPIRED" };
    }

    transaction.update(outboxRef, {
      status: "PUBLISHED",
      publishedAt: clock.nowTimestamp(),
      lastPublishAttemptId: publishAttemptId
    });
    return { success: true };
  });
}
```

---

### Task 4: 5-Minute Outbox Reconciliation Sweep with FakeClock (TC-14)
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/adapters/outbox-publisher-adapter.js`
  - Modify: `tests/simulations/stage-42-g2-outbox-publisher.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `allocation-assistant/adapters/outbox-publisher-adapter.js`: 實作 `reconcileOutboxPendingBatch()`。
- **Consumes / Produces 介面**:
  - Consumes: Firestore Client, FakePubSubClientAdapter, `Clock`。
  - Produces: 掃描並補發超過 2 分鐘滯留之 PENDING 事件。
- **精確函式名稱**:
  - `reconcileOutboxPendingBatch(db: object, pubsubClient: object, clock: object): Promise<{ recoveredCount: number }>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-14)**
    撰寫 `runTC14()`：建立 1 筆 `PENDING` 事件，使用 `fakeClock.advanceMillis(150000)`（2.5 分鐘），執行對帳補發，確認：沿用原始 `eventId`、產生新 `publishAttemptId`、最終狀態更新為 `PUBLISHED`。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因尚未實作 `reconcileOutboxPendingBatch` 失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作滯留掃描與安全補發調度。
  - [ ] **Step 4: 執行並確認 TC-14 測試通過**
    確認 TC-14 通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g2-outbox-publisher`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement outbox reconciliation sweep (TC-14)`

- **Test Registry Export 規範 (`tests/simulations/stage-42-g2-outbox-publisher.sim.js`)**:
```javascript
module.exports = {
  tests: [
    {
      id: "TC-01",
      name: "Publisher crash after publish preserves eventId and generates new publishAttemptId",
      run: testPublisherCrashAndRetry
    },
    {
      id: "TC-14",
      name: "5-minute outbox sweep safely republishes stale PENDING events using original eventId",
      run: testOutboxReconciliationSweep
    }
  ]
};
```
