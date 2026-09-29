# Stage 42-G Formal Projection Worker Master Implementation Plan

> For agentic workers:
> REQUIRED SUB-SKILL: use executing-plans or an equivalent task-by-task execution workflow. Do not implement tasks in parallel when they modify shared event schemas or Firestore state contracts.
>
> **Stage 42-F Status**: `APPROVED WITH ERRATUM 1`<br>
> **Stage 42-G Status**: `TDD IMPLEMENTATION PLANS APPROVED — IMPLEMENTATION NOT STARTED`<br>
> **Implementation Authorization**: `NOT AUTHORIZED`<br>
> **Next Step**: `Stage 42-G implementation awaits separate Owner authorization.`<br>
> **安全聲明**：規格與計畫核准不等於程式實作授權；不得建立 GCP 資源或執行部署；Stage 42-H Pilot 仍需獨立 Owner 授權；正式營運表保持 0 修改。

Goal:
統籌 Stage 42-G 測試先行（TDD）實作計畫，嚴格依據 Stage 42-F 架構規格與 Erratum 1 最終規範拆分為 6 份高內聚、低耦合的子計畫（共 19 項任務），完成具備真實 Test Registry 執行能力與 Reconciler 獨立租約防護之端到端本機模擬驗證體系。

Architecture:
本計畫以已獲 Owner 核准之 `docs/stages/stage-42-f-formal-projection-worker-architecture-spec.md` 與 Erratum 1 為唯一藍圖，建構「Firestore ACID 預約交易 -> Transactional Outbox (`projectionOutbox`) -> Pub/Sub Adapter -> Projection Worker -> 獨立稽核試算表 (`PROJECTION_LOG`)」之非同步單向投影系統。整體設計貫徹：
1. Effectively-Once 結果冪等與 180s/120s 租約防護。
2. 呼叫前 Firestore 權威狀態再校驗（同時檢查 status、leaseOwner、claimVersion、leaseExpiresAt）。
3. 共享受控時間源（Clock 抽象介面：ProductionClock 與 FakeClock，回傳真正 Firestore Timestamp 實例），所有租約到期使用 Firestore Timestamp。
4. G1/G3 單一權威 Payload Schema 與 Fail-Closed 快照：Transport CloudEvent 嚴格驗證（type 必須為 `google.cloud.pubsub.topic.v1.messagePublished`、attributes 與 envelope 欄位雙向校驗不符即 Fail-Closed、嚴格 Base64 驗證）；Envelope 層級必填 `reservationNumber`，唯一核准 `eventType` 列舉（`HOLD_CREATED`, `HOLD_FULFILLED`, `HOLD_CANCELLED`, `HOLD_RECONCILED`），Payload 僅允許 `{ storeId, productCode, quantity }`，其中 quantity 必須為 `Number.isFinite(quantity) && Number.isInteger(quantity) && quantity > 0`。嚴格禁止任何 fallback 欄位（禁止 `payload.reservationNumber`、`customerCode`、`sku`、多欄位 quantity fallback）。重複訊息防破壞：畸形重複事件抵達時，不得將既有 `SUCCEEDED` 或 `PROCESSING` 改壞，不得清空或覆蓋 `projectionSnapshot`，固定回傳 ACK，0 Sheet 寫入。重複 payloadHash 判定順序：先驗證 64 碼 hex 格式，非合法 hash 視為 malformed duplicate（0 狀態變更、0 快照變更、`rejectedDuplicateCount` 嚴格計算不依賴 `(v||0)+1`）；僅合法 64 碼 hash 與現有 hash 不同時才標記 `MANUAL_REVIEW_REQUIRED`。
5. Erratum 1 權威重建來源（`projectionSnapshot` 與 `projectionSnapshotExpiresAt` completedAt 後 90 天保存），支援 Reconciler 誤刪列修復且不依賴 Outbox。
6. Reconciler 專用租約隔離與 TOCTOU 防護：修復流程採 try/finally 保證所有結束路徑條件式釋放租約；嚴格遵守「先在 Firestore 交易中認領租約（claim 時絕不更新 `lastReconciledAt`） -> 權威讀取 Firestore -> 取得租約後才查詢 Sheet -> 寫入前再次以 transaction 執行 preWriteCheck（校驗租約有效性、attemptCount 正整數、doc payloadHash 64 碼 hex、projectionKey 吻合、snapshot 欄位齊全、quantity 正整數、snapshot.payloadHash 與 doc.payloadHash 一致，校驗失敗 0 Sheet append 且條件式標記 MANUAL_REVIEW_REQUIRED）並回傳最新權威資料 -> 追加稽核列 -> 條件式釋放租約 (`owner` 與 `claimVersion` 雙重比對，僅在 MATCH/REPAIRED 時更新 `lastReconciledAt`；異常狀態透過專屬交易 helper 在租約保護下更新）」；修復期間核心 status 維持 SUCCEEDED，併發互斥至多追加一列。
7. Runtime、Trigger 與 System 共 10 大身分最小權限隔離，採 `identity -> [{ role, resource }]` 精確資源範圍校驗（`roles/datastore.user` 資源層級精確為 `projects/PROJECT_ID`；僅允許 `roles/datastore.user` 與 `roles/eventarc.eventReceiver` 使用 project scope；Scheduler SA 涵蓋 `jy-outbox-publisher` 與 `jy-projection-reconciler`；Pub/Sub 系統代理包含 `roles/pubsub.publisher` on DLQ topic 與 `roles/pubsub.subscriber` on main subscription，移除 `roles/iam.serviceAccountTokenCreator`；Sheets OAuth scope 與 Sheet Editor ACL 作為獨立欄位校驗）。
8. 真實 Test Registry 執行調度，嚴禁 hard-code passedCases 固定為 18 或假陽性空跑，self-check 採用獨立 stub registry 隔離驗證。

Tech Stack:
- 執行環境：Node.js 20+ (CommonJS 模組系統，與現有 repo 100% 對齊)
- 資料庫與模擬器：Cloud Firestore (Firestore Emulator `127.0.0.1:8080`, `firebase-admin ^14.3.0`, `firebase-tools ^15.29.0`)
- 傳輸契約：CloudEvents 1.0 (`google.cloud.pubsub.topic.v1.messagePublished`)
- 介面與 Adapters：Fake Pub/Sub Publisher Adapter, Fake Google Sheets Client Adapter, Fake Alerting Adapter
- 時間抽象：`Clock` 介面（`ProductionClock` 與測試專用 `FakeClock`，回傳真實 `admin.firestore.Timestamp`）
- 測試框架：Node.js 原生 `assert` 輕量化模擬測試套件 (相容 `npm run simulate:*`)

Spec:
docs/stages/stage-42-f-formal-projection-worker-architecture-spec.md (含 Erratum 1)

Global Constraints:
1. 嚴格禁止建立實體 GCP Pub/Sub Topic、Eventarc Trigger、Cloud Run function 或 Cloud Scheduler 資源。
2. 嚴格禁止向現有生產 Google Sheet 或新建 Google Sheet 進行任何實體 API 寫入，所有測試必須注入 Fake Adapter。
3. 嚴格禁止執行 `git commit` 或 `git push`（本計畫僅提供建議 commit checkpoint，執行仍須經 Owner 獨立明確授權）。
4. 嚴格禁止修改現有生產預約與 PWA 程式碼（`app.js`, `google-apps-script/Code.gs`, `index.html` 等）。
5. 嚴格禁止存取、列印或輸出真實 GCP Service Account Key 或個人 OAuth Token。
6. 嚴格禁止破壞性自動回滾，保留未提交檔案供 Owner 審查。
7. 參數完全固定 (`OWNER_APPROVED_STAGE_42_F_PARAMETER`)：
   - `max-instances = 1`
   - `concurrency = 1`
   - `timeout = 120s`
   - `lease duration = 180s`
   - `maximum-delivery-attempts = 5`
   - `ack-deadline = 600s`
   - `outbox reconciliation interval = 5m`
   - `stale PENDING threshold = 2m`
   - `PROJECTION_LOG retention = 90d`
   - `projectionSnapshot retention = 90d` (completedAt 後 90 天清除快照)
   - `projectionOperations retention = 400d` (後最小化 tombstone)

Review Focus:
1. 子系統依賴順序是否具備嚴格的單向無環性（DAG），避免平行修改型別定義。
2. 共享狀態契約（`projectionOutbox` 與 `projectionOperations`）欄位定義是否與 Stage 42-F 及 Erratum 1 完全一致。
3. 租約防護邊界：寫入 Google Sheets 前是否強制由 Firestore authoritative read 校驗四項條件（`status`, `leaseOwner`, `claimVersion`, `leaseExpiresAt > server timestamp`），時間比對是否使用真實 Firestore Timestamp。
4. Reconciler 專用租約：修復補列時核心狀態是否維持 SUCCEEDED，併發時是否嚴格互斥。
5. 失敗隔離邊界：Projection 失敗或 DLQ 轉送是否保證 100% 不回滾已提交的 Firestore 預約交易。
6. 驗收真實性：TC-01 至 TC-18 是否由真實 Test Registry 匯入並逐一 `await test.run()` 執行驗證，絕無 hard-coded PASS，且 registry 不使用 self-require。

---

## 1. 子計畫拆分與執行依賴圖 (Subplans & Dependency Graph)

Stage 42-G 實作計畫拆分為以下 6 份獨立子計畫，所有執行必須依序進行：

```
[G1: Event Contracts, Canonical JSON & True Timestamp Clock]
                             │
                             ▼
           [G2: Transactional Outbox & Publisher]
                             │
                             ▼
      [G3: Projection Worker & Sheets Upsert Pipeline]
                             │
         ┌───────────────────┴───────────────────┐
         ▼                                       ▼
[G4: DLQ Reconciler]           [G5: Projection Reconciler & Dedicated Lease]
         └───────────────────┬───────────────────┘
                             ▼
        [G6: Pilot Configuration & Acceptance Test Runner]
```

### 子計畫清單：
1. **G1 (`2026-09-24-stage-42-g1-event-contracts.md`)** - 共 4 項任務：
   - 核心：Application Projection Event Envelope、Transport CloudEvent parser（嚴格驗證 `cloudEvent.type === "google.cloud.pubsub.topic.v1.messagePublished"`、attributes 與 envelope 一致性、嚴格 Base64）、遞迴鍵排序 Canonical JSON 序列化器、64 碼 SHA-256 雜湊契約、真正 Firestore Timestamp 之 `Clock` 介面（ProductionClock / FakeClock）。
   - 產出：純函式與型別模組，0 外部 I/O。
2. **G2 (`2026-09-24-stage-42-g2-outbox-publisher.md`)** - 共 4 項任務：
   - 核心：Firestore 交易內原子且冪等建立 `projectionOutbox`、Publisher 60s 租約認領、Fake Pub/Sub 發布、完成防護標記（Publisher Completion Fencing）、5 分鐘補償掃描。
   - 依賴：G1 型別、序列化器與 Clock。
3. **G3 (`2026-09-24-stage-42-g3-projection-worker.md`)** - 共 4 項任務：
   - 核心：CloudEvent 解包、`projectionOperations` 180s 租約狀態機、初次認領時建立 Erratum 1 `projectionSnapshot`（嚴格 Fail-Closed，無虛構填補值）、重複訊息 payloadHash 判定順序與 `rejectedDuplicateCount` 嚴格防護、寫入前 Firestore 權威租約再確認、Fake Sheets 12 欄 Search-and-Append、SUCCEEDED 時設定 90 天快照過期時間與錯誤分類。
   - 依賴：G1 契約、G2 Outbox 事件格式。
4. **G4 (`2026-09-24-stage-42-g4-dlq-reconciler.md`)** - 共 3 項任務：
   - 核心：死信傳輸解析（健全處理缺失值，不預設為 5）、當且僅當實際收到 DLQ 訊息時轉移為 `DEAD_LETTERED`、告警通知 Adapter。
   - 依賴：G1 事件定義、G3 狀態機。
5. **G5 (`2026-09-24-stage-42-g5-projection-reconciler.md`)** - 共 3 項任務：
   - 核心：`status == SUCCEEDED` 紀錄複合排序分頁掃描、Reconciler 專用租約（`reconciliationLeaseOwner`, `reconciliationLeaseExpiresAt`, `reconciliationClaimVersion`）、使用 `projectionSnapshot` 重建誤刪列（不變更 status 為 PROCESSING）、append 前 preWriteCheck 權威資料完整性重驗（attemptCount、hash、projectionKey、snapshot consistency）、雜湊不符轉 `MANUAL_REVIEW_REQUIRED`、90 天快照清除與 400 天 tombstone 修剪。
   - 依賴：G1 雜湊規範、G3 Sheets 寫入契約、Erratum 1 快照與 Reconciler 租約規範。
6. **G6 (`2026-09-24-stage-42-g6-pilot-config-integration.md`)** - 共 3 項任務：
   - 核心：宣告式環境配置校驗（`max-instances=1, concurrency=1, timeout=120s`）、完整 10 大 IAM 身分權限白名單驗證、端到端本地整合測試、真實 TC-01 至 TC-18 Acceptance Test Registry 與隔離式 Self-Check Runner。
   - 依賴：G1–G5 全量模組與測試套件。

---

## 2. 共享型別與介面權威來源 (Shared Types & Authority Source)

所有共享資料結構均統一定義於：
`allocation-assistant/contracts/projection-contract.js`

### 共享識別碼與欄位型別表：
| 欄位名稱 | 型別 | 權威格式規範 | 產生時間點 |
| :--- | :--- | :--- | :--- |
| `operationId` | `string` | `op_` + 24 碼英數字 | 核心業務交易發起時 |
| `eventId` | `string` | `evt_` + UUIDv4 | `projectionOutbox` 文件建立時（重發保持不變） |
| `publishAttemptId`| `string` | UUIDv4 | Publisher 每一次發布嘗試時（每次不同） |
| `publishedMessageId`| `string`| Pub/Sub message ID | Pub/Sub publish API 成功回傳時 |
| `projectionKey` | `string` | `PROJECTION_${operationId}` | 投影處理與試算表唯一主鍵 |
| `claimVersion` | `number` | 正整數，單調遞增（每次認領 +1） | Worker 取得租約時（Fencing Token） |
| `leaseOwner` | `string` | Worker 唯一實例識別碼 | Worker 取得租約時 |
| `leaseExpiresAt` | `Timestamp` | 真實 Firestore Timestamp 實例 | Worker 取得租約時 (`NOW + 180s`) |
| `reconciliationLeaseOwner` | `string` | Reconciler 唯一實例識別碼 | Reconciler 取得租約時 |
| `reconciliationLeaseExpiresAt` | `Timestamp` | 真實 Firestore Timestamp 實例 | Reconciler 取得租約時 (`NOW + 180s`) |
| `reconciliationClaimVersion` | `number` | 正整數，單調遞增（每次認領 +1） | Reconciler 取得租約時 (Fencing Token) |
| `payloadHash` | `string` | 完整 64 個十六進位小寫字元之 SHA-256 | Canonical JSON 序列化後計算 |

### 真實 Firestore Timestamp 之 Clock 介面規範：
```typescript
interface Clock {
  nowTimestamp(): FirebaseFirestore.Timestamp;
  nowMillis(): number;
}

class ProductionClock implements Clock {
  nowTimestamp(): FirebaseFirestore.Timestamp {
    const admin = require("firebase-admin");
    return admin.firestore.Timestamp.now();
  }
  nowMillis(): number {
    return this.nowTimestamp().toMillis();
  }
}

class FakeClock implements Clock {
  private currentMillis: number;
  constructor(initialMillis: number = Date.UTC(2026, 8, 24, 0, 0, 0)) {
    this.currentMillis = initialMillis;
  }
  nowTimestamp(): FirebaseFirestore.Timestamp {
    const admin = require("firebase-admin");
    return admin.firestore.Timestamp.fromMillis(this.currentMillis);
  }
  nowMillis(): number {
    return this.currentMillis;
  }
  advanceMillis(delta: number): void {
    this.currentMillis += delta;
  }
}
```

### Erratum 1 Projection Snapshot 規範：
```typescript
interface ProjectionSnapshot {
  reservationNumber: string;        // 預約單號 (來自 Envelope 根層級)
  eventType: string;                // 事件類型 (來自 Envelope 根層級)
  storeId: string;                  // 店家代號 (來自 Payload)
  productCode: string;              // 產品貨號 (來自 Payload)
  quantity: number;                 // 變更數量 (來自 Payload，大於 0 之有限正整數)
  pseudonymousActorId: string;      // 操作者假名代號 (來自 Envelope operator)
  occurredAt: string;               // 業務發生時間 (ISO8601 UTC)
  payloadHash: string;              // 完整 64 碼小寫 SHA-256
}
```

---

## 3. 階段進入與退出條件 (Entry & Exit Criteria)

| 階段 | 進入條件 (Entry Criteria) | 退出條件 (Exit Criteria) |
| :--- | :--- | :--- |
| **G1** | 本 Master Plan 與子計畫獲 Owner 核准；working tree clean。 | G1 單元測試 100% PASS；Canonical JSON、SHA-256 雜湊與真實 Timestamp FakeClock 比對無歧異。 |
| **G2** | G1 退出條件滿足；Firestore Emulator 連線可用。 | G2 單元與 Emulator 測試 100% PASS；Outbox 交易建立冪等、租約認領與 Publisher Completion Fencing 通過。 |
| **G3** | G2 退出條件滿足；Erratum 1 已納入規範。 | G3 測試 100% PASS；寫入前 Firestore 權威租約校驗、Fail-Closed Snapshot 建立、Search-and-Append 與 90 天快照過期設定通過。 |
| **G4** | G3 退出條件滿足。 | G4 測試 100% PASS；僅實際收到 DLQ 訊息方觸發 `DEAD_LETTERED` 驗證通過。 |
| **G5** | G3 退出條件滿足。 | G5 測試 100% PASS；使用 Reconciler 獨立租約修復誤刪列（不改核心 status）、複合分頁掃描與 90d/400d 保存修剪驗證通過。 |
| **G6** | G1 至 G5 退出條件全數滿足。 | TC-01 至 TC-18 真實 Test Registry 全數通過；完整 10 大 IAM 白名單通過；Dry Run 部署檢查 PASS；Context Gate PASS。 |

---

## 4. 建議 Commit 邊界 (Checkpoint Commit Strategy)

每一子計畫完成並驗證通過後，建議建立獨立 checkpoint commit（**執行前仍須遵守 Owner 獨立授權規範，本輪嚴禁自動 commit**）：

1. **G1 完成**: `test(projection): implement event contracts, canonical json hasher and clock abstraction`
2. **G2 完成**: `feat(projection): implement transactional outbox, publisher adapter and completion fencing`
3. **G3 完成**: `feat(projection): implement projection worker state machine, snapshot storage and sheet upsert`
4. **G4 完成**: `feat(projection): implement dlq reconciler and dead-letter handling`
5. **G5 完成**: `feat(projection): implement projection reconciler, dedicated lease and audit recovery`
6. **G6 完成**: `test(projection): integrate stage 42-f 18-case acceptance test registry and runner`

---

## 5. Stage 42-F TC-01 至 TC-18 真實驗收矩陣對照表 (Traceability Matrix)

所有 G1–G6 測試模組一律採用模組內函式直接引用模式（Pattern A: `async function testNamedCase() { ... }; module.exports = { tests: [{ id, name, run: testNamedCase }] }`），嚴格禁止在 registry run 中執行 self-require：

| 案例編號 | 規格書定義名稱 | 所屬子計畫 | 專屬測試模組 | Test Registry Export 名稱 |
| :---: | :--- | :---: | :--- | :--- |
| **TC-01** | Publish 成功但 PUBLISHED 更新前崩潰 | G2 | `tests/simulations/stage-42-g2-outbox-publisher.sim.js` | `TC-01: Publisher crash after publish preserves eventId and generates new publishAttemptId` |
| **TC-02** | Transport CloudEvent 解包驗證 | G1 | `tests/simulations/stage-42-g1-event-contracts.sim.js` | `TC-02: Transport CloudEvent unpacking decodes base64 application payload correctly` |
| **TC-03** | 相同訊息併發 Delivery (有效租約) | G3 | `tests/simulations/stage-42-g3-projection-worker.sim.js` | `TC-03: Duplicate message during active lease returns fixed ACK and zero sheet writes` |
| **TC-04** | 120s Timeout、180s Lease 與寫入前權威租約校驗 | G3 | `tests/simulations/stage-42-g3-projection-worker.sim.js` | `TC-04: Worker re-validates authoritative Firestore lease before Sheet API call fail-closed` |
| **TC-05** | PROCESSING Lease 過期接手 | G3 | `tests/simulations/stage-42-g3-projection-worker.sim.js` | `TC-05: Expired processing lease allows new worker takeover and increments claimVersion` |
| **TC-06** | 過期 Worker Fencing Token 被拒絕 | G3 | `tests/simulations/stage-42-g3-projection-worker.sim.js` | `TC-06: Stale worker with lower claimVersion is rejected during Firestore state finalization` |
| **TC-07** | 完整 64 碼 Payload Hash 衝突檢測 | G1 | `tests/simulations/stage-42-g1-event-contracts.sim.js` | `TC-07: Payload hash mismatch against full 64-char sha256 triggers MANUAL_REVIEW_REQUIRED` |
| **TC-08** | Sheet 成功但 Firestore 狀態更新失敗 | G3 | `tests/simulations/stage-42-g3-projection-worker.sim.js` | `TC-08: Crash after sheet write does not create duplicate row on subsequent retry` |
| **TC-09** | 不可重試錯誤處置 | G3 | `tests/simulations/stage-42-g3-projection-worker.sim.js` | `TC-09: Non-retryable error transitions to MANUAL_REVIEW_REQUIRED and returns ACK` |
| **TC-10** | Retryable Error 超過 5 次進 DLQ (本機宣告校驗) | G4 | `tests/simulations/stage-42-g4-dlq-reconciler.sim.js` | `TC-10: Pub/Sub approximate 5 delivery attempts routes message to DLQ subscription` |
| **TC-11** | DLQ Reconciler 更新 DEAD_LETTERED | G4 | `tests/simulations/stage-42-g4-dlq-reconciler.sim.js` | `TC-11: DLQ Reconciler updates projectionOperations to DEAD_LETTERED on actual receipt` |
| **TC-12** | 不支援的 schemaVersion | G1 | `tests/simulations/stage-42-g1-event-contracts.sim.js` | `TC-12: Unsupported schemaVersion fails closed before processing with zero writes` |
| **TC-13** | 稽核列遭人為刪除由 Reconciler 修復 | G5 | `tests/simulations/stage-42-g5-projection-reconciler.sim.js` | `TC-13: Projection Reconciler detects missing sheet row and rebuilds from projectionSnapshot` |
| **TC-14** | Outbox Reconciliation 重發安全性 | G2 | `tests/simulations/stage-42-g2-outbox-publisher.sim.js` | `TC-14: 5-minute outbox sweep safely republishes stale PENDING events using original eventId` |
| **TC-15** | Cloud Run Pilot 併發配置校驗 | G6 | `tests/simulations/stage-42-g6-pilot-config-integration.sim.js` | `TC-15: Pilot declarative configuration asserts max-instances=1, concurrency=1, timeout=120s` |
| **TC-16** | Trigger Identity 與 Runtime Identity 權限隔離 | G6 | `tests/simulations/stage-42-g6-pilot-config-integration.sim.js` | `TC-16: IAM policy assertion verifies Projection Worker SA does NOT possess roles/run.invoker` |
| **TC-17** | PII 與 Error Redaction | G1 | `tests/simulations/stage-42-g1-event-contracts.sim.js` | `TC-17: Structured payload and lastError contain no names, emails, LINE IDs, or secrets` |
| **TC-18** | Sheets 權限被拒 (403) | G3 | `tests/simulations/stage-42-g3-projection-worker.sim.js` | `TC-18: Google Sheets API 403 permission denied fails closed with SHEET_PERMISSION_DENIED` |

---

## 6. 回滾與停止條件 (Rollback & Stop Conditions)

1. **停止條件**：
   - 任何現有 59 個模擬測試套件（479 案例）發生回歸失敗。
   - `scripts/workbench-context-gate.sh --check` 回傳非 PASS。
   - 發現任一實作需求試圖發起未經授權的實體 GCP 資源建立或 Google Sheet 實體寫入。
   - 發現不同子計畫間對於 `operationId`、`eventId`、`claimVersion`、`payloadHash` 出現型別定義衝突。
2. **安全非破壞性回滾程序**：
   - **第一步**：立即停止所有執行中的指令與測試腳本。
   - **第二步**：執行並輸出工作區狀態：
     ```bash
     git status --short
     git diff --stat
     ```
   - **第三步**：**保留所有未提交內容供 Owner 審查**，絕不自動還原。
   - **第四步**：只有在 Owner 審查後明確指定特定檔案並授予修復授權時，方可進行受控調整。
   - **嚴格禁令**：**嚴格禁止執行未經授權之檔案重置、工作區清理或任何批次刪除命令**。

---

## 7. 最終整合驗收指令 (Master Acceptance Commands)

完成 G1 至 G6 所有任務後，執行以下完整驗收鏈條：

```bash
# 1. 執行 Context Gate 校驗
./scripts/workbench-context-gate.sh --check

# 2. 語法檢查
npm run check

# 3. 執行既有全量回歸測試 (保證 479/479 PASS)
npm run simulate:all

# 4. 執行 Stage 42-G 新增全量測試套件
npm run simulate:stage-42-g-all

# 5. 執行 Stage 42-F TC-01 至 TC-18 真實 Acceptance Runner (含隔離式 Self-Check)
npm run simulate:stage-42-f-acceptance

# 6. 執行後端與 LINE Bot 部署 Dry-Run 檢查
python3 deploy.py backend --check
python3 deploy.py line-bot --check

# 7. 工作區乾淨度檢查 (確認無未授權異動)
git status --short
```

---

## 8. Stage 42-G 執行任務全量清單 (Master Task Checklist)

本實作計畫涵蓋 6 大子計畫，共 19 項任務。每項任務均依據嚴格 TDD 規範拆分為 7 個明確步驟：

### G1: Event Contracts, Canonical JSON Hasher & True Timestamp Clock
- [ ] **G1-Task 1: Canonical JSON Serializer & 64-Character SHA-256 Hasher**
  - [ ] Step 1: 寫入單一明確失敗測試 (`tests/simulations/stage-42-g1-event-contracts.sim.js`)
  - [ ] Step 2: 執行並確認測試因尚未實作 `serializeCanonicalJson` / `computePayloadHash64` 失敗
  - [ ] Step 3: 寫入最小實作 (`allocation-assistant/contracts/projection-contract.js`)
  - [ ] Step 4: 執行並確認測試通過 (相同鍵順序、字串 canonicalization、遞迴檢驗、非 ASCII 排序、64 碼 regex)
  - [ ] Step 5: 執行 G1 子系統回歸測試 (`node tests/simulations/stage-42-g1-event-contracts.sim.js`)
  - [ ] Step 6: 執行全量既有回歸 (`npm run simulate:all`)
  - [ ] Step 7: 建議 commit checkpoint: `test(projection): implement canonical json serializer and 64-char hasher`
- [ ] **G1-Task 2: Application Projection Event Envelope Builder & True Timestamp Clock**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 Application Envelope 與 ProductionClock / FakeClock，驗證回傳真 Firestore Timestamp)
  - [ ] Step 2: 執行並確認測試因尚未實作 Envelope Builder 與 Clock 失敗
  - [ ] Step 3: 寫入最小實作 (以 admin.firestore.Timestamp 實作 Clock)
  - [ ] Step 4: 執行並確認測試通過 (驗證 eventId、operationId、Timestamp API 讀取、FakeClock advanceMillis)
  - [ ] Step 5: 執行 G1 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement application envelope builder and true timestamp clock`
- [ ] **G1-Task 3: Transport CloudEvent Unpacker & Base64 Decoder (TC-02)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-02 CloudEvent base64 payload 解包)
  - [ ] Step 2: 執行並確認測試因尚未實作 `unpackTransportCloudEvent` 失敗
  - [ ] Step 3: 寫入最小實作
  - [ ] Step 4: 執行並確認 TC-02 測試通過
  - [ ] Step 5: 執行 G1 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement transport cloudevent unpacker (TC-02)`
- [ ] **G1-Task 4: Schema Version Fail-Closed, Payload Hash Guard & PII Redaction (TC-07, TC-12, TC-17)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-07, TC-12, TC-17)
  - [ ] Step 2: 執行並確認測試因尚未實作合約驗證防護失敗
  - [ ] Step 3: 寫入最小實作
  - [ ] Step 4: 執行並確認 TC-07, TC-12, TC-17 全數通過
  - [ ] Step 5: 執行 G1 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement schema guard and pii redaction (TC-07, TC-12, TC-17)`

### G2: Transactional Outbox & Pub/Sub Publisher Adapter
- [ ] **G2-Task 1: Transactional Outbox Creator & In-Transaction Idempotency Guard**
  - [ ] Step 1: 寫入單一明確失敗測試 (Outbox 交易內建立、同 hash 重送沿用 eventId、異 hash 拋出 OUTBOX_IDEMPOTENCY_CONFLICT)
  - [ ] Step 2: 執行並確認測試因尚未實作 `stageProjectionOutboxInTransaction` 失敗
  - [ ] Step 3: 寫入最小實作 (`allocation-assistant/adapters/outbox-publisher-adapter.js`)
  - [ ] Step 4: 執行並確認測試通過
  - [ ] Step 5: 執行 G2 子系統回歸測試 (`node tests/simulations/stage-42-g2-outbox-publisher.sim.js`)
  - [ ] Step 6: 執行全量既有回歸 (`npm run simulate:all`)
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement transactional outbox creator and idempotency guard`
- [ ] **G2-Task 2: 60-Second Lease Claim Protocol with FakeClock**
  - [ ] Step 1: 寫入單一明確失敗測試 (驗證 Publisher 60s 租約認領、FakeClock 推進後過期接手)
  - [ ] Step 2: 執行並確認測試因尚未實作 `claimOutboxBatchForPublishing` 失敗
  - [ ] Step 3: 寫入最小實作
  - [ ] Step 4: 執行並確認測試通過 (使用 FakeClock 驗證到期租約更新)
  - [ ] Step 5: 執行 G2 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement outbox lease claim protocol with clock`
- [ ] **G2-Task 3: Pub/Sub Publisher Adapter Boundary & Completion Fencing (TC-01)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-01 崩潰重試與 markOutboxPublished 完成防護)
  - [ ] Step 2: 執行並確認測試因尚未實作發布完成防護失敗
  - [ ] Step 3: 寫入最小實作
  - [ ] Step 4: 執行並確認 TC-01 通過且租約失效時安全回傳 PUBLISH_LEASE_LOST
  - [ ] Step 5: 執行 G2 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement publisher adapter and completion fencing (TC-01)`
- [ ] **G2-Task 4: 5-Minute Outbox Reconciliation Sweep with FakeClock (TC-14)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-14 滯留 PENDING 補償發布與 FakeClock 推進)
  - [ ] Step 2: 執行並確認測試因尚未實作補償掃描失敗
  - [ ] Step 3: 寫入最小實作
  - [ ] Step 4: 執行並確認 TC-14 通過 (沿用原始 eventId 重發)
  - [ ] Step 5: 執行 G2 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement outbox reconciliation sweep (TC-14)`

### G3: Projection Worker State Machine & Sheets Client
- [ ] **G3-Task 1: Projection Operations State Claim, Fail-Closed Snapshot Storage & Fencing (TC-03, TC-05)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-03, TC-05, Erratum 1 projectionSnapshot 嚴格校驗且無虛構填補值、重送防覆蓋)
  - [ ] Step 2: 執行並確認測試因尚未實作 `claimProjectionOperation` 失敗
  - [ ] Step 3: 寫入最小實作 (`allocation-assistant/services/projection-worker-service.js`)
  - [ ] Step 4: 執行並確認 TC-03, TC-05 通過 (有效租約回傳固定 ACK 且 0 寫入，過期接手 claimVersion 遞增)
  - [ ] Step 5: 執行 G3 子系統回歸測試 (`node tests/simulations/stage-42-g3-projection-worker.sim.js`)
  - [ ] Step 6: 執行全量既有回歸 (`npm run simulate:all`)
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement worker claim lease, snapshot storage and fencing (TC-03, TC-05)`
- [ ] **G3-Task 2: Pre-Sheet-Write Authoritative Firestore Re-Validation with FakeClock (TC-04, TC-06)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-04, TC-06 四項條件校驗與過期拒絕)
  - [ ] Step 2: 執行並確認測試因尚未實作寫入前權威校驗失敗
  - [ ] Step 3: 寫入最小實作
  - [ ] Step 4: 執行並確認 TC-04, TC-06 通過 (使用 FakeClock 推進時間驗證 fail-closed)
  - [ ] Step 5: 執行 G3 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement pre-sheet-write authoritative check (TC-04, TC-06)`
- [ ] **G3-Task 3: Fake Google Sheets Client Adapter & Search-and-Append Engine (TC-08, TC-18)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-08 冪等追加、TC-18 403 拒絕、quantity 嚴格有限正整數 > 0 校驗)
  - [ ] Step 2: 執行並確認測試因尚未實作 Fake Sheets Client 與追加引擎失敗
  - [ ] Step 3: 寫入最小實作 (`tests/mocks/fake-google-sheets-client-adapter.js`)
  - [ ] Step 4: 執行並確認 TC-08, TC-18 通過
  - [ ] Step 5: 執行 G3 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement fake sheets adapter and search-and-append (TC-08, TC-18)`
- [ ] **G3-Task 4: Projection Finalization, Snapshot Expiry Setting & Error Taxonomy Dispatcher (TC-09)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-09 不可重試錯誤轉 MANUAL_REVIEW_REQUIRED、SUCCEEDED 時設定 completedAt + 90 天 projectionSnapshotExpiresAt)
  - [ ] Step 2: 執行並確認測試因尚未實作結案狀態機與錯誤分發失敗
  - [ ] Step 3: 寫入最小實作
  - [ ] Step 4: 執行並確認 TC-09 通過且過期時間戳記設定正確
  - [ ] Step 5: 執行 G3 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement projection finalization, snapshot expiry and error taxonomy (TC-09)`

### G4: DLQ Reconciler & Dead-Letter Handling
- [ ] **G4-Task 1: DLQ Transport Message Parser & Delivery Attempt Assessor (TC-10)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-10 宣告式 dead-letter policy 設定為 5、parser 接受 deliveryAttempt 缺失保存 null)
  - [ ] Step 2: 執行並確認測試因尚未實作 DLQ 訊息解析器失敗
  - [ ] Step 3: 寫入最小實作 (`allocation-assistant/adapters/dlq-reconciler-adapter.js`)
  - [ ] Step 4: 執行並確認 TC-10 通過 (缺失保存 null，不預設為 5)
  - [ ] Step 5: 執行 G4 子系統回歸測試 (`node tests/simulations/stage-42-g4-dlq-reconciler.sim.js`)
  - [ ] Step 6: 執行全量既有回歸 (`npm run simulate:all`)
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement dlq message parser (TC-10)`
- [ ] **G4-Task 2: Firestore State Transition to DEAD_LETTERED on Actual DLQ Receipt (TC-11)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-11 當且僅當實際收到 DLQ 訊息時才轉移 DEAD_LETTERED)
  - [ ] Step 2: 執行並確認測試因尚未實作死信狀態轉移失敗
  - [ ] Step 3: 寫入最小實作
  - [ ] Step 4: 執行並確認 TC-11 通過
  - [ ] Step 5: 執行 G4 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement dead-lettered state transition (TC-11)`
- [ ] **G4-Task 3: Alerting Adapter & Notification Dispatcher**
  - [ ] Step 1: 寫入單一明確失敗測試 (驗證 FakeAlertingAdapter 派送 P1 警報且內容完成 Redaction)
  - [ ] Step 2: 執行並確認測試因尚未實作告警配接器失敗
  - [ ] Step 3: 寫入最小實作 (`tests/mocks/fake-alerting-adapter.js`)
  - [ ] Step 4: 執行並確認測試通過
  - [ ] Step 5: 執行 G4 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement alerting adapter and notification dispatcher`

### G5: Projection Reconciler & Dedicated Lease Recovery
- [ ] **G5-Task 1: Stable Compound Ordering Bounded Scan for Succeeded Operations**
  - [ ] Step 1: 寫入單一明確失敗測試 (複合排序 orderBy completedAt + documentId、多筆同時間不漏資料、邊界分頁校驗)
  - [ ] Step 2: 執行並確認測試因尚未實作穩定分頁掃描失敗
  - [ ] Step 3: 寫入最小實作 (`allocation-assistant/adapters/projection-reconciler-adapter.js`)
  - [ ] Step 4: 執行並確認測試通過
  - [ ] Step 5: 執行 G5 子系統回歸測試 (`node tests/simulations/stage-42-g5-projection-reconciler.sim.js`)
  - [ ] Step 6: 執行全量既有回歸 (`npm run simulate:all`)
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement stable compound ordering bounded scan`
- [ ] **G5-Task 2: Authoritative Sheet Row Verification & Recovery from Projection Snapshot via Dedicated Lease (TC-13)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-13 誤刪列修復，使用 Reconciler 專用租約：先認領租約 -> 權威讀取 -> 查 Sheet -> 寫入前再校驗 -> 追加 -> 條件式釋放；核心 status 維持 SUCCEEDED、僅使用 5 項權威來源、不讀 Outbox、兩個 Reconciler 併發互斥)
  - [ ] Step 2: 執行並確認測試因尚未實作專用租約修復引擎失敗
  - [ ] Step 3: 寫入最小實作
  - [ ] Step 4: 執行並確認 TC-13 通過 (專用租約保護下重建 12 欄且至多追加一列)
  - [ ] Step 5: 執行 G5 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement sheet row recovery from snapshot with dedicated lease (TC-13)`
- [ ] **G5-Task 3: Retention Policy Engine with FakeClock (90d Snapshot & 400d Tombstone Pruning)**
  - [ ] Step 1: 寫入單一明確失敗測試 (90 天清除 projectionSnapshot、400 天修剪為 Tombstone，使用 FakeClock 推進)
  - [ ] Step 2: 執行並確認測試因尚未實作保存修剪引擎失敗
  - [ ] Step 3: 寫入最小實作
  - [ ] Step 4: 執行並確認測試通過 (驗證快照清空與 Tombstone 最小結構)
  - [ ] Step 5: 執行 G5 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement snapshot expiration and tombstone pruning`

### G6: Pilot Config, Full 10-Role IAM Allowlist, and Acceptance Test Runner
- [ ] **G6-Task 1: Declarative Pilot Configuration & Full 10-Role IAM Allowlist Validation (TC-15, TC-16)**
  - [ ] Step 1: 寫入單一明確失敗測試 (涵蓋 TC-15 併發 1、TC-16 完整 10 大身分角色白名單與精確 resource scope 驗證：Pub/Sub 系統代理包含 publisher 及 subscriber 權限，移除 tokenCreator，獨立 Sheets OAuth 與 ACL)
  - [ ] Step 2: 執行並確認測試因尚未實作部署與 10 身分 IAM 校驗器失敗
  - [ ] Step 3: 寫入最小實作 (`allocation-assistant/validators/pilot-deployment-validator.js`)
  - [ ] Step 4: 執行並確認 TC-15, TC-16 通過
  - [ ] Step 5: 執行 G6 子系統回歸測試 (`node tests/simulations/stage-42-g6-pilot-config-integration.sim.js`)
  - [ ] Step 6: 執行全量既有回歸 (`npm run simulate:all`)
  - [ ] Step 7: 建議 commit checkpoint: `feat(projection): implement pilot config and full 10-role iam allowlist validator (TC-15, TC-16)`
- [ ] **G6-Task 2: Full End-to-End Local Simulation Integration**
  - [ ] Step 1: 寫入單一明確失敗測試 (全鏈條本機模擬：Outbox -> Pub/Sub -> CloudEvent -> Worker -> Sheet -> SUCCEEDED)
  - [ ] Step 2: 執行並確認測試因串接驗證失敗
  - [ ] Step 3: 寫入最小實作 (串接 G1 至 G5 模組)
  - [ ] Step 4: 執行並確認全鏈條本機整合測試通過
  - [ ] Step 5: 執行 G6 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸
  - [ ] Step 7: 建議 commit checkpoint: `test(projection): implement full end-to-end local simulation pipeline`
- [ ] **G6-Task 3: Real Acceptance Test Registry Aggregator & Runner with Isolated Failure Injection Self-Check**
  - [ ] Step 1: 寫入單一明確失敗測試 (匯入 G1–G6 test registry、逐一執行 run、包含以獨立 stub registry 進行 runner failure self-check)
  - [ ] Step 2: 執行並確認測試因尚未實作真實驗收調度器失敗
  - [ ] Step 3: 寫入最小實作 (`tests/simulations/stage-42-f-acceptance-suite.sim.js`)
  - [ ] Step 4: 執行並確認 TC-01 至 TC-18 全數真實執行且通過，獨立 stub 注入失敗亦成功被捕捉
  - [ ] Step 5: 執行 G6 子系統回歸測試
  - [ ] Step 6: 執行全量既有回歸 (`npm run simulate:all`)
  - [ ] Step 7: 建議 commit checkpoint: `test(projection): integrate stage 42-f 18-case acceptance test registry and runner`
