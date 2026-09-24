# Stage 42-F: Formal Projection Worker Architecture Specification

> **Status**: `APPROVED — STAGE 42-G IMPLEMENTATION NOT STARTED`<br>
> **Target Release / Gate**: Stage 42-F Formal Projection Worker Architecture Specification (Owner Approved)<br>
> **Author**: Antigravity (Canonical Checkout)<br>
> **Baseline Commit**: `59d892678bdbe9b103574903907fd167f86cce14`<br>
> **Authority**: In accordance with Owner Authorization Token `OWNER FINAL APPROVAL — STAGE 42-F SPECIFICATION COMMIT AND PUSH`<br>
> **Date**: 2026-09-24
>
> [!IMPORTANT]
> **正式核准聲明 (Formal Approval Declaration)**：
> - 本 Stage 42-F 架構規格書已獲專案 Owner 正式核准。
> - 本核准**嚴格不等於**授權建立 GCP 資源或部署。
> - 下一階段工作僅限於 **Stage 42-G 測試先行實作計畫 (TDD Implementation Plan)**，且須待 Owner 獨立授權後方可展開。

---

## 1. 目的與非目標 (Purpose & Non-Goals)

### 1.1 目的 (Purpose)
本規格書旨在為「勁揚業務管家」設計正式的非同步投影處理器（Projection Worker）架構藍圖。核心目標是在 **高併發 Firestore ACID 預約交易** 與 **營運後台 Google 試算表（Google Sheets）** 之間建立一條具備 **強隔離、最終一致性（Eventual Consistency）、有效一次投影結果（Effectively-Once Projection Outcome）、錯誤補償（DLQ & Reconciliation）與最小權限（IAM Least Privilege）** 的可靠非同步投影管線。

### 1.2 非目標 (Non-Goals)
- **非同步寫入正式營運表**：本架構在未經 Stage 42-H 完整驗證前，**嚴禁** 直接向正式營運配貨試算表寫入任何資料。
- **分散式即時強一致性**：本架構不追求 Firestore 與 Google Sheet 的雙向兩階段鎖定（2PC）或分散式同步阻塞，任何 Google Sheet 網路抖動或 API 配額限制均不得阻塞前台預約核心交易。
- **本階段非程式實作**：Stage 42-F 僅限於架構規格與治理文件制定，不建立任何實體 GCP 資源、不部署 Cloud Run function、不修改正式 Google Sheet。

---

## 2. 現有 Stage 42-E 基準 (Existing Stage 42-E Baseline)

1. **核心儲存庫狀態**：
   - Canonical 路徑：`/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
   - 分支：`main`，HEAD: `59d892678bdbe9b103574903907fd167f86cce14`
   - 全量測試套件：59 套件、479 案例 100% PASS。
2. **Stage 42-D 交易基準**：
   - 本機 Firestore Real Emulator ACID 交易（`tests/simulations/firestore-emulator-acid-transaction.sim.js`，7/7 PASS）證實單次預約交易能原子更新 5 大 Collection。
3. **Stage 42-E Phase 1 & 2 邊界成果**：
   - 本機測試 Harness（`tests/simulations/projection-worker-contract.sim.js`，7/7 PASS）已鎖定：
     - 投影鍵值規範：`PROJECTION_${operationId}`
     - 失敗隔離：Google Sheet 投影失敗絕不回滾已提交的 Firestore 交易。
     - 呼叫端身分防護：非授權 Caller 阻擋為 `UNAUTHORIZED_WORKER`，產生 0 次 Sheet 寫入。
   - 審查判定：正式 Projection Worker **未實作 (NOT IMPLEMENTED)**，生產準備度 **未核准 (NOT APPROVED)**。

---

## 3. 架構元件與責任 (Architectural Components & Responsibilities)

系統架構拓撲如下：

```
[Client / LINE Bot]
       │
       ▼ (1. ACID Reservation Transaction)
┌────────────────────────────────────────────────────────┐
│ Firestore Database                                     │
│  - holds / inventory / operationLedger / auditLogs     │
│  - projectionOutbox/{operationId} (Atomic in TX)       │
└───────────────────────┬────────────────────────────────┘
                        │ (2. Document-Created Event)
                        ▼
┌────────────────────────────────────────────────────────┐
│ Eventarc Trigger (Firestore Document Created)          │
│ Identity: sa-eventarc-firestore-trigger@...            │
└───────────────────────┬────────────────────────────────┘
                        │ (3. HTTP Push with OIDC Token)
                        ▼
┌────────────────────────────────────────────────────────┐
│ Cloud Run function Outbox Publisher                    │
│ Identity: sa-outbox-pub@...                            │
│  - Claim Lease (publisherLeaseOwner, publishAttemptId) │
│  - Publish to Pub/Sub (jy-reservation-events)          │
│  - Mark PUBLISHED with publishedMessageId              │
└───────────────────────┬────────────────────────────────┘
                        │ (4. Pub/Sub Message)
                        ▼
┌────────────────────────────────────────────────────────┐
│ Google Cloud Pub/Sub Topic: jy-reservation-events      │
│  - Subscription: jy-reservation-events-sub             │
│  - Dead-Letter Topic: jy-reservation-events-dlq        │
└───────────────────────┬────────────────────────────────┘
                        │ (5. Transport CloudEvent: messagePublished)
                        ▼
┌────────────────────────────────────────────────────────┐
│ Eventarc Trigger (Pub/Sub messagePublished)            │
│ Identity: sa-eventarc-pubsub-trigger@...               │
└───────────────────────┬────────────────────────────────┘
                        │ (6. HTTP Push with OIDC Token)
                        ▼
┌────────────────────────────────────────────────────────┐
│ Cloud Run function Projection Worker                   │
│ Identity: sa-proj-worker@...                           │
│ Config: max-instances=1, concurrency=1, timeout=120s   │
│  - Unpack Pub/Sub CloudEvent -> Base64 decode Data     │
│  - Claim Lease (180s) in projectionOperations          │
│  - Re-verify Lease before Google Sheets API call       │
│  - Search-and-Append to Audit Sheet (PROJECTION_LOG)   │
│  - Finalize Status to SUCCEEDED                        │
└───────────────────────┬────────────────────────────────┘
                        │ (7. Idempotent Upsert)
                        ▼
┌────────────────────────────────────────────────────────┐
│ 獨立「系統稽核試算表」Tab: PROJECTION_LOG              │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ 定時補償路徑 (Outbox Reconciliation):                   │
│ Cloud Scheduler (每 5 分鐘, sa-scheduler-invoker@...)   │
│   -> Outbox Publisher Endpoint                         │
│ 掃描 PENDING 且 occurredAt 超過 2 分鐘之遺漏事件補發     │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ 死信補償路徑 (DLQ Reconciler):                          │
│ Cloud Run function DLQ Reconciler                      │
│ Identity: sa-dlq-reconciler@...                        │
│ 訂閱 jy-reservation-events-dlq-sub                     │
│ 更新 projectionOperations 為 DEAD_LETTERED 並發送 P1 告警│
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ 成功投影對帳路徑 (Projection Reconciler):               │
│ Cloud Scheduler -> Projection Reconciler Worker        │
│ Identity: sa-proj-reconciler@...                       │
│ 掃描 SUCCEEDED 紀錄，比對 PROJECTION_LOG 實體列是否存在 │
│ 若遭人為誤刪則重建；若 hash 不符標記 MANUAL_REVIEW     │
└────────────────────────────────────────────────────────┘
```

### 元件責任劃分：
1. **Transaction Writer (PWA API / Apps Script Endpoint)**:
   - 僅在單一 Firestore transaction 內原子寫入預約單據與 `projectionOutbox`。
   - 產生唯一的 `eventId` 並持久化於 `projectionOutbox` 中；同一事件後續任何重發必須沿用相同 `eventId`。
   - 絕不直接呼叫 Google Sheet API，絕不直接發布 Pub/Sub。
2. **Transactional Outbox (`projectionOutbox`)**:
   - 位於 Firestore 內部，保證交易成功則事件必然落地，交易失敗則事件絕不產生。
3. **Outbox Publisher (Cloud Run function Gen 2)**:
   - **主路徑**：由 Firestore document-created event 透過 Eventarc 觸發。
   - **補償路徑**：由 Cloud Scheduler 每 5 分鐘執行一次 reconciliation，掃描狀態為 `PENDING` 且 `occurredAt` 超過 2 分鐘的遺漏事件。
   - 採用分散式租約防護發布競態，單次嘗試產生獨立 `publishAttemptId`，發布成功記錄 `publishedMessageId`。
4. **Cloud Pub/Sub & Dead-Letter Topic**:
   - 解耦發布端與處理端，提供至少一次傳遞（At-least-once Delivery）與 dead-letter topic (`jy-reservation-events-dlq`)。
5. **Projection Worker (Cloud Run function Gen 2)**:
   - 訂閱 Eventarc 事件（Transport CloudEvent: `google.cloud.pubsub.topic.v1.messagePublished`）。
   - Stage 42-H 試辦期間必須同時設定：`max-instances = 1`、`concurrency = 1`、`timeout = 120s`、`lease duration = 180s`。
   - 透過 Firestore `projectionOperations/{operationId}` 的分散式租約（180 秒）進行併發控制，在呼叫 Google Sheets API 前必須再次驗證租約有效性，將資料有效一次投影至獨立稽核試算表。
6. **DLQ Reconciler (Cloud Run function Gen 2)**:
   - 消費死信主題訊息，當且僅當實際收到死信訊息時，將對應的 `projectionOperations` 標記為 `DEAD_LETTERED`，並觸發運維告警。
7. **Projection Reconciler (Cloud Run function Gen 2)**:
   - 定時抽查與掃描狀態為 `SUCCEEDED` 的 `projectionOperations`，校驗試算表 `PROJECTION_LOG` 實體列是否存在與 SHA-256 雜湊一致性；若列遭誤刪則以權威資料重建，若雜湊不符則標記 `MANUAL_REVIEW_REQUIRED`。
8. **獨立「系統稽核試算表」**:
   - 專用工作表名稱統一為 `PROJECTION_LOG`，物理隔離於日常正式營運配貨表。

---

## 4. 完整事件資料流與 Outbox 發布競態 (End-to-End Event Dataflow & Outbox Races)

### 4.1 核心流程序列
1. **Step 1: 預約核心交易 (ACID Commit)**
   - `Transaction Writer` 在單一 Firestore 交易中：
     - 更新業務集合（`holds`, `inventory`, `operationLedger`, `auditLogs`）。
     - 新增 `projectionOutbox/{operationId}`：狀態為 `PENDING`，並產生該業務操作唯一且不可變的 `eventId`。
2. **Step 2: 主路徑事件觸發**
   - 文件建立觸發 Eventarc，以 OIDC 權杖呼叫 `Outbox Publisher`。
3. **Step 3: Publisher Claim 租約與發布競態處理**
   - **發布競態事實**：「Pub/Sub publish」與「Firestore 標記 PUBLISHED」跨越兩個獨立的分散式系統，**無法形成單一原子交易**。
   - **Publisher Claim 協議**：
     - Publisher 嘗試在交易中認領 Outbox 文件：檢查 `status == 'PENDING'` 且（`publisherLeaseExpiresAt == null` 或 `< NOW`）。
     - 原子設定 `publisherLeaseOwner = instance_id`、`publisherLeaseExpiresAt = NOW + 60s`、`publishAttemptId = UUIDv4`。
   - **發布訊息至 Pub/Sub**：
     - 將 Application Projection Event Envelope 序列化為 Canonical JSON，轉成 Base64 放入 `message.data`。
     - 設定 message attributes（至少包含 `schemaVersion`, `eventType`, `operationId`, `eventId`）。
     - 呼叫 Pub/Sub `publish` API，取得 `publishedMessageId`。
   - **標記 PUBLISHED**：將 Outbox 文件更新為 `status = 'PUBLISHED'`、`publishedAt = NOW`、`publishedMessageId`，釋放租約。
   - **崩潰恢復說明 (Crash Semantics)**：若 Pub/Sub publish 成功，但 Publisher 在標記 `PUBLISHED` 之前崩潰或網路中斷，租約到期後排程補償路徑將視為未完成而重新嘗試發布。此時，**重發之訊息沿用相同 `eventId`，但具備新的 `publishAttemptId`**。Pub/Sub 主題中可能存在重複訊息，下游 Projection Worker 必須具備容忍重複訊息之能力。
4. **Step 4: Eventarc 觸發 Projection Worker**
   - Pub/Sub 透過 Eventarc HTTP Push 呼叫 `Projection Worker`。
   - 外層 Transport CloudEvent 類型為 `google.cloud.pubsub.topic.v1.messagePublished`。
5. **Step 5: Worker 解包、Fencing Claim 與有效租約處置**
   - Worker 先解析外層 CloudEvent，提取 `data.message.attributes` 與 `data.message.data`（Base64 解碼為應用事件）。
   - Worker 提取 `operationId`，在 Firestore 交易中對 `projectionOperations/{operationId}` 進行原子認領（租約為 180 秒，詳見第 8 章）。
   - **有效租約重複訊息行為**：若當前 `projectionOperations` 狀態為 `PROCESSING` 且 `leaseExpiresAt > NOW`，表示原有 Worker 正在合法處理中。**重複抵達的 delivery 必須固定回傳 ACK（HTTP 200），並執行 0 次 Sheet 寫入**。原持有租約的 Worker 若成功完成則結案，若失敗則由其自身之例外拋出／重試機制負責恢復。
6. **Step 6: 試算表寫入前防護驗證與 Upsert**
   - **呼叫 Google Sheets API 前強制權威檢查**：Projection Worker 在呼叫 Google Sheets API 前，必須重新執行一次 Firestore authoritative read 或 transaction，讀取 `projectionOperations/{operationId}`，並同時確認：
     1. `status == PROCESSING`
     2. `leaseOwner == currentWorkerId`
     3. `claimVersion == claimedVersion`
     4. `leaseExpiresAt > Firestore server timestamp`
     只要任一條件不成立：立即終止本次執行，**0 Google Sheet 寫入**，嚴格不得只依賴程序記憶體內的租約資料。
   - Worker 呼叫 Google Sheets API，以確定性鍵 `PROJECTION_${operationId}` 對 `PROJECTION_LOG` 執行 Search-and-Append（詳見第 10 章）。
7. **Step 7: 狀態結案與 ACK**
   - Worker 在 Firestore 交易中以相符的 `claimVersion` 將 `projectionOperations` 更新為 `SUCCEEDED`。
   - 回傳 HTTP 200 向 Pub/Sub ACK 訊息。

---

## 5. Transactional Outbox Schema 與生命週期

### 5.1 集合路徑
`projectionOutbox/{operationId}`

### 5.2 文件 Schema 定義
```typescript
interface ProjectionOutboxDocument {
  schemaVersion: "1.0.0";
  eventId: string;                  // 在 Outbox 建立時產生，同一 Outbox 文件的所有重發必須嚴格沿用相同 eventId
  operationId: string;              // 業務操作唯一鍵: op_xxxxxxxx
  reservationNumber: string;        // 預約單號: RES-YYYYMMDD-XXX
  eventType: "HOLD_CREATED" | "HOLD_FULFILLED" | "HOLD_CANCELLED" | "HOLD_RECONCILED";
  sourceDocumentPath: string;       // e.g. "holds/RES-20260924-001"
  occurredAt: string;               // ISO8601 UTC
  status: "PENDING" | "PUBLISHED" | "FAILED";
  publishAttempts: number;          // 發布嘗試次數
  publisherLeaseOwner: string | null;      // 當前認領 Publisher 實例 ID
  publisherLeaseExpiresAt: string | null;  // 租約到期時間 ISO8601 UTC
  publishAttemptId: string | null;         // 當次發布嘗試 UUID（每次嘗試獨立唯一）
  publishedMessageId: string | null;       // Pub/Sub 成功 publish 回傳之 Message ID
  publishedAt: string | null;              // 發布成功時間 ISO8601 UTC
  lastError: string | null;         // 僅存 sanitized error code/message (禁存 stack/PII/Token)
  traceId: string;                  // 跨服務追蹤 ID
}
```

### 5.3 Outbox 生命週期與資料保留
- **已發布文件**：`status == 'PUBLISHED'` 的 Outbox 文件在保留 **30 天** 後由 TTL 政策自動刪除。

---

## 6. Pub/Sub 傳遞語意與執行設定

### 6.1 傳遞語意與 Effectively-Once Outcome
- **傳遞本質**：底層傳遞保證嚴格為 **At-least-once delivery**（至少一次傳遞）與 **Out-of-order delivery**（無序到達）。
- **目標成果**：系統透過應用層的「確定性 Key + 分散式租約 Fencing + 試算表查重 Upsert」，達成 **Effectively-once projection outcome（有效一次投影結果）**。嚴禁宣稱底層具備未受限的「絕對冪等」或「exactly-once delivery」。

### 6.2 執行與重試參數規範 (`OWNER_APPROVED_STAGE_42_F_PARAMETER`)
以下參數經 Owner 指示已正式核定為 Stage 42-F 基準參數：
- **Max Delivery Attempts**：`5`（Pub/Sub 的 delivery attempt 計數屬近似值，系統不得依賴「一定恰好第 5 次」作為業務狀態判斷；達上限後由 Pub/Sub Dead-Letter Policy 自動轉送至 DLQ）。
- **Retry Minimum Backoff**：`10 秒`。
- **Retry Maximum Backoff**：`300 秒`。
- **Ack Deadline**：`600 秒`。
- **Worker 執行逾時與租約邊界**：
  - Cloud Run function 執行逾時 (`timeout`)：**`120 秒`**。
  - Firestore Worker 租約時長 (`lease duration`)：**`180 秒`**。
  - **邊界安全原則**：Worker 租約（180s）**必須嚴格大於** 函式最大執行逾時（120s），確保在舊 Worker 實例完全終止前，任何其他 Worker 實例均無法接手租約，徹底防範舊 Worker 仍在進行 Sheet 寫入時被併發接管。

### 6.3 官方參考依據
- [Google Cloud Run functions Documentation](https://docs.cloud.google.com/run/docs/write-functions)
- [Cloud Tasks vs Pub/Sub Architectural Comparison](https://docs.cloud.google.com/tasks/docs/comp-pub-sub)
- [Pub/Sub Dead-letter topics Guide](https://docs.cloud.google.com/pubsub/docs/dead-letter-topics)
- [Pub/Sub Subscribe Best Practices](https://docs.cloud.google.com/pubsub/docs/subscribe-best-practices)

---

## 7. 應用事件與 Eventarc Transport CloudEvent 規格

### 7.1 識別碼規則
- **`operationId`**：業務操作唯一鍵（格式：`op_` + 24 碼英數字），單一業務意圖唯一。
- **`eventId`**：在 `projectionOutbox` 文件建立時產生之唯一識別碼（UUIDv4: `evt_` + UUID），**同一 Outbox 文件的所有重發必須嚴格沿用相同 `eventId`**。嚴禁描述為「每次發布嘗試唯一」。
- **`publishAttemptId`**：Publisher 每一次發布嘗試之獨立唯一 UUID（UUIDv4），每次發布嘗試唯一。
- **`publishedMessageId`**：Pub/Sub 每一次成功呼叫 publish API 回傳之 message ID。
- **`idempotencyKey`**：投影寫入之確定性主鍵，嚴格等於 `PROJECTION_${operationId}`。

### 7.2 雙層 Envelope 架構

系統嚴格區分「傳輸層 CloudEvent」與「應用層 Projection Event」，兩者不得混為一談：

#### 1. 外層：Eventarc Transport CloudEvent
Projection Worker 經由 Eventarc 接收之外層 HTTP 請求 Payload 格式如下：
```json
{
  "specversion": "1.0",
  "id": "eventarc-msg-uuid-9999",
  "source": "//pubsub.googleapis.com/projects/PROJECT_ID/topics/jy-reservation-events",
  "type": "google.cloud.pubsub.topic.v1.messagePublished",
  "time": "2026-09-24T07:00:00Z",
  "data": {
    "message": {
      "data": "eyJzY2hlbWFWZXJzaW9uIjoiMS4wLjAiLCJldmVudElkIjoiZXZ0XzEyMzQ1NiIsIm9wZXJhdGlvbklkIjoib3BfOTg3NjU0MzIxIiwicmVzZXJ2YXRpb25OdW1iZXIiOiJSRVMtMjAyNjA5MjQtMDAxIiwiZXZlbnRUeXBlIjoiSE9MRF9DUkVBVEVEIiwib2NjdXJyZWRBdCI6IjIwMjYtMDktMjRUMDY6NDk6NTlaIiwicGF5bG9hZCI6eyJzdG9yZUlkIjoiU1RPUkVfMDAxIiwicHJvZHVjdENvZGUiOiJFUUEtNjUyMiIsInF1YW50aXR5IjoxMCwicHNldWRvbnltb3VzQWN0b3JJZCI6ImFjdG9yX2FkbWluXzAxIn0sInBheWxvYWRIYXNoIjoiZTNiMGM0NDI5OGZjMWMxNDlhZmJmNGM4OTk2ZmI5MjQyN2FlNDFlNDY0OWI5MzRjYTQ5NTk5MWI3ODUyYjg1NSIsInRyYWNlSWQiOiJ0cmFjZV9hYmNkZWYxMjM0NTYifQ==",
      "attributes": {
        "schemaVersion": "1.0.0",
        "eventType": "HOLD_CREATED",
        "operationId": "op_987654321",
        "eventId": "evt_123456"
      },
      "messageId": "1234567890123456",
      "publishTime": "2026-09-24T06:59:59.999Z"
    },
    "subscription": "projects/PROJECT_ID/subscriptions/jy-reservation-events-sub"
  }
}
```

#### 2. 內層：Application Projection Event Envelope (Unpacked)
Worker 將 `data.message.data` 進行 Base64 解碼後解析出之核心應用 Payload：
```json
{
  "schemaVersion": "1.0.0",
  "eventId": "evt_123456",
  "operationId": "op_987654321",
  "reservationNumber": "RES-20260924-001",
  "eventType": "HOLD_CREATED",
  "occurredAt": "2026-09-24T06:49:59Z",
  "payload": {
    "storeId": "STORE_001",
    "productCode": "EQA-6522",
    "quantity": 10,
    "pseudonymousActorId": "actor_admin_01"
  },
  "payloadHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "traceId": "trace_abcdef123456"
}
```

### 7.3 Canonical JSON Hashing 規範
為確保 `projectionOperations`、事件 envelope 與 `PROJECTION_LOG` 試算表具備 100% 確定性的 SHA-256 雜湊，三者必須遵循完全一致的 **Canonical JSON** 序列化規範：
1. **編碼**：嚴格使用 UTF-8。
2. **鍵值排序**：遞迴對 Object 的所有 Key 依 Unicode 碼位進行字典升冪排序（Deterministic Sorted Keys）。
3. **空白消除**：移除鍵值之間與元素之間的所有無意義空白與換行符號（`separators=(',', ':')`）。
4. **型別約束**：嚴格禁止非標準浮點數值（`NaN`, `Infinity`, `-Infinity`）；所有整數以不帶小數點格式輸出。
5. **完整雜湊**：雜湊結果必須為完整 **64 個十六進位小寫字元**（256-bit hex string），嚴禁擷取前 16 碼作為一致性或衝突判斷。

---

## 8. Firestore ProjectionState Schema 與 Worker Claim Lease

### 8.1 集合路徑
`projectionOperations/{operationId}`

### 8.2 文件 Schema 定義
```typescript
interface ProjectionOperationDocument {
  operationId: string;              // Document ID
  eventId: string;                  // 來源事件 ID
  reservationNumber: string;        // 關聯預約單號
  projectionKey: string;            // 確定性鍵: "PROJECTION_" + operationId
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "RETRYABLE_FAILED" | "DEAD_LETTERED" | "MANUAL_REVIEW_REQUIRED";
  attemptCount: number;             // 當前執行嘗試次數
  leaseOwner: string | null;        // 當前認領 Worker 實例 ID
  leaseExpiresAt: string | null;    // 租約到期時間 ISO8601 UTC (NOW + 180s)
  claimVersion: number;             // Fencing Token (每次認領遞增 +1)
  payloadHash: string;              // 完整 64 個十六進位字元之 SHA-256 雜湊
  lastMessageId: string | null;     // 最近一次處理之 Pub/Sub Message ID
  firstAttemptAt: string;           // 首次嘗試 ISO8601 UTC
  lastAttemptAt: string;            // 最近嘗試 ISO8601 UTC
  completedAt: string | null;       // 成功完成 ISO8601 UTC
  lastErrorCode: string | null;     // 僅存 sanitized error code
  lastErrorMessage: string | null;  // 僅存 sanitized error message
  sheetDocumentId: string;          // 目標試算表 ID (獨立稽核表)
  sheetTabName: "PROJECTION_LOG";   // 固定為 PROJECTION_LOG
  sheetRowKey: string;              // 寫入試算表的主鍵值 (PROJECTION_${operationId})
  traceId: string;                  // 跨服務追蹤 ID
}
```

### 8.3 Worker Claim Lease 與併發防護規範
1. **認領條件與租約時長**：
   - 租約時長固定為 **`180 秒`**（遠高於 Worker 執行逾時 `120 秒`）。
   - 若文件不存在：原子建立並初始化 `status = 'PROCESSING'`、`claimVersion = 1`、`leaseOwner = worker_id`、`leaseExpiresAt = NOW + 180s`。
   - 若狀態為 `SUCCEEDED`：表示先前已完成，立即回傳 HTTP 200 ACK，不執行 Sheet 寫入。
   - **有效租約重複訊息行為**：若狀態為 `PROCESSING` 且 `leaseExpiresAt > NOW`，表示其他合法 Worker 正在處理中。**重複抵達的 delivery 必須固定回傳 ACK（HTTP 200），並執行 0 次 Sheet 寫入**。若原 Worker 失敗，由其拋出例外觸發重試。
   - 若狀態為 `PROCESSING` 且 `leaseExpiresAt <= NOW`（舊 Worker 崩潰或逾時）或狀態為 `RETRYABLE_FAILED`：允許新 Worker 原子接手，遞增 `claimVersion += 1`，更新 `leaseOwner` 與 `leaseExpiresAt = NOW + 180s`。
2. **Payload Hash 一致性防護**：
   - 收到相同 `operationId` 但 `payloadHash`（完整 64 碼比對）與既有紀錄不一致：**嚴禁覆蓋**，立即標記狀態為 `MANUAL_REVIEW_REQUIRED`，發送 P1 警報並終止。
3. **Fencing Token 邊界澄清 (Critical Boundary)**：
   - **Firestore Fencing**：`claimVersion` 僅能保護 Firestore 內部文件的狀態更新具備樂觀鎖防護。
   - **Google Sheets API 無分散式 Fencing**：Google Sheets API 不支援分散式交易鎖或 Fencing Token 拒絕協議。因此，系統防護依賴於「180s 租約大於 120s 執行逾時」與「呼叫 Sheets API 前重新讀取 Firestore 權威狀態（同時校驗 status == PROCESSING, leaseOwner == currentWorkerId, claimVersion == claimedVersion, leaseExpiresAt > Firestore server timestamp）」，規格書**嚴禁宣稱 Firestore Fencing Token 能對 Google Sheets API 提供交易式 fencing**，且**嚴格不得只依賴程序記憶體內的租約資料**。

---

## 9. 獨立稽核試算表 Projection Schema

### 9.1 儲存位置與隔離
- **試算表實體**：全新獨立建立之「系統稽核試算表」（Independent Audit Spreadsheet）。
- **工作表名稱**：**統一固定為 `PROJECTION_LOG`**（嚴格移除 `PROJ` 等簡寫）。
- **隔離規範**：現有正式營運表完全不修改、不新增欄位。

### 9.2 欄位規範 (12 欄物理結構)
| 欄位序號 | 欄位代號 | 標題名稱 | 說明 |
| :---: | :--- | :--- | :--- |
| **A** | `projection_key` | 投影鍵值 | `PROJECTION_${operationId}`（唯一主鍵） |
| **B** | `operation_id` | 操作編號 | 關聯之 Firestore `operationId` |
| **C** | `reservation_number` | 預約單號 | `RES-YYYYMMDD-XXX` |
| **D** | `event_type` | 事件類型 | `HOLD_CREATED`, `HOLD_FULFILLED` 等 |
| **E** | `store_id` | 店家代號 | 門市/客戶代碼 |
| **F** | `product_code` | 產品貨號 | 規格貨號 |
| **G** | `quantity` | 數量 | 變更數量 |
| **H** | `pseudonymous_actor_id`| 操作人員虛擬代號 | 假名化代號 (禁存姓名/Email/LINE ID) |
| **I** | `occurred_at` | 業務發生時間 | 來源交易時間戳記 (UTC) |
| **J** | `projected_at` | 投影完成時間 | Worker 寫入完成時間戳記 (UTC) |
| **K** | `attempt_count` | 嘗試次數 | Worker 寫入時之嘗試次數 |
| **L** | `payload_hash` | 資料雜湊 | **完整 64 個十六進位字元之 SHA-256 雜湊**（嚴禁擷取前 16 碼） |

---

## 10. 試算表 Upsert 併發控制與恢復流程 (Sheet Upsert Concurrency & Recovery)

### 10.1 併發抑制參數 (Stage 42-H Pilot 專用配置)
Stage 42-H 試辦期間，Projection Worker 的 Cloud Run service 必須同時設定：
- **`max-instances = 1`**
- **`concurrency = 1`**
- **`timeout = 120s`**
- **`lease duration = 180s`**

> [!NOTE]
> **試辦風險限制說明**：此單一實例與單一併發設定為 Stage 42-H 試辦期之風險收斂措施。未來若因應吞吐量需擴充實例數，必須先通過多實例併發模擬與壓力測試，不得直接在生產環境變更。

### 10.2 禁止原子性誤導
**禁止宣稱** Google Sheets API 的「查詢 A 欄 + 覆蓋/附加」具備原子性。試算表本身無交易鎖，併發防護由 Firestore 租約與單一實例配置共同保證。

### 10.3 核心 Upsert 與恢復流程
1. **呼叫前 Firestore 權威租約再校驗**：Projection Worker 在準備發起 Google Sheets API 請求前，必須重新執行一次 Firestore authoritative read 或 transaction，讀取 `projectionOperations/{operationId}`，並同時確認四項條件：
   - `status == PROCESSING`
   - `leaseOwner == currentWorkerId`
   - `claimVersion == claimedVersion`
   - `leaseExpiresAt > Firestore server timestamp`
   只要任一條件不成立：立即終止本次執行，拋出 `LEASE_INVALID_BEFORE_SHEET_WRITE`，**0 Google Sheet 寫入**。系統嚴格禁止僅依賴本地記憶體內的租約資料。
2. **Search-and-Append 流程**：
   - 讀取 `PROJECTION_LOG!A:A` 與 `PROJECTION_LOG!L:L` 欄位：
     - **情境 1（全新列）**：未找到相符之 `PROJECTION_${operationId}`，執行 append 列寫入。
     - **情境 2（崩潰恢復 / 已存在）**：找到既有列包含相同 `projection_key`。比對 L 欄完整 64 碼 `payload_hash`：
       - 若 hash 完全相符：代表前次執行時「Sheet 寫入成功，但 Firestore SUCCEEDED 更新前崩潰」。Worker **嚴禁再次 append 新列**，僅在原列更新校正時間，隨後推進 Firestore 狀態為 `SUCCEEDED`。
       - 若 hash 不相符：判定為資料污染或衝突，標記 `MANUAL_REVIEW_REQUIRED`，**絕對不自動覆蓋**。

---

## 11. 錯誤分類、DLQ 與人工補償 (Error Taxonomy, DLQ & Replay)

### 11.1 錯誤處置語意
- **可重試錯誤 (Retryable Errors)**：
  - 包括：Google Sheets API 429 (Rate Limit)、網路逾時 (503/504)、暫時性連線中斷。
  - **處理方式**：Worker 拋出例外（回傳非 200 NACK），由 Pub/Sub 執行指數退避重試。
- **不可重試錯誤 (Non-Retryable Errors)**：
  - 包括：Payload Schema 損毀、不支援的 `schemaVersion`、試算表 ID 不存在、權限永久拒絕 (403)、`payloadHash` 衝突。
  - **處理方式**：更新 Firestore `projectionOperations` 為 `MANUAL_REVIEW_REQUIRED`，隨後回傳 HTTP 200 **ACK 訊息**，阻絕無效重試迴圈浪費配額。
- **死信轉送 (Dead-Lettering)**：
  - 連續重試達到 **5 次**（Stage 42-H 設定值，近似次數）後，由 Pub/Sub 訂閱的 Dead-Letter Policy 自動轉發至 `jy-reservation-events-dlq`。**應用程式本身嚴禁主動直接 put 至 Pub/Sub DLQ**。

### 11.2 DLQ Reconciler 規格
- 建立專用服務（Cloud Run function: DLQ Reconciler，身分 `sa-dlq-reconciler@...`）訂閱 `jy-reservation-events-dlq-sub`：
  1. 接收死信訊息，提取 `operationId`。
  2. 當且僅當實際從 DLQ 收到訊息時，才將 Firestore `projectionOperations/{operationId}` 狀態更新為 `DEAD_LETTERED`。
  3. 透過 Cloud Monitoring 發出 P1 警報。
  4. 向死信訂閱回傳 ACK。

### 11.3 人工補償檢查清單 (Manual Compensation Runbook)
1. 僅限 `admin` 角色可執行重播作業。
2. 檢查 `projectionOperations/{operationId}` 之 `lastErrorCode` 與完整 64 碼 `payloadHash`。
3. 檢查獨立稽核表 `PROJECTION_LOG` 實體狀態。
4. 排除根本原因（例如 API 配額解鎖或權限重新授權）。
5. 觸發專用管理腳本，原子重設狀態為 `RETRYABLE_FAILED`，並向 Pub/Sub 重送標準事件。
6. 記錄完整人工重播稽核日誌，防止同一單據重複人工介入。

---

## 12. 成功投影補償器規格 (Projection Reconciler Specification)

為防止試算表稽核列遭人為誤刪或意外損毀，建立獨立的 **Projection Reconciler**（身分 `sa-proj-reconciler@...`）：

1. **觸發方式**：由 Cloud Scheduler 定期（如每日或每小時）觸發。
2. **掃描範圍**：掃描 Firestore 中 `status == 'SUCCEEDED'` 之 `projectionOperations` 紀錄。
3. **對帳邏輯**：
   - 查詢試算表 `PROJECTION_LOG` 是否存在對應的 `projection_key`（`PROJECTION_${operationId}`）。
   - **情境 A（正常）**：列存在且 64 碼 `payload_hash` 完全一致，對帳通過。
   - **情境 B（列遭刪除）**：若試算表中找不到該列，Projection Reconciler 必須在 Firestore 重新取得租約，以 Firestore 保存的權威業務資料重新 append 補回該列，並記錄對帳修復日誌。
   - **情境 C（雜湊不符）**：若列存在但 `payload_hash` 與 Firestore 權威紀錄不一致，立即標記該單據為 `MANUAL_REVIEW_REQUIRED`，發送 P1 告警，**嚴禁自動覆蓋試算表**。

---

## 13. IAM 身分與授權方向 (IAM Identities & Authorization Direction)

為落實嚴格的最小權限原則，本架構明確將 **執行身分 (Runtime Identities)** 與 **呼叫身分 (Caller/Trigger Identities)** 完全拆分，並嚴格區隔 GCP IAM Roles、OAuth Scopes 與 Drive ACL：

### 13.1 執行身分 (Runtime Service Accounts)
| 執行身分 (Runtime SA) | GCP IAM Roles | OAuth Scopes | Google Drive/Sheet ACL | 權限邊界約束 |
| :--- | :--- | :--- | :--- | :--- |
| **Transaction Writer SA**<br>`sa-tx-writer@...` | `roles/datastore.user` | 無 | 無 | 僅能讀寫業務資料庫與 Outbox；嚴禁存取 Google Sheets API 或 Pub/Sub。 |
| **Outbox Publisher SA**<br>`sa-outbox-pub@...` | `roles/datastore.user`<br>`roles/pubsub.publisher` (僅限 topic `jy-reservation-events`) | 無 | 無 | 僅能讀寫 Outbox 與發布至指定主題；嚴禁存取 Google Sheets API。 |
| **Projection Worker SA**<br>`sa-proj-worker@...` | `roles/datastore.user` | `https://www.googleapis.com/auth/spreadsheets` | **僅在「獨立系統稽核試算表」檔案被授予 Editor 角色** | **嚴禁持有 `roles/run.invoker`**（Worker 自身不具備呼叫其他服務權限）；嚴禁存取任何正式營運試算表。 |
| **DLQ Reconciler SA**<br>`sa-dlq-reconciler@...` | `roles/datastore.user` | 無 | 無 | 僅能更新死信狀態與發送告警；嚴禁存取 Google Sheets。 |
| **Projection Reconciler SA**<br>`sa-proj-reconciler@...` | `roles/datastore.user` | `https://www.googleapis.com/auth/spreadsheets` | **僅在「獨立系統稽核試算表」檔案被授予 Editor 角色** | 僅能對帳稽核表，嚴禁存取正式營運表。 |

### 13.2 呼叫／觸發身分 (Caller / Trigger Identities)
| 觸發身分 (Trigger / Scheduler SA) | GCP IAM Roles | 授權目標資源 (Scoped Resource) | 職責 |
| :--- | :--- | :--- | :--- |
| **Firestore Eventarc Trigger SA**<br>`sa-eventarc-firestore-trigger@...` | `roles/eventarc.eventReceiver`<br>`roles/run.invoker` | Scoped to: `Cloud Run Outbox Publisher Service` | 接收 Firestore 建立事件並觸發 Outbox Publisher |
| **Pub/Sub Eventarc Trigger SA**<br>`sa-eventarc-pubsub-trigger@...` | `roles/eventarc.eventReceiver`<br>`roles/run.invoker` | Scoped to: `Cloud Run Projection Worker Service` | 接收 Pub/Sub 訊息並觸發 Projection Worker |
| **DLQ Eventarc Trigger SA**<br>`sa-eventarc-dlq-trigger@...` | `roles/eventarc.eventReceiver`<br>`roles/run.invoker` | Scoped to: `Cloud Run DLQ Reconciler Service` | 接收 DLQ 訊息並觸發 DLQ Reconciler |
| **Cloud Scheduler Invoker SA**<br>`sa-scheduler-invoker@...` | `roles/run.invoker` | Scoped to: `指定 Reconciliation Endpoints` | 定時觸發 Outbox 與 Projection 對帳任務 |
| **Pub/Sub System Service Agent**<br>`service-{PROJECT_NUM}@gcp-sa-pubsub.iam.gserviceaccount.com` | `roles/pubsub.publisher` (僅限 topic `jy-reservation-events-dlq`)<br>`roles/pubsub.subscriber` (僅限 subscription `jy-reservation-events-sub`) | Scoped to 指定 Topic 與 Subscription | 執行 Pub/Sub 原生死信轉送機制 |

> [!CAUTION]
> **憑證安全規範**：嚴格禁止使用 Owner 個人 OAuth Token 作為正式 Worker 服務憑證。所有服務間通訊必須透過 GCP Service Account 自動管理之短效 Token 進行。

---

## 14. 可觀測性、Metrics 與 Structured Logging

1. **結構化日誌 (Structured JSON)**：
   - 輸出至 Cloud Logging，必要欄位：`severity`, `message`, `operationId`, `reservationNumber`, `attemptCount`, `claimVersion`, `traceId`, `durationMs`。
   - **Last Error 脫敏**：`lastError` 僅允許紀錄結構化代碼與過濾後訊息（如 `SHEET_RATE_LIMIT_429`），**嚴禁** 記錄 payload 內容、Token、個資或未過濾的完整 stack trace。
2. **核心監控指標 (Metrics)**：
   - `projection_latency_seconds`：從交易發生 (`occurredAt`) 到投影完成 (`completedAt`) 的時間延遲。
   - `projection_dlq_count`：轉入死信佇列的事件數量（門檻 > 0 立即警報）。
   - `outbox_pending_backlog`：Outbox 處於 `PENDING` 超過 2 分鐘的積壓數量。

---

## 15. 資料保留與隱私邊界 (Data Retention & Privacy Boundaries)

1. **個資去識別化 (PII Redaction)**：
   - 事件與試算表中一律不得保存真實姓名、Email 或 LINE User ID，統一改用 `pseudonymousActorId` 或角色代號（如 `actor_assistant_02`）。
2. **資料生命週期 (Retention Policies - `OWNER_APPROVED_STAGE_42_F_PARAMETER`)**：
   - **`projectionOutbox` (Firestore)**：已發布（`PUBLISHED`）文件於 **30 天** 後透過 TTL 政策自動刪除。
   - **`PROJECTION_LOG` (獨立稽核表)**：紀錄保留 **90 天** 後由維運排程自動封存或清除。
   - **`projectionOperations` (Firestore)**：保留 **400 天**。400 天後透過維運腳本最小化修剪為 tombstone 結構，僅保留 `operationId`、`projectionKey`、`completedAt` 與完整 64 碼 `payloadHash` 以防歷史碰撞。
   - **安全邊界聲明**：以上參數已獲 Owner 核准。若未來因稅務、審計或個資法規要求有不同留存年限，必須另開正式 Owner Change Request 辦理，**嚴禁任何 AI 自行延長、縮短或宣稱具備法規遵循效力**。

---

## 16. 失敗模式與熔斷機制 (Failure Modes & Circuit-Breaker)

### 16.1 熔斷原則 (Circuit-Breaker Strategy)
- **降級處置**：
  - 當特定 `eventType` 連續發生嚴重異常（或 Google Sheets API 配額耗盡）時，透過配置旗標（Feature Flag）僅**暫停受影響之 `eventType` 的 Projection Worker 處理**。
  - `Outbox Publisher` **維持正常運作**，繼續將事件安全累積至訊息管道或 Outbox 中。
  - **前台預約核心交易絕不受到任何波及**。
  - 待根本原因排除後，由運維人員依 Runbook 恢復處理。

---

## 17. Stage 42-G TDD 測試案例矩陣 (Test Matrix)

未來 Stage 42-G 實作時，必須先實作以下 18 大自動化測試案例：

| 編號 | 測試案例名稱 | 驗證場景與預期行為 |
| :---: | :--- | :--- |
| **TC-01** | Publish 成功但 PUBLISHED 更新前崩潰 | 模擬 Publisher 於 Pub/Sub 發布後崩潰，驗證重發時 `eventId` 保持不變、`publishAttemptId` 改變，下游安全處理重複。 |
| **TC-02** | Transport CloudEvent 解包驗證 | 驗證 Worker 正確解析 `google.cloud.pubsub.topic.v1.messagePublished` 外層封裝，並成功解碼內層 Base64 應用事件。 |
| **TC-03** | 相同訊息併發 Delivery (有效租約) | 模擬相同訊息於租約有效期間重複送達，驗證第二筆 delivery **固定回傳 ACK** 且執行 **0 次 Sheet 寫入**。 |
| **TC-04** | 120s Timeout、180s Lease 與寫入前權威租約校驗 | 驗證租約時長（180s）大於函式逾時（120s）；並驗證 Sheet 寫入前會重新讀取 Firestore 權威租約狀態（同時校驗 status, leaseOwner, claimVersion, leaseExpiresAt > server timestamp），任一條件失敗立即終止且 0 Sheet 寫入。 |
| **TC-05** | PROCESSING Lease 過期接手 | 模擬 Worker 異常掛死超過 180s，驗證新 Worker 能原子接手並遞增 `claimVersion`。 |
| **TC-06** | 過期 Worker Fencing Token 被拒絕 | 模擬舊 Worker 復甦並嘗試結案，驗證因其 claimVersion 小於最新版本而更新失敗。 |
| **TC-07** | 完整 64 碼 Payload Hash 衝突檢測 | 模擬收到相同 ID 但內容竄改之訊息，驗證比對完整 64 碼 SHA-256 失敗，拒絕覆蓋並直接轉為 `MANUAL_REVIEW_REQUIRED`。 |
| **TC-08** | Sheet 成功但 Firestore 狀態更新失敗 | 模擬 Sheet 寫入完成但 Firestore 連線中斷，驗證下一次 delivery 檢測到既有列而不會重複 append。 |
| **TC-09** | 不可重試錯誤處置 | 模擬驗證失敗或 Schema 損毀，驗證狀態直接轉為 `MANUAL_REVIEW_REQUIRED` 並 ACK 終止重試。 |
| **TC-10** | Retryable Error 超過 5 次進 DLQ | 模擬連續暫時錯誤，驗證訊息依據 Pub/Sub DLQ 政策轉送至 dead-letter topic（不作精確第 5 次業務判斷）。 |
| **TC-11** | DLQ Reconciler 更新 DEAD_LETTERED | 驗證 DLQ Consumer 實際自死信主題接收訊息後，正確將 Firestore 狀態更新為 `DEAD_LETTERED` 並發出告警。 |
| **TC-12** | 不支援的 schemaVersion | 模擬收到 `schemaVersion: 9.9.9`，驗證 Fail-closed 阻擋且 0 Sheet 寫入。 |
| **TC-13** | 稽核列遭人為刪除由 Reconciler 修復 | 模擬 `status == SUCCEEDED` 之列遭刪除，**明確由 Projection Reconciler** 偵測並以權威資料重建該列。 |
| **TC-14** | Outbox Reconciliation 重發安全性 | 驗證每 5 分鐘補償掃描對於合法未送達事件之補發正確性，沿用原始 `eventId`。 |
| **TC-15** | Cloud Run Pilot 併發配置校驗 | 驗證設定檔中同時明列 `max-instances = 1`、`concurrency = 1`、`timeout = 120s`、`lease = 180s`。 |
| **TC-16** | Trigger Identity 與 Runtime Identity 權限隔離 | 驗證 `roles/run.invoker` 僅授予 Trigger SA，Projection Worker runtime SA 絕不持有 `roles/run.invoker`。 |
| **TC-17** | PII 與 Error Redaction | 驗證日誌與試算表欄位均無真實姓名、Email、LINE ID，且 `lastError` 無敏感堆疊與 Token。 |
| **TC-18** | Sheets 權限被拒 (403) | 模擬 Worker 存取未被分享之試算表，驗證安全拋出 `SHEET_PERMISSION_DENIED` 並終止。 |

---

## 18. Stage 42-H 獨立稽核表試辦方案

1. **試辦目標**：在不影響現有生產營運的情況下，以端到端方式驗證 Firestore -> Outbox -> Pub/Sub -> Worker -> 獨立稽核表 之全流程。
2. **試辦試算表隔離原則**：
   - 建立全新的 Google Sheet 專門作為「Stage 42-H 系統稽核表」。
   - 工作表命名為 `PROJECTION_LOG`。
   - 該表擁有獨立的 Spreadsheet ID，與任何現行業務表格完全無關。
3. **試辦驗收標準**：
   - 連續執行 20 筆受控預約操作。
   - 稽核表 100% 成功投影，無遺漏、無重複列、欄位格式 100% 符合規範。

---

## 19. 回復與停止條件 (Rollback & Circuit-Breaker Conditions)

- **停止條件**：若試辦期間發生任何資料錯位或未預期例外，立即停用 Cloud Run function 觸發器。
- **回復操作 (Rollback)**：
  - 由於本架構採取非同步單向投影，若 Worker 發生重大異常，直接暫停 Cloud Run function 觸發即可，**前台預約核心功能完全無須回滾或停機**。

---

## 20. 明確未授權事項 (Explicitly Unauthorized Actions)

在 Owner 正式審查並核准 Stage 42-G 之前，以下行為**嚴格禁止**：
- ❌ 建立任何實體 GCP Cloud Run、Pub/Sub、Eventarc 或 Firestore 雲端資源。
- ❌ 在任何 Google Sheet（無論新舊）中手動或自動建立欄位與資料。
- ❌ 安裝任何新的 npm 套件或引入外部相依。
- ❌ 修改現有業務管家 PWA 前端程式碼。
- ❌ 執行 Apps Script 部署或 clasp 指令。
- ❌ 呼叫任何外部 LINE Messaging API。
- ❌ 讀取、列印、輸出或儲存任何 Token / 憑證。

---
