# Stage 42-G4 DLQ Reconciler & Dead-Letter Handling Implementation Plan

> For agentic workers:
> REQUIRED SUB-SKILL: use executing-plans or an equivalent task-by-task execution workflow. Do not implement tasks in parallel when they modify shared event schemas or Firestore state contracts.
>
> **Status**: `IMPLEMENTED & ALERT FINALIZATION/REDELIVERY HARDENED — AWAITING OWNER REVIEW`<br>
> **Authority**: In accordance with Owner Authorization Tokens `OWNER AUTHORIZATION — STAGE 42-G4 DLQ RECONCILER LOCAL TDD IMPLEMENTATION`, `OWNER AUTHORIZATION — STAGE 42-G4 FAIL-CLOSED CORRECTION`, `OWNER AUTHORIZATION — STAGE 42-G4 ANOMALY ALERT CONTRACT CORRECTION`, and `OWNER AUTHORIZATION — STAGE 42-G4 ALERT FINALIZATION AND REDELIVERY CORRECTION`<br>
> **Implementation Authorization**: G1–G3 committed and pushed; G4 local TDD implemented and hardened (awaiting owner review/commit); G5–G6 `NOT AUTHORIZED`<br>
> **Next Step**: `Owner reviews completed Stage 42-G4 implementation and hardening before commit authorization.`<br>

Goal:
實作獨立的 DLQ Reconciler 服務，解析死信佇列 Eventarc CloudEvent 訊息，在實際收到 DLQ 訊息時將對應的 `projectionOperations` 原子標記為 `DEAD_LETTERED`（同時落實 SUCCEEDED / MANUAL_REVIEW_REQUIRED / DEAD_LETTERED 終態保護、重複訊息冪等防護、Fencing 清除租約），並於 Firestore Transaction 成功 Commit 後，透過具備確定性去重金鑰（Deterministic Idempotency Key）之告警配接器派發結構化脫敏警報。

Architecture:
依據 Stage 42-F 第 6 章、第 11 章、第 14 章規範及 Erratum 1：
1. **傳輸契約解包**：外層接收 Eventarc Pub/Sub CloudEvent（嚴格校驗 `cloudEvent.type === "google.cloud.pubsub.topic.v1.messagePublished"`），內層 Base64 解碼重用 Stage 42-G1 `unpackTransportCloudEvent` 規範（強制使用 Fatal UTF-8 解碼器與 Base64 嚴格字符集校驗），還原為標準 Application Projection Event Envelope。
2. **死信政策與計數語意**：
   - 宣告式 Dead-Letter Policy `maxDeliveryAttempts === 5` 僅作為基礎設施宣告校驗。Pub/Sub 的 delivery attempt 屬分散式近似計數，**絕對嚴禁**將其視為精確第 5 次的業務條件。
   - 若訊息缺少 `deliveryAttempt` 屬性，解析器產出 `deliveryAttempt: null`，**絕對嚴禁**假定或硬編碼填補為 5。
   - 轉移為 `DEAD_LETTERED` 之唯一前置條件為「**實際自 DLQ Subscription 收到訊息**」，絕不依賴本地推測。
3. **終態保護與狀態轉移矩陣**：
   - 若單據當前狀態為 `SUCCEEDED`（例如先前的 Worker 重試已成功寫入 Sheet），**嚴禁降級**為 `DEAD_LETTERED`；必須保持 `SUCCEEDED`，記錄稽核並回傳固定 ACK（HTTP 200）。
   - 若單據當前狀態為 `MANUAL_REVIEW_REQUIRED`，**嚴禁覆蓋**；保留手動審查終態，回傳固定 ACK。
   - 若單據已為 `DEAD_LETTERED` 且告警已發送完成，**冪等跳過**，0 狀態變更、0 時間戳更動、0 重複告警，回傳固定 ACK。
   - 若單據為 `PROCESSING`，合法轉移至 `DEAD_LETTERED` 並原子清除 `leaseOwner` 與 `leaseExpiresAt`，使舊 Worker 在寫入 Sheet 前之權威租約檢查安全 Fail-Closed。
   - 若單據不存在（Orphan DLQ Message），**嚴禁建立**新的業務文件；記錄脫敏孤立日誌並回傳固定 ACK 阻絕無效重試迴圈。
4. **二階段交易與告警冪等性**：
   - **Phase A (State Transition)**：在 Firestore `runTransaction` 內權威重新讀取並驗證，狀態轉移成功時原子寫入 `deadLetterAlertStatus: "PENDING"` 與基於 SHA-256 產生的確定性 `deadLetterAlertIdempotencyKey`。嚴禁在交易回呼內呼叫外部告警 API。
   - **Phase B (Alert Dispatch)**：交易成功 Commit 後派發脫敏告警。告警成功後以獨立交易將 `deadLetterAlertStatus` 更新為 `"SENT"` 並標記 `deadLetterAlertSentAt`。若告警失敗保持 `"PENDING"`，由重試機制以相同 Idempotency Key 補發。Fake Alerting Adapter 依 Key 進行記憶體去重，保證至多發出一次可觀察告警。
5. **Fail-Closed 模擬器環境守衛**：
   - 測試模組載入前強制驗證 `FIRESTORE_EMULATOR_HOST`（必須為 `127.0.0.1:<port>` 或 `localhost:<port>`，禁止 URL scheme）、`GCLOUD_PROJECT` 與 `GOOGLE_CLOUD_PROJECT`（必須獨立比對且嚴格等於 `demo-jy-stage42-g4`，嚴禁 `||` shadowing）。

Tech Stack:
- 執行環境：Node.js 20+ (CommonJS 模組系統)
- 模擬器與資料庫：Firestore Emulator (`127.0.0.1:8080`), `firebase-admin ^14.3.0`
- Demo Project ID: `demo-jy-stage42-g4`
- 核心依賴（唯讀重用）：`allocation-assistant/contracts/projection-contract.js` (`unpackTransportCloudEvent`, `validateCanonicalPayload`, `sanitizeLogEntry`, `createProductionClock`, `createFakeClock`)
- 告警介面：`FakeAlertingAdapter`（基於 Map 之確定性去重記憶體告警配接器，0 外部網路呼叫）
- 測試套件：Node.js 原生 `assert` 輕量化模擬測試

Spec:
docs/stages/stage-42-f-formal-projection-worker-architecture-spec.md (含 Erratum 1)

Global Constraints:
1. 嚴格禁止直接對 `rawDlqMessage.data` 做寬鬆 `Buffer.from(..., "base64").toString("utf8")` 或 `JSON.parse`；必須使用 G1 `unpackTransportCloudEvent` 進行嚴格雙層解包與 Fatal UTF-8 驗證。
2. 嚴格禁止在未實際收到 DLQ 訊息前，因預測重試次數達到 5 次而預先將狀態更新為 `DEAD_LETTERED`。
3. 嚴格禁止在單據為 `SUCCEEDED` 或 `MANUAL_REVIEW_REQUIRED` 終態時覆蓋其狀態。
4. 嚴格禁止在 Firestore 交易回呼（Transaction Callback）內部呼叫外部 Alert API、Pub/Sub 或 Sheets API。
5. 嚴格禁止在重複 delivery 時更新 `deadLetteredAt` 時間戳記。
6. 發送至告警配接器之內容與儲存於 Firestore 之錯誤必須經由 `sanitizeLogEntry` 完成 PII 與敏感資料脫敏，嚴禁輸出 Token、密鑰、Email 或 LINE User ID。
7. 嚴禁建立實體 GCP Pub/Sub Topic、Subscription、Eventarc Trigger、Cloud Run 或 Cloud Scheduler 資源。
8. 嚴禁存取真實 Google Sheets 或正式 Firestore，嚴禁呼叫 LINE Messaging API。
9. 嚴禁實作 Stage 42-G5 Projection Reconciler，嚴禁實作 Stage 42-G6 或 Stage 42-H 部署。

Review Focus:
1. TC-10：本機宣告式 Dead-Letter Policy 是否精確校驗為 5 次，解析器在缺失 `deliveryAttempt` 時是否安全記錄 `null`。
2. TC-11：當且僅當實際收到合法 DLQ 訊息時，是否確實將 `projectionOperations` 一次性原子更新為 `DEAD_LETTERED`、記錄原因並觸發脫敏告警。
3. 終態保護：單據若已為 `SUCCEEDED` 或 `MANUAL_REVIEW_REQUIRED`，是否保證 0 狀態更動、0 降級並固定回傳 ACK。
4. 冪等性：重複 DLQ delivery 是否保證 0 狀態更動、0 時間戳變更、0 重複告警，並回傳固定 ACK。
5. 告警邊界：告警派發是否嚴格在 Transaction Commit 後執行，且具備確定性 `idempotencyKey` 去重。
6. 安全守衛：是否獨立校驗 `GCLOUD_PROJECT` 與 `GOOGLE_CLOUD_PROJECT` 為 `demo-jy-stage42-g4`，若缺失或非 local emulator 即立即 Fail-Closed。

---

## 1. 輸入與傳輸契約 (Input & Transport Contract)

DLQ Reconciler 透過 Eventarc 接收 CloudEvent。其格式與解包流程嚴格遵守 Stage 42-G1 標準：

```
[Eventarc CloudEvent 1.0 (google.cloud.pubsub.topic.v1.messagePublished)]
  │  嚴格檢查:
  │  - cloudEvent.type === "google.cloud.pubsub.topic.v1.messagePublished"
  │  - cloudEvent.data.message.data (Base64 regex /^[A-Za-z0-9+/]+={0,2}$/)
  │  - Fatal UTF-8 解碼器 (拒絕 invalid byte sequence)
  ▼
[Stage 42-G1 Application Projection Event Envelope]
  │  嚴格檢查:
  │  - schemaVersion === "1.0.0"
  │  - eventType 列舉合法性 ("HOLD_CREATED" | "HOLD_FULFILLED" | "HOLD_CANCELLED" | "HOLD_RECONCILED")
  │  - operationId / eventId / projectionKey / traceId / occurredAt 齊全且非空
  │  - payload 僅允許 { storeId, productCode, quantity (正整數) }
  │  - payloadHash 符合 64 碼小寫十六進位 SHA-256 雜湊
  │  - operator 脫敏 (僅允許 pseudonymousActorId)
  ▼
[DLQ Context 物件]
  - operationId: envelope.operationId
  - eventId: envelope.eventId
  - payloadHash: envelope.payloadHash
  - messageId: cloudEvent.data.message.messageId || "unknown_msg"
  - deliveryAttempt: 正整數 (如 5) 或 null (缺失時嚴禁填 5)
```

---

## 2. 狀態轉移矩陣 (Owner-Approved State Transition Matrix)

| Current State / Condition | Required Result | Firestore Mutation | Handler ACK |
|---|---|---|:---:|
| **PENDING** + valid matching DLQ event | `DEAD_LETTERED` | 一次性原子轉移，寫入 `deadLetterAlertStatus: "PENDING"` | `true` (HTTP 200) |
| **PROCESSING** + valid matching DLQ event | `DEAD_LETTERED` | 一次性原子轉移，清除 `leaseOwner` / `leaseExpiresAt`，保留 `claimVersion` 稽核值 | `true` (HTTP 200) |
| **RETRYABLE_FAILED** + valid matching DLQ event | `DEAD_LETTERED` | 一次性原子轉移，寫入 `deadLetterAlertStatus: "PENDING"` | `true` (HTTP 200) |
| **SUCCEEDED** + valid matching identity | `IGNORE_SUCCEEDED` | **0 mutation，不得降級**，記錄重複舊死信稽核 | `true` (HTTP 200) |
| **SUCCEEDED** + identity/hash mismatch | `PRESERVE_TERMINAL_STATE` | **0 mutation**，保持原終態，派發脫敏異常告警（需確定性去重金鑰） | `true` (HTTP 200) |
| **MANUAL_REVIEW_REQUIRED** + valid matching identity | `IGNORE_MANUAL_REVIEW` | **0 mutation，不得覆蓋**，保留手動審查終態 | `true` (HTTP 200) |
| **MANUAL_REVIEW_REQUIRED** + identity/hash mismatch | `PRESERVE_TERMINAL_STATE` | **0 mutation**，保持原終態，派發脫敏異常告警（需確定性去重金鑰） | `true` (HTTP 200) |
| **DEAD_LETTERED** + same identity | `ALREADY_DEAD_LETTERED` | **0 狀態及時間戳更新**（保留首次 `deadLetteredAt`） | `true` (HTTP 200) |
| **DEAD_LETTERED** + identity/hash mismatch | `PRESERVE_TERMINAL_STATE` | **0 mutation**，絕不視為重複死信，派發脫敏異常告警（需確定性去重金鑰） | `true` (HTTP 200) |
| **operation not found** | `ORPHAN_DLQ_MESSAGE` | **不得建立 `projectionOperations` 文件**；派發脫敏孤立告警，告警失敗/缺失 client 需 NACK | `true` (HTTP 200) |
| **active-state identity mismatch** | `MANUAL_REVIEW_REQUIRED` | 標記為異常，不覆蓋 payload / snapshot，清除有效租約，派發確定性異常告警 | `true` (HTTP 200) |
| **active-state payloadHash mismatch** | `MANUAL_REVIEW_REQUIRED` | 標記為異常，不覆蓋 payload / snapshot，清除有效租約，派發確定性異常告警 | `true` (HTTP 200) |
| **corrupt / unknown status** | `CORRUPT_OR_UNKNOWN_STATUS_REJECTED` | **0 operation mutation**，拒絕轉入 DEAD_LETTERED，派發確定性異常告警 | `true` (HTTP 200) |
| **malformed CloudEvent / Base64 / UTF-8 / schema** | `REJECT_POISON_MESSAGE` | **0 operation mutation**，安全記錄脫敏毒訊息日誌，回傳固定 ACK 阻絕重發；不派發業務告警 | `true` (HTTP 200) |
| **transient Firestore failure before durable decision** | `RETRY` | 0 未完成狀態假冒，拋出例外回傳 500 NACK | `false` (HTTP 500) |
| **alert dispatch transient failure after durable transition** | `RETRY_ALERT` | operation 狀態維持已提交結果 (`DEAD_LETTERED`)，alert 保持 `PENDING` | `false` (HTTP 500) |

### 關鍵語意說明：
1. **終態身分優先校驗**：在回傳一般的終態忽略（`IGNORE_SUCCEEDED` / `IGNORE_MANUAL_REVIEW` / `ALREADY_DEAD_LETTERED`）之前，必須先完整校驗權威身分（`operationId`、`eventId`、`payloadHash`）。若身分缺失或不符，一律轉為 `PRESERVE_TERMINAL_STATE`，維持 0 異動並派發異常告警。
2. **所有 needAlert=true 皆具備確定性去重金鑰**：除個別處理的 ORPHAN 路徑外，凡回傳 `needAlert: true` 之結果（包含 Active 身分不符、未知/毀損狀態、終態身分不符等）均必須包含由 `operationId` + `eventId` + `reasonCode` 雜湊衍生之 64 碼小寫十六進位 SHA-256 確定性去重金鑰。
3. **異常告警由配接器權威去重**：受保護的終態與損壞文件刻意保持 0 異動（禁止在文件內寫入任何 alert bookkeeping 欄位），其告警去重由 FakeAlertingAdapter 在記憶體/外部層級依據確定性去重金鑰權威保證。
4. **缺失金鑰 Fail-Closed 守衛**：`dispatchPendingDeadLetterAlert` 嚴禁因 `idempotencyKey` 缺失而靜默略過；凡 `needAlert: true` 但缺失金鑰者，強制回傳 `ack: false` 與 `alertAction: "RETRY_ALERT"`，確保異常不被吞沒。
5. **ACK 的意義**：Handler 對不可重試錯誤（毒訊息、格式錯誤、不一致）、已完成處理的重複訊息或終態保護訊息回傳 ACK（HTTP 200），阻絕 Pub/Sub 產生無限無效重發。毒訊息（Poison Message）因無法取得可靠的結構化業務身分（operationId/eventId），契約明定：0 業務狀態異動、安全記錄脫敏日誌並回傳固定 ACK；若需要全域系統級監控，應由傳輸基礎設施層級處置，業務 Reconciler 絕不對毒訊息偽造業務身分或派發無效告警。
6. **NACK / Retry 的意義**：適用於真正的基礎設施暫時性錯誤（如 Firestore 連線中斷、交易衝突超出重試上限、或已轉入 DEAD_LETTERED 但告警/SENT-finalization 失敗需重試者）。
3. **終態不可逆性**：任何已達 `SUCCEEDED` 或 `MANUAL_REVIEW_REQUIRED` 的單據，絕對不允許因延遲抵達的死信訊息而被改寫為 `DEAD_LETTERED`。
4. **Fencing 協同**：當 `PROCESSING` 被 DLQ Reconciler 改寫為 `DEAD_LETTERED` 並清除租約後，原本執行中的 Worker 在呼叫 Sheet 前或完成結案時，將因 Firestore 權威狀態已非 `PROCESSING` 而被 Fencing 機制安全拒絕（Fail-Closed）。

---

## 3. 告警派發與冪等性契約 (Alert Delivery & Idempotency Contract)

為防止交易重試或 Pub/Sub 重新投遞導致重複發送外部告警，實作嚴格的兩階段狀態追蹤：

```
[DLQ Message Received]
         │
         ▼
[Phase A: Firestore Transaction]
  - 驗證單據狀態與身份
  - 狀態轉移至 DEAD_LETTERED
  - 產生確定性 idempotencyKey:
      SHA256("JY_ALERT_IDEMPOTENCY:v1:" + operationId + ":" + eventId + ":" + reasonCode)
  - 寫入 deadLetterAlertStatus = "PENDING"
  - 寫入 deadLetterAlertIdempotencyKey
  - Commit Transaction
         │ (Transaction 成功提交後才執行下一步)
         ▼
[Phase B: Alert Dispatch]
  - 呼叫 FakeAlertingAdapter.sendAlert({
      idempotencyKey,
      severity: "P1",
      operationId,
      eventId,
      reason: sanitizeLogEntry(reason)
    })
  - 若 FakeAlertingAdapter 偵測到相同 idempotencyKey，自動去重 (dedup: true, sent: false)
         │
         ├── 成功 ──> [Phase C: Mark Alert Sent Transaction]
         │             - 獨立交易更新 deadLetterAlertStatus = "SENT"
         │             - 記錄 deadLetterAlertSentAt = clock.nowTimestamp()
         │             - 回傳 { ack: true, action: "DEAD_LETTERED_ALERT_SENT" }
         │
         └── 失敗 ──> [Phase C-Fail: Return Retry]
                       - deadLetterAlertStatus 維持 "PENDING"
                       - 回傳 { ack: false, action: "RETRY_ALERT" } (由 Pub/Sub 依退避重試)
```

- **正式語意**：
  - Firestore 狀態轉移：**Idempotent**（重複訊息 0 次改寫）。
  - 告警派發：**At-least-once attempt with deterministic adapter-level deduplication**（在配接器層級依 SHA-256 金鑰確定性去重）。

---

## 4. Firestore Emulator 安全守衛契約 (Fail-Closed Contract)

G4 測試執行前必須嚴格校驗環境變數，防止任何測試連線逃逸至真實 GCP 專案：

```javascript
const G4_DEMO_PROJECT_ID = "demo-jy-stage42-g4";

function validateEmulatorHost(host) {
  if (!host || typeof host !== "string" || host.trim() === "") {
    throw new Error("FAIL_CLOSED_EMULATOR_GUARD: FIRESTORE_EMULATOR_HOST environment variable is missing or empty.");
  }
  const trimmed = host.trim();
  if (trimmed.includes("://")) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: FIRESTORE_EMULATOR_HOST must not contain a URL scheme (${trimmed}).`);
  }
  const [hostname, portStr] = trimmed.split(":");
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: Host must be local (127.0.0.1 or localhost), got: ${hostname}`);
  }
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: Invalid port: ${portStr}`);
  }
  return trimmed;
}

function validateProjectId(gcloudProject, googleCloudProject) {
  if (!gcloudProject && !googleCloudProject) {
    throw new Error("FAIL_CLOSED_EMULATOR_GUARD: Missing project environment variables.");
  }
  if (gcloudProject && gcloudProject !== G4_DEMO_PROJECT_ID) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: GCLOUD_PROJECT must be '${G4_DEMO_PROJECT_ID}', got '${gcloudProject}'`);
  }
  if (googleCloudProject && googleCloudProject !== G4_DEMO_PROJECT_ID) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: GOOGLE_CLOUD_PROJECT must be '${G4_DEMO_PROJECT_ID}', got '${googleCloudProject}'`);
  }
  if (gcloudProject && googleCloudProject && gcloudProject !== googleCloudProject) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: GCLOUD_PROJECT ('${gcloudProject}') and GOOGLE_CLOUD_PROJECT ('${googleCloudProject}') mismatch.`);
  }
  return G4_DEMO_PROJECT_ID;
}
```

- **執行時機**：在初始化 Firebase Admin Client 或發起任何網路 Socket 連線之前強制執行。
- **資料隔離**：測試清理作業僅清空 `demo-jy-stage42-g4` 之 Emulator 資料庫。

---

## 5. Tasks (TDD 實作任務拆分)

### Task 1: DLQ Transport Message Unpacker & Policy Validator (TC-10, G4-U01 ~ G4-U04)
- **Create / Modify / Test 路徑**:
  - Create: `allocation-assistant/adapters/dlq-reconciler-adapter.js`
  - Create: `tests/simulations/stage-42-g4-dlq-reconciler.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `package.json`: 註冊 `simulate:stage-42-g4-dlq-reconciler` 測試腳本。
- **Consumes / Produces 介面**:
  - Consumes: Eventarc Pub/Sub CloudEvent, 死信政策物件。
  - Produces: 標準化死信資料結構（`operationId`, `eventId`, `deliveryAttempt`, `messageId`, `envelope`）。
- **精確函式名稱**:
  - `validateDeadLetterPolicy(policy: object): { valid: boolean, maxAttempts: number }`
  - `parseDlqCloudEvent(cloudEvent: object): object`
- **安全實作規範**:
  - 重用 G1 `unpackTransportCloudEvent`，強制 Fatal UTF-8 與 Base64 驗證。
  - 缺失 `deliveryAttempt` 時產出 `null`，嚴禁填寫為 5。
  - 毒訊息（Malformed CloudEvent / Base64）拋出標準錯誤 `REJECT_POISON_MESSAGE`。

### Task 2: Firestore Transactional Reconciler with Terminal State Protection (TC-11, G4-U05 ~ G4-U12)
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/adapters/dlq-reconciler-adapter.js`
  - Modify: `tests/simulations/stage-42-g4-dlq-reconciler.sim.js`
- **Consumes / Produces 介面**:
  - Consumes: Firestore Client, 已解析之 DLQ 訊息物件, `Clock`。
  - Produces: 轉移決策物件（`action: string, status: string, needAlert: boolean, idempotencyKey: string`）。
- **精確函式名稱**:
  - `reconcileDeadLetterDelivery(db: object, parsedDlqMsg: object, clock: object): Promise<object>`
- **安全實作規範**:
  - 在 `db.runTransaction` 內重新讀取權威文件。
  - 若狀態為 `SUCCEEDED` -> 回傳 `{ action: 'IGNORE_SUCCEEDED', ack: true }`，0 寫入。
  - 若狀態為 `MANUAL_REVIEW_REQUIRED` -> 回傳 `{ action: 'IGNORE_MANUAL_REVIEW', ack: true }`，0 寫入。
  - 若狀態為 `DEAD_LETTERED` 且已有記錄 -> 回傳 `{ action: 'ALREADY_DEAD_LETTERED', ack: true }`，0 寫入。
  - 若文件不存在 -> 回傳 `{ action: 'ORPHAN_DLQ_MESSAGE', ack: true }`，嚴禁建立業務文件。
  - 合法轉移（PENDING / PROCESSING / RETRYABLE_FAILED）：寫入 `status: "DEAD_LETTERED"`, `deadLetteredAt: nowTs`, `deadLetterAlertStatus: "PENDING"`, `deadLetterAlertIdempotencyKey`，清除租約欄位。
  - 嚴禁在交易回呼內呼叫外部 Alert API。

### Task 3: Idempotent Alerting Adapter & Notification Dispatcher (G4-U13 ~ G4-U17)
- **Create / Modify / Test 路徑**:
  - Create: `tests/mocks/fake-alerting-adapter.js`
  - Modify: `allocation-assistant/adapters/dlq-reconciler-adapter.js`
  - Modify: `tests/simulations/stage-42-g4-dlq-reconciler.sim.js`
- **Consumes / Produces 介面**:
  - Consumes: Firestore Client, Alerting Client, 轉移決策物件, `Clock`。
  - Produces: 告警派發結果（`sent: boolean, dedup: boolean, ack: boolean`）。
- **精確函式名稱**:
  - `dispatchPendingDeadLetterAlert(db: object, alertingClient: object, claimContext: object, clock: object): Promise<object>`
  - `handleDeadLetterCloudEvent(db: object, alertingClient: object, cloudEvent: object, clock: object): Promise<object>`
- **安全實作規範**:
  - `FakeAlertingAdapter` 實作基於 Map 之記憶體去重機制，依據 `idempotencyKey` 去除重複告警。
  - 告警內容經 `sanitizeLogEntry` 脫敏，絕無 Token 或敏感個資。
  - 成功派發後在獨立交易中將單據之 `deadLetterAlertStatus` 更新為 `"SENT"`。
  - 整合 Handler `handleDeadLetterCloudEvent` 統一輸出 `{ action, ack, operationId, eventId, alertAction, reasonCode }`。

---

## 6. 完整測試案例清單 (Test Plan Matrix)

包含 **43 項實際模擬測試案例**（含 2 項 Acceptance Test IDs 與 41 項單元/整合案例，已全數通過）：

1. **TC-10**: Pub/Sub approximate 5 delivery attempts routes message to DLQ subscription (宣告式政策驗證與 parser 缺失 deliveryAttempt 產出 null)
2. **TC-11**: DLQ Reconciler updates projectionOperations to DEAD_LETTERED on actual receipt (實際收到 DLQ 訊息一次性原子轉移為 DEAD_LETTERED 並派發告警)
3. **G4-U01**: Outer Eventarc CloudEvent type 不是 `google.cloud.pubsub.topic.v1.messagePublished` 時安全 Fail-Closed
4. **G4-U02**: Inner Base64 含有非法字元或非合法 UTF-8 位元組序列時安全拒絕並回傳 ACK
5. **G4-U03**: Application Envelope schemaVersion 不合法或欄位缺失時標記 `REJECT_POISON_MESSAGE`
6. **G4-U04**: 合法整數 deliveryAttempt (如 5) 正確解析保留
7. **G4-U05**: 單據處於 `PENDING` 狀態時收到 DLQ delivery 成功轉移至 `DEAD_LETTERED`
8. **G4-U06**: 單據處於 `PROCESSING` 狀態時收到 DLQ delivery 轉移至 `DEAD_LETTERED` 且清除租約，舊 Worker 結案被 Fencing 拒絕
9. **G4-U07**: 單據處於 `SUCCEEDED` 狀態時收到 DLQ delivery 嚴禁降級，保持 `SUCCEEDED` 且回傳固定 ACK
10. **G4-U08**: 單據處於 `MANUAL_REVIEW_REQUIRED` 狀態時收到 DLQ delivery 嚴禁覆蓋，保持原態且回傳固定 ACK
11. **G4-U09**: 重複收到相同 DLQ delivery 執行冪等判定，0 狀態變更、0 時間戳變更、0 重複告警
12. **G4-U10**: 查詢不存在之 `operationId` 判定為 `ORPHAN_DLQ_MESSAGE`，嚴禁自動建立業務單據
13. **G4-U11**: `operationId` 存在但 `payloadHash` 與現有單據不符時標記手動審查，不覆蓋既有單據
14. **G4-U12**: 兩個併發 DLQ 訊息處理同一單據時，Firestore 交易保證至多一個狀態轉移 Winner
15. **G4-U13**: 告警內容經 `sanitizeLogEntry` 脫敏，驗證無 Email、LINE ID、Token 或敏感堆疊
16. **G4-U14**: 告警暫時失敗時單據維持 `deadLetterAlertStatus: "PENDING"`，重試時使用相同 `idempotencyKey`
17. **G4-U15**: Fake Alerting Adapter 依 `idempotencyKey` 去重，相同 Key 不產生第二筆可觀察告警
18. **G4-U16**: 模擬器環境變數守衛校驗（缺少 Host、非 Local Host、衝突專案 ID）立即 Fail-Closed
19. **G4-U17** ~ **G4-U39**: 權威身分校驗、狀態白名單、告警結案與 Active Mismatch 重試派發穩定性回歸測試
20. **G4-U40**: 異常訊息 Payload Identity 去重與內容衝突分離（同 eventId 且同 payloadHash 去重；同 eventId 不同 payloadHash 派發獨立內容衝突告警；第二種 payloadHash 重送去重；不同 eventId 正確區分；終態文件 0 mutation）
21. **G4-U41**: 舊文件缺少異常 payloadHash 保守處理與告警暫時失敗重試 key 穩定性檢驗

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

---

## 7. 未來實作授權邊界 (Implementation File Boundary)

未來 Stage 42-G4 實作授權之 **最大 Repository 檔案數嚴格限制為 9 個**：
1. `allocation-assistant/adapters/dlq-reconciler-adapter.js` (新增)
2. `tests/mocks/fake-alerting-adapter.js` (新增)
3. `tests/simulations/stage-42-g4-dlq-reconciler.sim.js` (新增)
4. `package.json` (修改：註冊測試腳本)
5. `docs/superpowers/plans/2026-09-24-stage-42-g4-dlq-reconciler.md` (修改：標註實作進度)
6. `docs/superpowers/plans/2026-09-24-stage-42-g-master-plan.md` (修改：推進 G4 狀態)
7. `PROJECT_MEMORY.md` (修改：推進 G4 狀態)
8. `docs/stages/CURRENT_HANDOFF.md` (修改：記錄 G4 交付)
9. `docs/allocation-assistant/CURRENT_HANDOFF.md` (修改：記錄 G4 交付)

- **唯讀依賴清單**：
  - `allocation-assistant/contracts/projection-contract.js`
  - `allocation-assistant/services/projection-worker-service.js`
  - `allocation-assistant/adapters/outbox-publisher-adapter.js`
  - `package-lock.json`（嚴禁變動）
  - G1–G3 既有模擬測試檔案
