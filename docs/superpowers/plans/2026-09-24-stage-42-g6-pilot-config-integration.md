# Stage 42-G6 Pilot Config, IAM Trigger Separation, and End-to-End Integration Verification Implementation Plan

> For agentic workers:
> REQUIRED SUB-SKILL: use executing-plans or an equivalent task-by-task execution workflow. Do not implement tasks in parallel when they modify shared event schemas or Firestore state contracts.

Goal:
實作宣告式 Pilot 環境部署配置校驗、完整 10 大 IAM 身分權限白名單驗證器（完全移除無授權之 Secret Manager 相關存取角色，杜絕萬用字元），以及貫穿 Stage 42-F TC-01 至 TC-18 的真實 Acceptance Test Registry 與 Runner，包含注入失敗測試之隔離自我校驗。

Architecture:
依據 Stage 42-F 第 11 章（部署架構）、第 13 章（IAM 最小權限）與第 16 章（測試矩陣）規範：
1. 宣告式 Pilot 配置校驗器（`validatePilotDeploymentConfig`）負責靜態校驗 Cloud Run 配置參數（`maxInstances = 1`, `concurrency = 1`, `timeoutSeconds = 120`），阻止高併發與不安全設定。
2. IAM 身分權限白名單校驗器（`validateFullIamRoleAllowlist`）驗證系統中全部 10 大身分之精確資源範圍授權白名單（`identity -> [{ role, resource }]`），嚴格禁止 `roles/secretmanager.*` 與萬用字元：
   - 5 個 Runtime SA：
     1. Transaction Writer SA: `roles/datastore.user` (resource: `projects/PROJECT_ID`)
     2. Outbox Publisher SA: `roles/datastore.user` (resource: `projects/PROJECT_ID`), `roles/pubsub.publisher` (僅限 topic: `projects/PROJECT_ID/topics/jy-reservation-events`)
     3. Projection Worker SA: `roles/datastore.user` (resource: `projects/PROJECT_ID`)（**嚴禁** `roles/run.invoker`、無 Sheets IAM 角色、絕無 Secret Manager）
     4. DLQ Reconciler SA: `roles/datastore.user` (resource: `projects/PROJECT_ID`)
     5. Projection Reconciler SA: `roles/datastore.user` (resource: `projects/PROJECT_ID`)
   - 4 個 Trigger SA：
     6. Firestore Eventarc Trigger SA: `roles/eventarc.eventReceiver` (resource: `projects/PROJECT_ID`), `roles/run.invoker` (僅限 service: `jy-outbox-publisher`)
     7. Pub/Sub Eventarc Trigger SA: `roles/eventarc.eventReceiver` (resource: `projects/PROJECT_ID`), `roles/run.invoker` (僅限 service: `jy-projection-worker`)
     8. DLQ Eventarc Trigger SA: `roles/eventarc.eventReceiver` (resource: `projects/PROJECT_ID`), `roles/run.invoker` (僅限 service: `jy-dlq-reconciler`)
     9. Scheduler Invoker SA: `roles/run.invoker` (僅限 reconciliation services: `projects/PROJECT_ID/locations/asia-east1/services/jy-outbox-publisher` 與 `projects/PROJECT_ID/locations/asia-east1/services/jy-projection-reconciler`)
   - 1 個 System SA：
     10. Pub/Sub Service Agent: `roles/pubsub.publisher` (僅限 topic: `projects/PROJECT_ID/topics/jy-reservation-events-dlq`), `roles/pubsub.subscriber` (僅限 subscription: `projects/PROJECT_ID/subscriptions/jy-reservation-events-sub`)。未經 Owner Change Request 嚴禁無條件加入 `roles/iam.serviceAccountTokenCreator`。
   - 獨立設定驗證：Projection Worker 與 Projection Reconciler 之 Google Sheets OAuth scope (`https://www.googleapis.com/auth/spreadsheets`) 與稽核表 Editor ACL 必須以獨立應用層配置驗證，絕不假裝成 IAM role。
3. 全量端到端模擬整合套件（`runStage42FAcceptanceSuite`）匯入 G1 至 G6 所有 test registry，動態合併並校驗 TC-01 至 TC-18 嚴格一一映射（無缺失、無重複），逐一 `await test.run()` 真實執行，無例外完成方標記 PASS，並透過隔離 Stub Registry 進行失敗注入自我校驗。

Tech Stack:
- 執行環境：Node.js 20+ (CommonJS)
- 模擬器與資料庫：Firestore Emulator (`127.0.0.1:8080`), `firebase-admin ^14.3.0`
- 時間抽象：`Clock` 介面（測試注入 `createFakeClock()`）
- 模擬介面：`FakePubSubClientAdapter`, `FakeGoogleSheetsClientAdapter`, `FakeAlertingAdapter`
- 測試套件：Node.js 原生 `assert` 輕量化模擬測試

Spec:
docs/stages/stage-42-f-formal-projection-worker-architecture-spec.md (含 Erratum 1)

Global Constraints:
1. 嚴禁任何實體 GCP 資源建立、IAM Policy 變更或向外部網路呼叫。
2. 宣告式配置校驗器僅針對靜態設定物件進行驗證，不發送 gcloud/REST 請求。
3. 整合驗收套件必須能於無外網環境完整執行，全數依賴已實作之 Fake 配接器與本地 Emulator。
4. 全量驗收必須動態調度並真實執行 TC-01 至 TC-18 的 `test.run()`，嚴格禁止以常數形式 hard-code passedCases 或任何假陽性標記。
5. 必須確保既有 59 個模擬測試套件（479 案例）零回歸、Context Gate PASS、`deploy.py` 檢查 PASS。

Review Focus:
1. TC-15 是否確實攔截 `concurrency > 1`、`maxInstances > 1` 或 `timeoutSeconds != 120` 之不合法配置。
2. TC-16 是否完整檢查 10 大身分之精確資源範圍 IAM 白名單（`identity -> [{ role, resource }]`）、Sheet OAuth scope、Editor ACL，且確認無任何未授權角色、Secret Manager 角色或第 11 個未知身分。
3. Stage 42-F Acceptance Runner 是否逐一 `await test.run()`，且在任一測試拋出例外時正確標記失敗並回傳 exitCode 1。
4. 自我驗證：在隔離 stub test 注入 failure 時，Acceptance Runner 是否確實判定為 FAIL。
5. 現有專案之部署腳本與 Context Gate 是否維持 100% 綠燈。

---

## Tasks

### Task 1: Declarative Pilot Configuration & Full 10-Identity Resource-Scoped IAM Allowlist Validation (TC-15, TC-16)
- **Create / Modify / Test 路徑**:
  - Create: `allocation-assistant/validators/pilot-deployment-validator.js`
  - Create: `tests/simulations/stage-42-g6-pilot-config-integration.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `package.json`: 註冊 `simulate:stage-42-g6-pilot-config-integration` 測試腳本。
- **Consumes / Produces 介面**:
  - Consumes: Cloud Run 配置宣告物件、10 大身分之資源範圍 IAM 綁定清單物件 (`identity -> [{ role, resource }]`)、獨立 Google Sheets OAuth 與 ACL 配置物件。
  - Produces: 驗證通過布林值；若違規拋出描述明確之 `Error`。
- **精確函式名稱**:
  - `validatePilotDeploymentConfig(config: object): { valid: boolean, errors: string[] }`
  - `validateFullIamRoleAllowlist(bindings: object, appConfigs?: object): { valid: boolean, violations: string[] }`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-15, TC-16)**
    撰寫測試：
    1. TC-15：驗證合規 Pilot 配置通過；攔截 `concurrency > 1`、`maxInstances > 1` 或 `timeoutSeconds != 120`。
    2. TC-16：驗證完整 10 大身分（5 Runtime, 4 Trigger, 1 System）之精確資源範圍授權白名單（`role + resource`）：
       - Runtime SA 的 `roles/datastore.user` 資源層級精確為 `projects/PROJECT_ID`（database 不是有效直接 grant scope）。
       - Outbox Publisher 的 `roles/pubsub.publisher` 僅限 `projects/PROJECT_ID/topics/jy-reservation-events`。
       - 3 個 Trigger SA 的 `roles/run.invoker` 各自僅限指定 Cloud Run service。
       - Scheduler Invoker 的 `roles/run.invoker` 僅限指定 reconciliation services（`jy-outbox-publisher` 與 `jy-projection-reconciler`）。
       - Pub/Sub Service Agent 必須包含 `roles/pubsub.publisher`（僅限 DLQ topic）與 `roles/pubsub.subscriber`（僅限來源 subscription），未經 Change Request 嚴禁無條件包含 `tokenCreator`。
       - 僅精確允許 `roles/datastore.user` 與 `roles/eventarc.eventReceiver` 使用 project scope（`projects/PROJECT_ID`），攔截其他任何角色使用 project-wide scope，並全域禁止萬用字元 `*`。
       - 攔截未知的第 11 個 identity。
       - 攔截已知 identity 出現額外角色或 Secret Manager 角色。
       - 獨立驗證 Projection Worker 與 Projection Reconciler 的 Sheets OAuth scope 與獨立稽核表 Editor ACL。
       - 攔截 Projection Worker runtime SA 持有 `roles/run.invoker`。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行 `node tests/simulations/stage-42-g6-pilot-config-integration.sim.js`，預期因找不到 `validateFullIamRoleAllowlist` 失敗。
  - [ ] **Step 3: 寫入最小實作**
    在 `allocation-assistant/validators/pilot-deployment-validator.js` 中實作配置與完整 10 大身分角色白名單校驗。
  - [ ] **Step 4: 執行並確認 TC-15, TC-16 測試通過**
    確認 TC-15 與 TC-16 通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g6-pilot-config-integration`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement pilot config and full 10-identity iam allowlist validator (TC-15, TC-16)`

- **最小實作程式碼範例**:
```javascript
const ALLOWED_IAM_POLICIES = {
  // 5 Runtime Service Accounts
  transactionWriterRuntimeSa: [
    { role: "roles/datastore.user", resource: "projects/PROJECT_ID" }
  ],
  outboxPublisherRuntimeSa: [
    { role: "roles/datastore.user", resource: "projects/PROJECT_ID" },
    { role: "roles/pubsub.publisher", resource: "projects/PROJECT_ID/topics/jy-reservation-events" }
  ],
  projectionWorkerRuntimeSa: [
    { role: "roles/datastore.user", resource: "projects/PROJECT_ID" }
  ],
  dlqReconcilerRuntimeSa: [
    { role: "roles/datastore.user", resource: "projects/PROJECT_ID" }
  ],
  projectionReconcilerRuntimeSa: [
    { role: "roles/datastore.user", resource: "projects/PROJECT_ID" }
  ],

  // 4 Trigger Service Accounts
  firestoreEventarcTriggerSa: [
    { role: "roles/eventarc.eventReceiver", resource: "projects/PROJECT_ID" },
    { role: "roles/run.invoker", resource: "projects/PROJECT_ID/locations/asia-east1/services/jy-outbox-publisher" }
  ],
  pubsubEventarcTriggerSa: [
    { role: "roles/eventarc.eventReceiver", resource: "projects/PROJECT_ID" },
    { role: "roles/run.invoker", resource: "projects/PROJECT_ID/locations/asia-east1/services/jy-projection-worker" }
  ],
  dlqEventarcTriggerSa: [
    { role: "roles/eventarc.eventReceiver", resource: "projects/PROJECT_ID" },
    { role: "roles/run.invoker", resource: "projects/PROJECT_ID/locations/asia-east1/services/jy-dlq-reconciler" }
  ],
  cloudSchedulerInvokerSa: [
    { role: "roles/run.invoker", resource: "projects/PROJECT_ID/locations/asia-east1/services/jy-outbox-publisher" },
    { role: "roles/run.invoker", resource: "projects/PROJECT_ID/locations/asia-east1/services/jy-projection-reconciler" }
  ],

  // 1 System Service Agent
  pubsubServiceAgent: [
    { role: "roles/pubsub.publisher", resource: "projects/PROJECT_ID/topics/jy-reservation-events-dlq" },
    { role: "roles/pubsub.subscriber", resource: "projects/PROJECT_ID/subscriptions/jy-reservation-events-sub" }
  ]
};

const REQUIRED_APP_CONFIGS = {
  projectionWorkerSheetsAccess: {
    serviceAccount: "projectionWorkerRuntimeSa",
    oauthScopes: ["https://www.googleapis.com/auth/spreadsheets"],
    spreadsheetId: "SPREADSHEET_ID_AUDIT_LOG",
    sheetRole: "editor"
  },
  projectionReconcilerSheetsAccess: {
    serviceAccount: "projectionReconcilerRuntimeSa",
    oauthScopes: ["https://www.googleapis.com/auth/spreadsheets"],
    spreadsheetId: "SPREADSHEET_ID_AUDIT_LOG",
    sheetRole: "editor"
  }
};

function validatePilotDeploymentConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") {
    return { valid: false, errors: ["Configuration object is required"] };
  }
  if (config.maxInstances !== 1) {
    errors.push("maxInstances must be exactly 1 for pilot phase");
  }
  if (config.concurrency !== 1) {
    errors.push("concurrency must be exactly 1 for pilot phase");
  }
  if (config.timeoutSeconds !== 120) {
    errors.push("timeoutSeconds must be exactly 120");
  }
  return { valid: errors.length === 0, errors };
}

function validateFullIamRoleAllowlist(bindings, appConfigs = {}) {
  const violations = [];
  if (!bindings || typeof bindings !== "object") {
    return { valid: false, violations: ["IAM bindings object is required"] };
  }

  const knownIdentities = Object.keys(ALLOWED_IAM_POLICIES);
  const inputIdentities = Object.keys(bindings);

  // 阻絕未知的第 11 個 identity
  for (const id of inputIdentities) {
    if (!knownIdentities.includes(id)) {
      violations.push(`Unknown identity '${id}' detected; strictly only 10 authorized identities allowed`);
    }
  }

  for (const saKey of knownIdentities) {
    const saConfig = bindings[saKey];
    if (!saConfig || !Array.isArray(saConfig.bindings)) {
      violations.push(`Missing or invalid SA configuration/bindings for ${saKey}`);
      continue;
    }

    const expectedBindings = ALLOWED_IAM_POLICIES[saKey];

    for (const b of saConfig.bindings) {
      if (!b || typeof b !== "object" || !b.role || !b.resource) {
        violations.push(`Malformed binding on ${saKey}: role and resource are required`);
        continue;
      }
      if (b.role.includes("secretmanager")) {
        violations.push(`Illegal Secret Manager role '${b.role}' detected on ${saKey}; Secret Manager is strictly forbidden`);
      }
      if (saKey === "projectionWorkerRuntimeSa" && b.role === "roles/run.invoker") {
        violations.push(`Projection Worker runtime SA must NOT possess roles/run.invoker`);
      }
      const allowedProjectRoles = ["roles/datastore.user", "roles/eventarc.eventReceiver"];
      if (b.resource === "*" || (b.resource === "projects/PROJECT_ID" && !allowedProjectRoles.includes(b.role))) {
        violations.push(`Wildcard or project-wide resource '${b.resource}' strictly forbidden for role '${b.role}' on ${saKey}`);
      }

      const match = expectedBindings.find((exp) => exp.role === b.role && exp.resource === b.resource);
      if (!match) {
        violations.push(`Unauthorized role-resource pairing '${b.role}' on '${b.resource}' detected for ${saKey}`);
      }
    }

    for (const exp of expectedBindings) {
      const match = saConfig.bindings.find((b) => b.role === exp.role && b.resource === exp.resource);
      if (!match) {
        violations.push(`Missing mandatory binding '${exp.role}' on '${exp.resource}' for ${saKey}`);
      }
    }
  }

  // 驗證獨立 Sheets OAuth 與 Editor ACL
  for (const [cfgKey, expectedCfg] of Object.entries(REQUIRED_APP_CONFIGS)) {
    const actualCfg = appConfigs[cfgKey];
    if (!actualCfg) {
      violations.push(`Missing independent configuration '${cfgKey}'`);
      continue;
    }
    if (actualCfg.serviceAccount !== expectedCfg.serviceAccount) {
      violations.push(`Mismatch serviceAccount on ${cfgKey}`);
    }
    if (!Array.isArray(actualCfg.oauthScopes) || !actualCfg.oauthScopes.includes("https://www.googleapis.com/auth/spreadsheets")) {
      violations.push(`Missing mandatory spreadsheets OAuth scope on ${cfgKey}`);
    }
    if (actualCfg.sheetRole !== "editor" || !actualCfg.spreadsheetId) {
      violations.push(`Invalid Sheet ACL or spreadsheetId on ${cfgKey}; must be editor on independent audit sheet`);
    }
  }

  return { valid: violations.length === 0, violations };
}
```

---

### Task 2: Full End-to-End Local Simulation Integration
- **Create / Modify / Test 路徑**:
  - Modify: `tests/simulations/stage-42-g6-pilot-config-integration.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `tests/simulations/stage-42-g6-pilot-config-integration.sim.js`: 新增全流程端到端整合測試函式 `executeStage42GIntegratedSimulation()`。
- **Consumes / Produces 介面**:
  - Consumes: 業務交易物件、Firestore Emulator、FakePubSubClientAdapter、FakeGoogleSheetsClientAdapter、`Clock`。
  - Produces: 驗證完成之資料流（Outbox PENDING -> PUBLISHED -> CloudEvent unpack -> Worker PROCESSING -> Sheet Row Appended -> Firestore SUCCEEDED）。
- **精確函式名稱**:
  - `executeStage42GIntegratedSimulation(db: object, pubsub: object, sheets: object, clock: object): Promise<object>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試**
    撰寫測試：串連 G1 至 G5 模組，驗證完整業務流程：Outbox 冪等建立 -> Pub/Sub 發布 -> Completion Fencing 驗證 -> CloudEvent 解包 -> Worker 認領與 Erratum 1 快照儲存 -> 寫入前 Firestore 權威租約校驗 -> 12 欄物理列寫入 -> 結案。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因模組尚未完成對接失敗。
  - [ ] **Step 3: 寫入最小實作**
    在整合測試中串接各子計畫組件。
  - [ ] **Step 4: 執行並確認全鏈條整合測試通過**
    確認端到端模擬整合 PASS。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g6-pilot-config-integration`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `test(projection): implement full end-to-end local simulation pipeline`

---

### Task 3: Real Acceptance Test Registry Aggregator & Runner with Failure Injection Self-Check
- **Create / Modify / Test 路徑**:
  - Create: `tests/simulations/stage-42-f-acceptance-suite.sim.js`
  - Modify: `package.json`
- **現有檔案需要修改的責任範圍**:
  - `package.json`: 註冊 `simulate:stage-42-f-acceptance` 與 `simulate:stage-42-g-all` 腳本。
  - `tests/simulations/stage-42-f-acceptance-suite.sim.js`: 匯入 G1–G6 test registry、逐一執行 run、包含 failing test 注入自我校驗。
- **Consumes / Produces 介面**:
  - Consumes: 各子計畫（G1 至 G6）之專屬 Test Registry 物件。
  - Produces: 18 案例真實執行報告，絕不以常數 hard-code passedCases。
- **精確函式名稱**:
  - `runStage42FAcceptanceSuite(injectedFailingTest?: object): Promise<object>`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試**
    撰寫驗收調度器測試：
    1. 驗證從 G1–G6 匯入之測試精確覆蓋 TC-01 至 TC-18（無缺少、無重複）。
    2. 逐一 `await test.run()`，確認只有真實跑完且無例外拋出才計入 `passedCases`。
    3. 自我驗證：傳入故意失敗的 test 物件，確認 runner 判定為 FAIL 且 `failedCases` 增加。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行 `node tests/simulations/stage-42-f-acceptance-suite.sim.js`，預期因尚未實作真實驗收調度器失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作 Acceptance Suite 調度器與自我驗證機制。
  - [ ] **Step 4: 執行並確認 TC-01 至 TC-18 真實執行且全數通過，自我驗證注入失敗亦成功被捕捉**
    確認真實執行 18/18 通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-f-acceptance`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `test(projection): integrate stage 42-f 18-case acceptance test registry and runner`

- **最小實作程式碼範例 (`tests/simulations/stage-42-f-acceptance-suite.sim.js`)**:
```javascript
const assert = require("assert");

const g1Registry = require("./stage-42-g1-event-contracts.sim");
const g2Registry = require("./stage-42-g2-outbox-publisher.sim");
const g3Registry = require("./stage-42-g3-projection-worker.sim");
const g4Registry = require("./stage-42-g4-dlq-reconciler.sim");
const g5Registry = require("./stage-42-g5-projection-reconciler.sim");
const g6Registry = require("./stage-42-g6-pilot-config-integration.sim");

async function executeTestBatch(tests) {
  const results = [];
  let passedCases = 0;
  let failedCases = 0;

  for (const test of tests) {
    const start = Date.now();
    try {
      if (typeof test.run !== "function") {
        throw new Error(`Test ${test.id} does not export a valid run() function`);
      }
      await test.run();
      const duration = Date.now() - start;
      results.push({ id: test.id, name: test.name, status: "PASS", durationMs: duration });
      passedCases += 1;
      console.log(`[PASS] ${test.id}: ${test.name} (${duration}ms)`);
    } catch (err) {
      const duration = Date.now() - start;
      results.push({ id: test.id, name: test.name, status: "FAIL", error: err.message, durationMs: duration });
      failedCases += 1;
      console.error(`[FAIL] ${test.id}: ${test.name} - Error: ${err.message}`);
    }
  }

  return {
    totalCases: tests.length,
    passedCases,
    failedCases,
    results,
    isSuccess: failedCases === 0
  };
}

async function runStage42FAcceptanceSuite() {
  const allRegistries = [g1Registry, g2Registry, g3Registry, g4Registry, g5Registry, g6Registry];
  const mergedTests = [];

  for (const reg of allRegistries) {
    if (reg && Array.isArray(reg.tests)) {
      mergedTests.push(...reg.tests);
    }
  }

  const expectedIds = [
    "TC-01", "TC-02", "TC-03", "TC-04", "TC-05", "TC-06",
    "TC-07", "TC-08", "TC-09", "TC-10", "TC-11", "TC-12",
    "TC-13", "TC-14", "TC-15", "TC-16", "TC-17", "TC-18"
  ];

  // 校驗 18 個 ID 精確出現一次
  const foundIds = mergedTests.map((t) => t.id);
  for (const expectedId of expectedIds) {
    const occurrences = foundIds.filter((id) => id === expectedId).length;
    assert.strictEqual(occurrences, 1, `Test case ${expectedId} must appear exactly once`);
  }
  assert.strictEqual(mergedTests.length, 18, "Acceptance suite must contain exactly 18 test cases");

  const report = await executeTestBatch(mergedTests);
  if (!report.isSuccess) {
    process.exitCode = 1;
  }
  return report;
}

// 隔離自我驗證函式（使用獨立 Stub Registry，嚴禁重新跑一次 18 個生產案例）
async function verifyAcceptanceRunnerSelfCheck() {
  const stubTests = [
    { id: "STUB-PASS", name: "Isolated passing stub test", run: async () => {} },
    { id: "STUB-FAIL", name: "Isolated failing stub test", run: async () => { throw new Error("INJECTED_STUB_FAILURE"); } }
  ];
  const result = await executeTestBatch(stubTests);
  assert.strictEqual(result.isSuccess, false, "Runner must report failure when failing stub is encountered");
  assert.strictEqual(result.passedCases, 1, "Passed cases count must be exactly 1");
  assert.strictEqual(result.failedCases, 1, "Failed cases count must be exactly 1");
  console.log("PASS: Acceptance runner isolated self-check (1 pass stub + 1 fail stub correctly executed)");
}

module.exports = {
  executeTestBatch,
  runStage42FAcceptanceSuite,
  verifyAcceptanceRunnerSelfCheck
};
```

- **Test Registry Export 規範 (`tests/simulations/stage-42-g6-pilot-config-integration.sim.js`)**:
```javascript
module.exports = {
  tests: [
    {
      id: "TC-15",
      name: "Pilot declarative configuration asserts max-instances=1, concurrency=1, timeout=120s",
      run: testPilotDeploymentConfigValidation
    },
    {
      id: "TC-16",
      name: "IAM policy assertion verifies Projection Worker SA does NOT possess roles/run.invoker",
      run: testFullIamRoleAllowlistValidation
    }
  ]
};
```
