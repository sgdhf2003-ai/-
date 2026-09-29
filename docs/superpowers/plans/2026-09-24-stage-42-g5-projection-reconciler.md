# Stage 42-G5 Projection Reconciler & Audit Recovery Implementation Plan

> For agentic workers:
> REQUIRED SUB-SKILL: use executing-plans or an equivalent task-by-task execution workflow. Do not implement tasks in parallel when they modify shared event schemas or Firestore state contracts.

Goal:
實作獨立的 Projection Reconciler 對帳服務，採用穩定複合排序分頁掃描 `status == 'SUCCEEDED'` 之紀錄，在稽核列遭誤刪時依據 Erratum 1 `projectionSnapshot` 進行權威重建（絕不依賴 Outbox），並以受控 FakeClock 落實 90 天快照清理與 400 天 Firestore Tombstone 最小化修剪。

Architecture:
依據 Stage 42-F 第 12 章與第 15 章，以及 Erratum 1 規範：
1. 複合排序分頁掃描：依 `completedAt` (Firestore Timestamp) 與 `documentId()` 進行穩定排序分頁，防範相同完成時間點遺漏單據。
2. 權威重建：若 `PROJECTION_LOG` 試算表列遭誤刪，Reconciler 重新認領租約，**只能且必須**自 `projectionOperations` 的 `operationId`、`projectionKey`、`projectionSnapshot` 與 `attemptCount` 重建 12 欄物理列，嚴格禁止跨集合讀取 `projectionOutbox`。
3. 雜湊衝突防護：若試算表列存在但雜湊不符，轉為 `MANUAL_REVIEW_REQUIRED`，絕對嚴禁自動覆蓋。
4. 保存政策引擎：單據完成超過 90 天清除 `projectionSnapshot`；超過 400 天最小化修剪為 Tombstone 結構。

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
2. 重建模組**絕對嚴禁依賴 `projectionOutbox` 集合**，必須全數依據 `projectionOperations.projectionSnapshot`。
3. 雜湊比對必須使用完整 64 個十六進位小寫字元之 SHA-256，雜湊不符時絕對嚴禁自動覆蓋試算表。
4. 稽核列誤刪補回時，必須重新在 Firestore 取得租約，保證操作受租約保護。
5. 所有保存期限計算與過期判定均使用 `Clock` 介面產生的 Firestore Timestamp，測試必須使用 `FakeClock.advanceMillis()` 推進時間。

Review Focus:
1. TC-13：試算表實體列遭刪除時，Reconciler 是否能準確自 `projectionSnapshot` 補回且不重複產生多餘列。
2. 分頁查詢：在多筆單據具備完全相同的 `completedAt` 時，複合排序是否保證不遺漏、不重複資料。
3. 雜湊衝突：試算表存在相同 `projection_key` 但 L 欄雜湊不符時，是否正確轉為 `MANUAL_REVIEW_REQUIRED` 並阻止覆蓋。
4. 保存修剪：90 天是否精確清除 `projectionSnapshot`，400 天是否精確最小化為 Tombstone（僅留 `operationId`, `projectionKey`, `completedAt`, `payloadHash`）。
5. 模組是否 export 包含 TC-13 之真實 Test Registry。

---

## Tasks

### Task 1: Stable Compound Ordering Bounded Scan for Succeeded Operations
- **Create / Modify / Test 路徑**:
  - Create: `allocation-assistant/adapters/projection-reconciler-adapter.js`
  - Create: `tests/simulations/stage-42-g5-projection-reconciler.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `package.json`: 註冊 `simulate:stage-42-g5-projection-reconciler` 測試腳本。
- **Consumes / Produces 介面**:
  - Consumes: Firestore Client, 分頁參數（`batchSize`, `cursor: { completedAt: Timestamp, documentId: string }`）。
  - Produces: 成功單據清單與下一頁複合游標。
- **精確函式名稱**:
  - `scanSucceededProjectionOperations(firestoreDb: object, options?: object): Promise<object>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試**
    撰寫測試：
    1. 建立 5 筆具有相同 `completedAt` Timestamp 之紀錄，驗證透過複合排序分頁查詢無任何遺漏與重複。
    2. 空頁回傳 `{ operations: [], nextCursor: null }`。
    3. 最後一頁不足 `batchSize` 正確終止。
    4. 非法 `batchSize`（負數或超過安全上限 100）拋出 `INVALID_BATCH_SIZE`。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行 `node tests/simulations/stage-42-g5-projection-reconciler.sim.js`，預期因找不到 `scanSucceededProjectionOperations` 失敗。
  - [ ] **Step 3: 寫入最小實作**
    在 `allocation-assistant/adapters/projection-reconciler-adapter.js` 中實作複合排序分頁查詢。
  - [ ] **Step 4: 執行並確認指定測試通過**
    確認分頁邊界與複合游標測試通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g5-projection-reconciler`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement stable compound ordering bounded scan`

- **最小實作程式碼範例**:
```javascript
async function scanSucceededProjectionOperations(firestoreDb, options = {}) {
  const batchSize = options.batchSize || 20;
  if (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > 100) {
    throw new Error("INVALID_BATCH_SIZE: batchSize must be an integer between 1 and 100");
  }

  let query = firestoreDb.collection("projectionOperations")
    .where("status", "==", "SUCCEEDED")
    .orderBy("completedAt", "asc")
    .orderBy(require("firebase-admin").firestore.FieldPath.documentId(), "asc")
    .limit(batchSize);

  if (options.cursor) {
    const { completedAt, documentId } = options.cursor;
    query = query.startAfter(completedAt, documentId);
  }

  const snapshot = await query.get();
  const operations = snapshot.docs.map((doc) => doc.data());
  let nextCursor = null;

  if (snapshot.docs.length === batchSize) {
    const lastDoc = snapshot.docs[snapshot.docs.length - 1];
    nextCursor = {
      completedAt: lastDoc.data().completedAt,
      documentId: lastDoc.id
    };
  }

  return { operations, nextCursor };
}
```

---

### Task 2: Authoritative Sheet Row Verification & Recovery from Projection Snapshot (TC-13)
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/adapters/projection-reconciler-adapter.js`
  - Modify: `tests/simulations/stage-42-g5-projection-reconciler.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `allocation-assistant/adapters/projection-reconciler-adapter.js`: 實作 `claimReconciliationLease()`、`releaseReconciliationLease()` 與 `reconcileProjectionRow()`。
- **Consumes / Produces 介面**:
  - Consumes: Firestore Client, Sheets Client, `operationId`, Reconciler 識別碼, `Clock`。
  - Produces: 對帳結果（`MATCH` | `REPAIRED` | `MANUAL_REVIEW_REQUIRED` | `LEASE_NOT_ACQUIRED` | `PRE_WRITE_CHECK_FAILED`）。
- **精確函式名稱**:
  - `claimReconciliationLease(firestoreDb: object, operationId: string, reconcilerId: string, clock: object): Promise<{ acquired: boolean, claimVersion?: number, reason?: string }>`
  - `releaseReconciliationLease(firestoreDb: object, operationId: string, reconcilerId: string, claimedVersion: number, clock: object): Promise<{ released: boolean, reason?: string }>`
  - `reconcileProjectionRow(firestoreDb: object, sheetsClient: object, operationId: string, currentReconcilerId: string, clock: object): Promise<{ outcome: string, reason?: string }>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-13 與租約併發/TOCTOU 完整防護)**
    撰寫測試：
    1. 正常比對通過回傳 `MATCH`，更新 `lastReconciledAt`，並以條件式交易釋放租約。
    2. 人為刪除試算表列（TC-13）：Reconciler 先在 Firestore 交易中取得專屬對帳租約（核心 `status` 保持 `SUCCEEDED`，嚴禁變更為 `PROCESSING`），權威讀取 Firestore 文件（嚴禁使用呼叫端 stale 快照），取得租約後才查詢 Sheet；若列不存在，在 append 前再次於 transaction 中權威校驗租約有效性、版本一致性與 Snapshot 未過期；以嚴格 5 項來源（`attemptCount` 嚴格正整數）追加 12 欄物理列，條件式釋放租約，更新 `lastReconciledAt`，回傳 `REPAIRED`。
    3. 拒絕重入與併發互斥：同一 `reconcilerId` 的兩個併發執行仍只能 1 個取得租約；未到期租約絕對不因身分相同而允許重入。
    4. 循序防重複 Append：A 認領修復並釋放後，B 隨後認領執行，B 重新查 Sheet 發現已存在且 hash 吻合，回傳 `MATCH`，絕不重複 append。
    5. 快照過期（`projectionSnapshotExpiresAt <= clock.nowTimestamp()`）：認領或寫入前校驗拒絕，0 Sheet 寫入。
    6. 舊版防覆蓋釋放：舊 `claimVersion` 嘗試釋放新租約時失敗，新 Reconciler 租約完整保留。
    7. 無效 attemptCount（缺失、負數、字串）：Fail-Closed 條件式標記 `MANUAL_REVIEW_REQUIRED`，絕對不隱式轉為 1。
    8. 寫入前租約失效：在 append 前若租約已被推進至過期或版本變更，二次校驗攔截，產生 0 Sheet 寫入。
    9. PATCH 3 租約生命週期與寫入前權威重驗防護測試：
       - pre-write check 失敗後租約安全釋放（0 Sheet append）。
       - 舊 claimVersion 無法釋放新租約。
       - 舊 claimVersion 無法標記 `MANUAL_REVIEW_REQUIRED`。
       - claim 時絕不更新 `lastReconciledAt`。
       - 只有 `MATCH` 或 `REPAIRED` 成功結案時才更新 `lastReconciledAt`。
       - append 重建列必須使用最後一次權威 transaction 回傳的資料，嚴禁使用舊快照。
       - attemptCount 在 append 前被篡改時攔截測試（attemptCount 非合法正整數時 0 Sheet append，標記 MANUAL_REVIEW_REQUIRED 並釋放租約）。
       - snapshot hash 與 doc hash 不一致時攔截測試（快照內 payloadHash 與文件 payloadHash 不符時 0 Sheet append，標記 MANUAL_REVIEW_REQUIRED 並釋放租約）。
       - projectionKey 與 operationId 不符時攔截測試（projectionKey !== "PROJECTION_" + operationId 時 0 Sheet append，標記 MANUAL_REVIEW_REQUIRED 並釋放租約）。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行 `node tests/simulations/stage-42-g5-projection-reconciler.sim.js`，預期因尚未實作防重入租約與順序重構邏輯失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作 `claimReconciliationLease`、`markManualReviewUnderReconciliationLease`、`releaseReconciliationLease` 與新版 `reconcileProjectionRow`。
  - [ ] **Step 4: 執行並確認 TC-13 與全量併發/TOCTOU 測試通過**
    確認 TC-13 與全部邊界測試通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g5-projection-reconciler`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement reconciler lease ordering and toctou defense (TC-13)`

- **最小實作程式碼範例**:
```javascript
async function claimReconciliationLease(firestoreDb, operationId, reconcilerId, clock) {
  const docRef = firestoreDb.collection("projectionOperations").doc(operationId);
  const nowTs = clock.nowTimestamp();
  const nowMillis = nowTs.toMillis();
  const admin = require("firebase-admin");
  const leaseDurationMs = 180 * 1000;
  const newExpiresTs = admin.firestore.Timestamp.fromMillis(nowMillis + leaseDurationMs);

  return await firestoreDb.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) return { acquired: false, reason: "NOT_FOUND" };
    const data = doc.data();

    // 核心 status 必須維持 SUCCEEDED，絕對不得改為 PROCESSING
    if (data.status !== "SUCCEEDED") {
      return { acquired: false, reason: "INVALID_STATUS_FOR_RECONCILIATION" };
    }

    // 驗證 snapshot 存在且未過期
    if (!data.projectionSnapshot) {
      return { acquired: false, reason: "MISSING_PROJECTION_SNAPSHOT" };
    }
    const isTimestamp = data.projectionSnapshotExpiresAt instanceof admin.firestore.Timestamp || (data.projectionSnapshotExpiresAt && typeof data.projectionSnapshotExpiresAt.toMillis === "function");
    if (!isTimestamp || data.projectionSnapshotExpiresAt.toMillis() <= nowMillis) {
      return { acquired: false, reason: "PROJECTION_SNAPSHOT_EXPIRED" };
    }

    // 租約未到期時一律拒絕新認領，嚴禁因 reconcilerId 相同而允許重入
    const currentExpiresMillis = data.reconciliationLeaseExpiresAt ? data.reconciliationLeaseExpiresAt.toMillis() : 0;
    if (data.reconciliationLeaseOwner && currentExpiresMillis > nowMillis) {
      return { acquired: false, reason: "LEASE_ACTIVE" };
    }

    const nextVersion = (data.reconciliationClaimVersion || 0) + 1;
    transaction.update(docRef, {
      reconciliationLeaseOwner: reconcilerId,
      reconciliationLeaseExpiresAt: newExpiresTs,
      reconciliationClaimVersion: nextVersion,
      reconciliationAttemptCount: (data.reconciliationAttemptCount || 0) + 1
      // claim 時絕不更新 lastReconciledAt
    });

    return { acquired: true, claimVersion: nextVersion };
  });
}

async function markManualReviewUnderReconciliationLease(firestoreDb, operationId, reconcilerId, claimedVersion, errorCode, clock) {
  const docRef = firestoreDb.collection("projectionOperations").doc(operationId);
  return await firestoreDb.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) return { updated: false, reason: "NOT_FOUND" };
    const data = doc.data();
    if (data.reconciliationLeaseOwner !== reconcilerId || data.reconciliationClaimVersion !== claimedVersion) {
      return { updated: false, reason: "LEASE_CLAIM_MISMATCH" };
    }
    transaction.update(docRef, {
      status: "MANUAL_REVIEW_REQUIRED",
      lastAttemptAt: clock.nowTimestamp(),
      lastErrorCode: errorCode
    });
    return { updated: true };
  });
}

async function releaseReconciliationLease(firestoreDb, operationId, reconcilerId, claimedVersion, options = {}) {
  const { updateLastReconciled = false, clock = null } = options;
  const docRef = firestoreDb.collection("projectionOperations").doc(operationId);
  return await firestoreDb.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) return { released: false, reason: "NOT_FOUND" };
    const data = doc.data();

    // 條件式釋放：比對 owner 與 claimVersion，防止舊 Reconciler 誤清除新 Reconciler 的租約
    if (data.reconciliationLeaseOwner !== reconcilerId || data.reconciliationClaimVersion !== claimedVersion) {
      return { released: false, reason: "LEASE_CLAIM_MISMATCH" };
    }

    const updateFields = {
      reconciliationLeaseOwner: null,
      reconciliationLeaseExpiresAt: null
    };
    if (updateLastReconciled && clock) {
      updateFields.lastReconciledAt = clock.nowTimestamp();
    }

    transaction.update(docRef, updateFields);
    return { released: true };
  });
}

async function reconcileProjectionRow(firestoreDb, sheetsClient, operationId, currentReconcilerId, clock) {
  if (typeof operationId !== "string" || operationId.trim() === "") {
    throw new Error("INVALID_OPERATION_ID");
  }
  const cleanOpId = operationId.trim();

  // 1. 先在 Firestore transaction 取得專屬對帳租約（claim 時絕不更新 lastReconciledAt）
  const leaseResult = await claimReconciliationLease(firestoreDb, cleanOpId, currentReconcilerId, clock);
  if (!leaseResult.acquired) {
    return { outcome: "LEASE_NOT_ACQUIRED", reason: leaseResult.reason };
  }
  const { claimVersion: claimedVersion } = leaseResult;

  let outcome = null;
  let outcomeReason = null;
  let shouldUpdateLastReconciled = false;

  try {
    // 4 & 5. Claim 成功後重新權威讀取 Firestore 文件，嚴禁使用呼叫端 stale 快照
    const authoritativeDoc = await firestoreDb.collection("projectionOperations").doc(cleanOpId).get();
    if (!authoritativeDoc.exists) {
      outcome = "DOCUMENT_NOT_FOUND";
      return { outcome };
    }
    const authData = authoritativeDoc.data();
    const { projectionKey, payloadHash, attemptCount } = authData;

    // 10. attemptCount 必須為合法正整數，無效時在租約保護下條件式更新狀態（嚴禁無條件 doc.update）
    if (!Number.isInteger(attemptCount) || attemptCount <= 0) {
      await markManualReviewUnderReconciliationLease(firestoreDb, cleanOpId, currentReconcilerId, claimedVersion, "INVALID_ATTEMPT_COUNT", clock);
      outcome = "MANUAL_REVIEW_REQUIRED";
      outcomeReason = "INVALID_ATTEMPT_COUNT";
      return { outcome, reason: outcomeReason };
    }

    // 6. 取得租約後才查詢 Sheet
    const existingRows = await sheetsClient.findRowsByColumn("PROJECTION_LOG", "A", projectionKey);

    if (existingRows.length > 0) {
      const sheetHash = existingRows[0][11]; // L 欄 payload_hash
      if (sheetHash !== payloadHash) {
        await markManualReviewUnderReconciliationLease(firestoreDb, cleanOpId, currentReconcilerId, claimedVersion, "PAYLOAD_HASH_MISMATCH", clock);
        outcome = "MANUAL_REVIEW_REQUIRED";
        outcomeReason = "PAYLOAD_HASH_MISMATCH";
        return { outcome, reason: outcomeReason };
      }
      // 7. 雜湊相同：MATCH，允許更新 lastReconciledAt
      shouldUpdateLastReconciled = true;
      outcome = "MATCH";
      return { outcome };
    }

    // 8. 列不存在，在 append 前再次以 transaction 驗證權威租約並完整校驗權威資料
    const preWriteCheck = await firestoreDb.runTransaction(async (transaction) => {
      const doc = await transaction.get(firestoreDb.collection("projectionOperations").doc(cleanOpId));
      if (!doc.exists) return { valid: false, errorCode: "DOC_NOT_FOUND" };
      const current = doc.data();
      const nowMillis = clock.nowTimestamp().toMillis();
      const leaseExpiresMillis = current.reconciliationLeaseExpiresAt ? current.reconciliationLeaseExpiresAt.toMillis() : 0;
      const snapshotExpiresMillis = current.projectionSnapshotExpiresAt ? current.projectionSnapshotExpiresAt.toMillis() : 0;

      if (current.status !== "SUCCEEDED") return { valid: false, errorCode: "STATUS_NOT_SUCCEEDED" };
      if (current.reconciliationLeaseOwner !== currentReconcilerId) return { valid: false, errorCode: "LEASE_OWNER_MISMATCH" };
      if (current.reconciliationClaimVersion !== claimedVersion) return { valid: false, errorCode: "CLAIM_VERSION_MISMATCH" };
      if (leaseExpiresMillis <= nowMillis) return { valid: false, errorCode: "LEASE_EXPIRED" };
      if (!current.projectionSnapshot || snapshotExpiresMillis <= nowMillis) return { valid: false, errorCode: "SNAPSHOT_EXPIRED" };

      // PATCH 3 權威資料完整性重驗：
      // 1. attemptCount 必須為大於 0 之合法整數
      if (!Number.isInteger(current.attemptCount) || current.attemptCount <= 0) {
        return { valid: false, errorCode: "INVALID_ATTEMPT_COUNT", shouldMarkManualReview: true };
      }
      // 2. payloadHash 必須為 64 字元十六進位字串
      if (typeof current.payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(current.payloadHash)) {
        return { valid: false, errorCode: "INVALID_DOC_PAYLOAD_HASH", shouldMarkManualReview: true };
      }
      // 3. projectionKey 必須完全等於 "PROJECTION_" + operationId
      if (current.projectionKey !== `PROJECTION_${cleanOpId}`) {
        return { valid: false, errorCode: "PROJECTION_KEY_MISMATCH", shouldMarkManualReview: true };
      }
      // 4. projectionSnapshot 必須完整包含 6 項以上必要欄位
      const snap = current.projectionSnapshot;
      if (
        typeof snap !== "object" || snap === null ||
        typeof snap.storeId !== "string" || snap.storeId.trim() === "" ||
        typeof snap.productCode !== "string" || snap.productCode.trim() === "" ||
        typeof snap.occurredAt !== "string" || isNaN(Date.parse(snap.occurredAt)) ||
        typeof snap.payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(snap.payloadHash) ||
        typeof snap.reservationNumber !== "string" || snap.reservationNumber.trim() === "" ||
        typeof snap.eventType !== "string" || snap.eventType.trim() === "" ||
        typeof snap.pseudonymousActorId !== "string" || snap.pseudonymousActorId.trim() === ""
      ) {
        return { valid: false, errorCode: "CORRUPT_PROJECTION_SNAPSHOT", shouldMarkManualReview: true };
      }
      // 5. quantity 必須為大於 0 之有效整數
      if (!Number.isInteger(snap.quantity) || snap.quantity <= 0) {
        return { valid: false, errorCode: "INVALID_SNAPSHOT_QUANTITY", shouldMarkManualReview: true };
      }
      // 6. snapshot 內的 payloadHash 必須與 doc.payloadHash 完全一致
      if (snap.payloadHash !== current.payloadHash) {
        return { valid: false, errorCode: "SNAPSHOT_HASH_MISMATCH", shouldMarkManualReview: true };
      }

      return {
        valid: true,
        authoritativeData: {
          projectionKey: current.projectionKey,
          operationId: cleanOpId,
          projectionSnapshot: current.projectionSnapshot,
          payloadHash: current.payloadHash,
          attemptCount: current.attemptCount
        }
      };
    });

    if (!preWriteCheck.valid) {
      // 9. 驗證失敗：嚴禁執行 Sheet append
      // 若在持有租約情況下發現資料損毀，條件式標記 MANUAL_REVIEW_REQUIRED
      if (preWriteCheck.shouldMarkManualReview) {
        await markManualReviewUnderReconciliationLease(
          firestoreDb,
          cleanOpId,
          currentReconcilerId,
          claimedVersion,
          preWriteCheck.errorCode,
          clock
        );
        outcome = "MANUAL_REVIEW_REQUIRED";
      } else {
        outcome = "PRE_WRITE_CHECK_FAILED";
      }
      outcomeReason = preWriteCheck.errorCode;
      return { outcome, reason: outcomeReason };
    }

    // 執行重建並寫入試算表，必須使用 preWriteCheck 回傳之權威資料（嚴禁使用舊 authData）
    const auth = preWriteCheck.authoritativeData;
    const rebuildTimestampStr = clock.nowTimestamp().toDate().toISOString();
    const repairedRow = [
      auth.projectionKey,                                // 1. projectionKey (A)
      auth.operationId,                                  // 2. operationId (B)
      auth.projectionSnapshot.reservationNumber,         // 3. projectionSnapshot 欄位 (C)
      auth.projectionSnapshot.eventType,                 //    (D)
      auth.projectionSnapshot.storeId,                   //    (E)
      auth.projectionSnapshot.productCode,               //    (F)
      auth.projectionSnapshot.quantity,                  //    (G)
      auth.projectionSnapshot.pseudonymousActorId,       //    (H)
      auth.projectionSnapshot.occurredAt,                //    (I)
      rebuildTimestampStr,                               // 4. rebuildTimestamp (J)
      auth.attemptCount,                                 // 5. attemptCount 正整數 (K)
      auth.payloadHash                                   //    payloadHash (L)
    ];

    await sheetsClient.appendRow("PROJECTION_LOG", repairedRow);
    shouldUpdateLastReconciled = true;
    outcome = "REPAIRED";
    return { outcome };
  } finally {
    // 保證所有結束路徑（含 preWriteCheck 失敗、正常回傳或拋出錯誤）均嘗試條件式釋放租約
    // 釋放失敗不得覆蓋原始業務錯誤
    try {
      await releaseReconciliationLease(firestoreDb, cleanOpId, currentReconcilerId, claimedVersion, {
        updateLastReconciled: shouldUpdateLastReconciled,
        clock
      });
    } catch (releaseErr) {
      // 僅記錄，不掩蓋原業務結果
    }
  }
}
```

---

### Task 3: Retention Policy Engine with FakeClock (90d Snapshot & 400d Tombstone Pruning)
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/adapters/projection-reconciler-adapter.js`
  - Modify: `tests/simulations/stage-42-g5-projection-reconciler.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `allocation-assistant/adapters/projection-reconciler-adapter.js`: 實作 `pruneExpiredSnapshotsAndTombstones()`。
- **Consumes / Produces 介面**:
  - Consumes: Firestore Client, `Clock`。
  - Produces: 清理修剪結果（`purgedSnapshotCount`, `tombstonedCount`）。
- **精確函式名稱**:
  - `pruneExpiredSnapshotsAndTombstones(firestoreDb: object, clock: object): Promise<object>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試**
    撰寫測試：
    1. 使用 `fakeClock.advanceMillis(91 * 86400 * 1000)`（91 天），執行修剪，驗證 `projectionSnapshot` 欄位被刪除，但狀態與 `payloadHash` 完整保留。
    2. 使用 `fakeClock.advanceMillis(401 * 86400 * 1000)`（401 天），執行修剪，驗證文件被精簡為僅含 `operationId`, `projectionKey`, `completedAt`, `payloadHash` 之 Tombstone 結構。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因尚未實作修剪引擎失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作基於 Firestore Timestamp 之過期比對與批次修剪。
  - [ ] **Step 4: 執行並確認指定測試通過**
    確認 90 天快照清除與 400 天 Tombstone 修剪測試通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g5-projection-reconciler`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement snapshot expiration and tombstone pruning`

- **最小實作程式碼範例**:
```javascript
async function pruneExpiredSnapshotsAndTombstones(firestoreDb, clock) {
  const nowTs = clock.nowTimestamp();
  const nowMillis = nowTs.toMillis();
  const ms90Days = 90 * 86400 * 1000;
  const ms400Days = 400 * 86400 * 1000;

  const snapshot = await firestoreDb.collection("projectionOperations")
    .where("status", "==", "SUCCEEDED")
    .get();

  let purgedSnapshotCount = 0;
  let tombstonedCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data.completedAt) continue;

    const completedMillis = data.completedAt.toMillis();
    const ageMillis = nowMillis - completedMillis;

    if (ageMillis >= ms400Days) {
      // 400 天：最小化為 Tombstone
      await doc.ref.set({
        operationId: data.operationId,
        projectionKey: data.projectionKey,
        completedAt: data.completedAt,
        payloadHash: data.payloadHash,
        status: "TOMBSTONE"
      });
      tombstonedCount += 1;
    } else if (ageMillis >= ms90Days && data.projectionSnapshot) {
      // 90 天：清除 projectionSnapshot
      await doc.ref.update({
        projectionSnapshot: require("firebase-admin").firestore.FieldValue.delete(),
        projectionSnapshotExpiresAt: null
      });
      purgedSnapshotCount += 1;
    }
  }

  return { purgedSnapshotCount, tombstonedCount };
}
```

- **Test Registry Export 規範 (`tests/simulations/stage-42-g5-projection-reconciler.sim.js`)**:
```javascript
module.exports = {
  tests: [
    {
      id: "TC-13",
      name: "Projection Reconciler detects missing sheet row and rebuilds from projectionSnapshot",
      run: testProjectionReconcilerRowReconstruction
    }
  ]
};
```
