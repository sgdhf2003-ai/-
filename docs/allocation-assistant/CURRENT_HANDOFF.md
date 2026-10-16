# JYAI Allocation Assistant - CURRENT HANDOFF

## 1. 專案基線狀態 (Project Baseline)
* **交接日期**: 2026-10-16
* **執行目錄**: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
* **目前分支**: `main`
* **Latest Feature Commit**: `846e68804d6654e219205f05b3ec9be563e1fb10` (`docs: close Stage 42-E projection worker contract`)
* **Metadata Sync Commit**: `564cd92c3b0411840722cfbe78b4fa68e29623be` (`feat(projection): implement stage 42-g3 projection worker and sheets client`)
* **分支關係**: `0 ahead / 0 behind` (完全同步)
* **Working Tree 狀態**: Stage 42-G4 DLQ Reconciler & Dead-Letter Handling local commit authorized; git push, deploy, G5–G6 NOT AUTHORIZED.

## 2. 本次完成內容 (Completed Work)
* 完成 Stage 30 & 31 生產環境 Google Sheet 劃扣與出貨生命週期驗證 (`RES-20260801-001`, `RES-20260801-002`)。
* 完成 Stage 32 建立生產環境 Standard Operating Procedure (`docs/allocation-assistant/OPERATING_SOP.md`)。
* 完成 Stage 33-C 伺服端角色權限防護層 (`30ea9cc`) 與 Stage 33-E 讀回遮蔽合約 (`8ddac76`)。
* 完成 Stage 34 角色權限 UI 控制項渲染 (`9eb9f85`) 與 Stage 35 操作處理器接線 (`fa6b873`)。
* 完成 Stage 36 生產環境劃扣作業讀回與受控整合套件 (`d697cfb`)。
* 完成 Stage 37 部署與驗證里程碑 (`3879b58`)：Web App Version 97 部署與受控 Sheet 寫入證明 (`RES-20260802-TEST01` -> `TEST_CLEANUP_DELETED`)。
* 完成 Stage 38 管理員作業流程 UI 端點整合與 Version 98 受控部署 (`8f292db`, `0f7ec24`)。
* 完成 Stage 39 業務助理日常作業流程準備度審查 (`4b2f5f4`): 準備度審查評定為 **PASS**。
* 完成 Stage 40 Owner 監督受控生產試辦營運驗證 (`40416f1`): Pilot 4 / 4 Steps 完好通過 (`RES-20260802-PILOT01` -> `CANCELLED`)。
* 完成 Stage 41 受控生產批次營運與人員導入驗證 (`8b53044`): 3 筆真實單據處理與驗證完好通過。
* 完成 Stage 42 生產環境常態監控執行與每日健康簽核 (`6536987`): 端點 HTTP 200 OK，IDParity/Schema/Arithmetic/Redaction 全數 PASS。
* 完成 Stage 43 配貨助手日常作業全流程階段總結與合約關閉 (`4f9b5a8`): 階段結算完成。
* 完成 Phase 4 受控 LINE 客戶通知試辦程式碼實作與 Version 99 部署 (`0983402`, `c593f6e`)。
* 完成 Stage 45 常態營運監控與健康審查 (PASS - 212/212 PASS)。
* 完成 Phase 5 受控單一對象 LINE 通知試辦執行與安全驗證 (`f2364a8`, `4468ab0`)。
* 完成 Phase 6-A 多批次銷扣出貨算術核對與 7 欄位 Ledger Schema 驗證套件 (`be95249`, 220/220 PASS)。
* 完成 Phase 6-C 端點動作分發器整合套件 (`7dd7ed0`, 225/225 PASS)。
* 完成 Phase 6-E Apps Script 後端端點處理器接線套件 (`05ebafa`, 228/228 PASS)。
* 完成 Phase 6-F Backend Web App Version 100 受控部署與驗證 (`93e8cb4`, HTTP 200 OK, 100 剩餘版本空間)。
* 完成 Phase 6-G 生產環境唯讀合約驗證 (`adcc02a`, HTTP 200 Health Ping, `INVALID_SESSION_USER` Fail-Closed, `readbackRedacted: true` 脫敏驗證 100% PASS)。
* 完成 Phase 7-C 管理員作業 UI 控制面板實作與 TDD 驗證 (`56a5976`, 233/233 PASS)。
* 完成 Phase 8-D 生產環境受控劃扣與銷扣出貨 Pilot 實測 (`RES-20260805-PILOT88` 4-Step 100% PASS)。
* 完成 Stage 35 配貨與出貨單一鏈條連貫垂直切片驗證 (`RES-20260806-CHAIN35`, 234/234 PASS)。
* 完成生產環境讀回合約修復 (`a4f5d23`, 不存在單號傳回 `found: false` & `record: null`；缺失 Adapter 傳回 `READBACK_ADAPTER_MISSING` Fail-Closed, 236/236 PASS)。
* 完成 Backend Web App **Version 122** 與 LINE Bot **Version 4** 常態健康與邊界維護 (本輪文件與合約實作零部署變更，依據 clasp deployments 實體查核確認線上指向)。
* 完成 Stage 42 LINE 身份解析合約加固與測試環境部署驗證 (`fd67b58`, 255/255 PASS, 歷史測試部署；正式基線依 clasp deployments 實體驗證為 Backend Version 122, LINE Bot Version 4)。
* 完成 Stage 38 Daily Operations Standing Health Monitoring & Maintenance Gate 文件收束與 Fail-Closed 防護驗證 (`2b07526`, 52 Suites, 345/345 PASS, 無 Adapter 均安全傳回 `CANCEL_TRANSACTION_ADAPTER_MISSING` / `CANCEL_TRANSACTION_INCOMPLETE` 0 寫入)。
* 完成 Stage 39 Allocation Production Contract Gate 文件收束與生產合約驗證 (`2b07526`, 即時對帳 6/6 PASS, 準備度診斷 10/10 PASS, 生產 Sheet Adapter 11/11 PASS, 端點分發器 16/16 PASS)。
* 完成 Stage 40 Security and Permission Closure Gate 文件收束與安全權限驗證 (角色權限 7/7 PASS, 身份整合 9/9 PASS, 登入綁定 6/6 PASS, 安全 Push 6/6 PASS, 入口邊界 3/3 PASS)。
* 完成 Stage 41 Security & Permission Final Regression & Release Gate 文件收束與全量驗證 (全量 52 個測試套件 345/345 PASS, 部署 Dry Run VALID)。
* 完成 Stage 42-D Firestore Emulator ACID Integration 文件收束與本機 Emulator ACID 交易驗證 (`2eeac70`, Real Emulator 7/7 PASS, Local Adapter 19/19 PASS, Formal Transaction Contract 6/6 PASS, 全量 54 個測試套件 371/371 PASS)。
* 完成 Stage 42-E Phase 1 Projection Worker Isolation & Idempotency Contract 文件收束與本機 Worker 隔離合約驗證 (`da11d2b`, 7/7 PASS, 全量 55 個測試套件 378/378 PASS)。
* 完成 Stage 42-E Phase 2 Projection Worker Architecture & Security Audit 唯讀審查紀錄 (Audit Complete; Formal Worker NOT IMPLEMENTED; Production Readiness NOT APPROVED)。
* 完成 Stage 42-F 正式 Projection Worker 架構規格書核准備查與 Erratum 1 (`docs/stages/stage-42-f-formal-projection-worker-architecture-spec.md`，狀態：`APPROVED WITH ERRATUM 1`；包含 projectionSnapshot 與 projectionSnapshotExpiresAt 權威重建來源，Fail-Closed 校驗嚴禁 "N/A"、"USR_ANONYMOUS" 或 0 偽造，Reconciler 專屬租約與 10 大併發規則)。
* 完成 Stage 42-G TDD 測試先行實作計畫套件修訂與核准 (`docs/superpowers/plans/`，涵蓋 Master Plan 與 G1-G6 六大子計畫，共 19 項任務均拆解為 7 個明確步驟，實作真實 Firestore Timestamp Clock 抽象、真實 Acceptance Test Registry、完整 10 大 IAM 身分角色白名單、隔離 Stub 自我校驗、非破壞性回滾與 transport contract micro-patch；狀態：`TDD IMPLEMENTATION PLANS APPROVED — IMPLEMENTATION NOT STARTED`；Implementation Authorization: `NOT AUTHORIZED`；Next Step: `Stage 42-G implementation awaits separate Owner authorization`；規格與計畫核准不等於程式實作授權；不得建立 GCP 資源或執行部署；Stage 42-H Pilot 仍需獨立 Owner 授權；正式營運表保持 0 修改)。
* 完成 Stage 42-G1 Event Contracts TDD 測試先行實作、阻礙修正與治理文件一致性校驗 (`allocation-assistant/contracts/projection-contract.js` 與 `tests/simulations/stage-42-g1-event-contracts.sim.js`，包含真 Unicode code-point 字典排序區分 U+E000 與 U+10000、64 碼 SHA-256 雜湊、Fatal UTF-8 解碼器防範、未 monkey-patch 之 Firestore modular Timestamp Clock 抽象、完整 schemaVersion 1.0.0 Application Envelope 建構與雙向一致性校驗、包含 eventId UUIDv4/occurredAt/traceId/projectionKey、operator 脫敏與 payload 嚴格 schema 拒絕額外欄位之 Fail-Closed 守衛、循環引用與過深結構安全脫敏日誌；24/24 G1 模擬測試 PASS；全量 60 Suites, 503/503 PASS；G1 測試 Registry 獨立直接執行驗證 PASS；dry-run deploy 檢查 PASS；已於 `25e75df` commit 與 push)。
* 完成 Stage 42-G2 Transactional Outbox & Publisher TDD 測試先行實作與本地模擬驗證，並經 Owner 正式追認承認 commit 17bde3215440f0ce805b04a2af7e56091db2a18e (`allocation-assistant/adapters/outbox-publisher-adapter.js`, `tests/mocks/fake-pubsub-client-adapter.js`, `tests/simulations/stage-42-g2-outbox-publisher.sim.js`，包含 Firestore 交易內原子且冪等建立 `projectionOutbox`、相同 hash 沿用 `eventId` 0 寫入、異 hash 拋出 `OUTBOX_IDEMPOTENCY_CONFLICT` fail-closed、交易 abort 保證 0 寫入、`claimOutboxBatchForPublishing` 原子認領 60 秒發布租約與 FakeClock 推進超時接手、`publishOutboxBatch` 發布至 FakePubSubClientAdapter、`markOutboxPublished` Completion Fencing 驗證租約擁有權與到期時間、以及 `reconcileOutboxPendingBatch` 每 5 分鐘補償掃描滯留超過 2 分鐘 PENDING 紀錄安全補發；18/18 G2 模擬測試 PASS；全量 61 Suites, 521/521 PASS；G2 測試 Registry 獨立直接執行驗證 PASS；狀態：`COMMITTED AND OWNER-RATIFIED`；G3–G6 尚未開始且未獲授權)。
* 完成 Stage 42-G3 Projection Worker State Machine & Sheets Client 授權修正、模擬器/專案環境守衛加固與全量驗證 (`allocation-assistant/services/projection-worker-service.js`, `tests/mocks/fake-google-sheets-client-adapter.js`, `tests/simulations/stage-42-g3-projection-worker.sim.js`，全面採用規範之 `RETRYABLE_FAILED` 列舉、包含獨立檢查 `GCLOUD_PROJECT` 與 `GOOGLE_CLOUD_PROJECT` 防止 shadowing、127.0.0.1:8080 fail-closed 守衛、`validateAndExtractProjectionSnapshot` 嚴格校驗且拒絕虛構值、`claimProjectionOperation` 180 秒分散式租約認領與 Erratum 1 `projectionSnapshot` 快照原子持久化、重複 delivery 防破壞機制不覆蓋快照與狀態、`verifyAuthoritativeLeaseBeforeSheetWrite` 寫入前 4 條件權威租約校驗、`FakeGoogleSheetsClientAdapter` 12 欄物理結構 Search-and-Append 引擎與 hash 不符拋出 `PAYLOAD_HASH_MISMATCH` fail-closed、`finalizeProjectionSuccess` 成功結案與 6 條件 fencing 及 90 天快照到期時間設定、以及 `handleProjectionError` 可重試與不可重試錯誤分類處置與日誌脫敏；23/23 G3 模擬測試 PASS；全量 62 Suites, 544/544 PASS；G3 測試 Registry 獨立直接執行驗證 PASS；已於 `564cd92` commit 與 push；G4–G6 尚未開始且未獲授權)。
* 完成 Stage 42-G4 DLQ Reconciler & Dead-Letter Handling TDD 實作、fail-closed 防護加固、異常告警合約校正、告警結案/redelivery 跨派發身份加固與異常訊息 Payload Identity 校正驗證 (`allocation-assistant/adapters/dlq-reconciler-adapter.js`, `tests/mocks/fake-alerting-adapter.js`, `tests/simulations/stage-42-g4-dlq-reconciler.sim.js`，包含宣告式死信政策校驗 `maxDeliveryAttempts === 5`、Eventarc CloudEvent 雙層嚴格解包重用 G1 fatal UTF-8 TextDecoder；權威身分 fail-closed 校驗 `operationId`、`eventId`、`payloadHash` 全量驗證（`payloadHash` 必須為 256 位元／64 碼小寫十六進位 SHA-256）；合法狀態白名單嚴格限制僅 `PENDING`、`PROCESSING`、`RETRYABLE_FAILED` 可轉入 `DEAD_LETTERED`、損壞/未知狀態 0 狀態變更 fail-closed 拒絕；終態保護機制：`SUCCEEDED` 與 `MANUAL_REVIEW_REQUIRED` 絕對嚴禁降級或覆蓋回傳固定 ACK、重複 `DEAD_LETTERED` 冪等防護跳過 0 狀態更動、Fencing 租約撤銷清除 `leaseOwner` 與 `leaseExpiresAt`；二階段狀態轉移與 256 位元／64 碼小寫十六進位 SHA-256 確定性去重金鑰生成、交易 commit 後派發脫敏告警；告警結案路徑嚴格僅允許一般 `DEAD_LETTERED` 與 `RETRY_ALERT_PENDING` 進入 Firestore 結案交易，異常告警絕不執行 Firestore 結案寫入；`RETRY_ALERT_PENDING` 嚴禁未持久化之 fallback key，缺少 stored key 即 fail-closed `ack: false`；跨 Active Mismatch 重新派送保持告警身份：初次 active mismatch 轉入 `MANUAL_REVIEW_REQUIRED` 時持久化保存 `anomalyAlertIdempotencyKey`、`anomalyAlertReasonCode`、`anomalyAlertEventId` 與 `anomalyAlertPayloadHash`（256 位元／64 碼小寫十六進位 SHA-256），不覆寫 authoritative payloadHash 或 projectionSnapshot；依 doc(operationId) 定位文件後，只有當訊息之 eventId 與 payloadHash 與先前持久化之 anomalyAlertEventId 及 anomalyAlertPayloadHash 完全一致時才重用原告警 key（重送分支不額外進行未實作的 operationId 欄位檢查）；相同 eventId 但不同 payloadHash 保持終態 0 mutation 並以包含訊息 payloadHash 之確定性 key（256 位元／64 碼小寫十六進位 SHA-256）派發獨立 `PAYLOAD_CONTENT_CONFLICT` 內容衝突告警，相同衝突內容再次重送依同 key 去重；舊文件缺少異常 payloadHash 時保守處理維持 0 mutation 且不誤判為同異常；告警暫時失敗重試 key 維持穩定；已完成驗證：43/43 G4 模擬測試 PASS；全量 63 Suites, 587/587 PASS；G4 測試 Registry 依序直接執行驗證 PASS；狀態：`STAGE 42-G4 LOCAL COMMIT AUTHORIZED`；git push=0、deploy=0、G5–G6 未獲授權）。
* 本機檢查、全量模擬測試與部署 Dry Run 全數通過（沿用已完成之 `npm run simulate:all` 63 Suites, 587/587 PASS 證據，本輪執行靜態語法與 context gate 檢查；`python3 deploy.py backend --check`, `python3 deploy.py line-bot --check` PASS）。

## 3. 未完成內容與未啟用功能 (Deactivated Features)
* LINE API 主動 Push/Send 維持關閉 (`notificationBypassed: true`)。
* 尚未在 PWA 前端開放實體使用者按鈕入口。

## 4. 已知風險 (Known Risks)
* **系統帳差**: Google Sheets 中的庫存水位與現場實體庫存可能存在延遲，需加強人工覆核宣導。
* **混批限制**: 現場操作人員如未經確認即混合批號出貨，可能導致客戶退貨。

## 5. 安全聲明 (Safety Declaration)
> [!IMPORTANT]
> 本次交接確無未授權之 LINE 機器人發送通知、無 OneSignal 警報、無真實庫存銷扣損壞。所有安全性防護邊界、Server-Side Role Guard 與 UI 角色防護控制項均完好。

## 6. 下一個精確步驟 (Next Recommended Step)
* **Stage 42-G4 local commit authorized — execute local commit; git push, deploy, Stage 42-G5/G6 remain NOT AUTHORIZED.** (規格與計畫核准不等於程式實作授權；不得建立 GCP 資源或執行部署；Stage 42-H Pilot 仍需獨立 Owner 授權；正式營運表保持 0 修改)。

## 7. 禁止下一位 Agent 自行執行的事項 (Prohibited Actions)
* 嚴禁在未經 Owner 審查同意前進行未授權之 Google Sheet 寫入。
* 嚴禁自行部署 backend 或 line-bot 至生產環境。
* 嚴禁繞過 Gateway 直接發送 LINE 提醒。
