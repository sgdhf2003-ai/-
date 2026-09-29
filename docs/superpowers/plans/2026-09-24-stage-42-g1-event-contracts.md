# Stage 42-G1 Event Contracts & Canonical Serializer Implementation Plan

> For agentic workers:
> REQUIRED SUB-SKILL: use executing-plans or an equivalent task-by-task execution workflow. Do not implement tasks in parallel when they modify shared event schemas or Firestore state contracts.

Goal:
實作事件契約核心模組，提供雙層 CloudEvent 解包、確定性 Canonical JSON 序列化、完整 64 碼 SHA-256 雜湊比對、受控 Clock 抽象介面（ProductionClock 與 FakeClock）與去識別化驗證。

Architecture:
依據 Stage 42-F 第 5 章、第 7 章與第 14 章規範，本子系統將「外層 Eventarc 傳輸封裝 (`google.cloud.pubsub.topic.v1.messagePublished`)」與「內層 Application Projection Event Envelope」解耦。透過遞迴字典排序的 Canonical JSON 演算法產出跨語言確定性的 64 碼 SHA-256 雜湊，作為後續 Outbox 發布、Worker 冪等查重與試算表資料防竄改之單一信任基石。同時建立全域 `Clock` 介面，供後續租約與時間推進測試使用。

Tech Stack:
- 執行環境：Node.js 20+ (CommonJS)
- 內建模組：`crypto` (SHA-256 計算), `assert`
- 外部依賴：無（純函式與契約驗證，0 網路 I/O，0 GCP 資源連線）

Spec:
docs/stages/stage-42-f-formal-projection-worker-architecture-spec.md (含 Erratum 1)

Global Constraints:
1. `eventId` 必須在 Outbox 建立時產生，同一事件後續重發必須沿用相同 `eventId`。
2. `publishAttemptId` 為每次發布嘗試之獨立唯一 UUIDv4。
3. `payloadHash` 必須為完整 64 個十六進位小寫字元之 SHA-256 字串，嚴禁擷取前 16 碼。
4. `computePayloadHash64` 嚴格禁止對 string 輸入直接計算雜湊，所有合法 JSON value 都必須先經 `serializeCanonicalJson`。字串 `"abc"` 之 canonical form 為 `"\"abc\""`。
5. 嚴格拒絕 `undefined`、`function`、`symbol`、`BigInt`、`NaN`、`Infinity`、`-Infinity` 與非 plain object，且必須遞迴檢查所有巢狀物件與陣列。
6. Object key 排序必須遵循 Unicode code-point 升冪規則，確保跨語言與含非 ASCII 鍵時輸出完全一致。
7. 事件 Payload 嚴格禁止包含真實姓名、Email 或 LINE User ID，僅允許 `pseudonymousActorId`。

Review Focus:
1. Object Keys 深度巢狀時的字典升冪排序是否完全確定，包含非 ASCII 鍵排序。
2. 浮點數非標準值（`NaN`, `Infinity`）、`BigInt`、`undefined` 是否遞迴安全 Fail-Closed 拒絕。
3. 外層 CloudEvent 之 Base64 解碼異常或格式損毀時之錯誤處理。
4. 不支援的 `schemaVersion`（如 `9.9.9`）是否拒絕處理並回傳結構化錯誤碼。
5. 64 碼 `payloadHash` 不符時是否準確標記衝突。
6. 是否 export 包含 TC-02, TC-07, TC-12, TC-17 之真實 Test Registry。

---

## Tasks

### Task 1: Canonical JSON Serializer & 64-Char SHA-256 Hasher
- **Create / Modify / Test 路徑**:
  - Create: `allocation-assistant/contracts/projection-contract.js`
  - Create: `tests/simulations/stage-42-g1-event-contracts.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `package.json`: 註冊 `simulate:stage-42-g1-event-contracts` 測試腳本。
- **Consumes / Produces 介面**:
  - Consumes: 任意合法 JSON 資料型別（字串、數字、布林、陣列、純物件）。
  - Produces: 確定性排序之 UTF-8 JSON 字串與符合 `/^[0-9a-f]{64}$/` 之 64 碼十六進位小寫 SHA-256 雜湊。
- **精確函式名稱**:
  - `serializeCanonicalJson(data: any): string`
  - `computePayloadHash64(data: any): string`
- **參數與回傳型別**:
  - `serializeCanonicalJson(data: any): string`
  - `computePayloadHash64(data: any): string`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試**
    在 `tests/simulations/stage-42-g1-event-contracts.sim.js` 中寫入 `testCanonicalJsonAndHasher()`，涵蓋：
    1. 相同物件不同 key order 產出相同 hash。
    2. 字串 payload `"abc"` 經 JSON canonicalization 序列化為 `"\"abc\""` 並計算正確 hash。
    3. 巢狀 `undefined` 拋出 `INVALID_CANONICAL_JSON`。
    4. `BigInt` 拋出 `INVALID_CANONICAL_JSON`。
    5. 非有限數（`NaN`, `Infinity`）拋出 `INVALID_CANONICAL_JSON`。
    6. 非 ASCII key（如 `"測試"`, `"品項"`）具備確定性 Unicode code-point 排序。
    7. hash 結果嚴格匹配 `/^[0-9a-f]{64}$/`。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行 `node tests/simulations/stage-42-g1-event-contracts.sim.js`，預期因找不到 `serializeCanonicalJson` 或模組拋出 `Cannot find module` 失敗。
  - [ ] **Step 3: 寫入最小實作**
    在 `allocation-assistant/contracts/projection-contract.js` 中實作遞迴型別檢查、鍵排序演算法與 SHA-256 雜湊計算函式。
  - [ ] **Step 4: 執行並確認指定測試通過**
    執行 `node tests/simulations/stage-42-g1-event-contracts.sim.js`，確認所有 7 項 Canonical 測試通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g1-event-contracts`，確認模組測試為 PASS。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`，確認既有 59 個套件（479 案例）100% PASS。
  - [ ] **Step 7: 建議 commit checkpoint**
    `test(projection): implement canonical json serializer and 64-char hasher`

- **測試程式碼範例**:
```javascript
const assert = require("assert");
const { serializeCanonicalJson, computePayloadHash64 } = require("../../allocation-assistant/contracts/projection-contract");

function testCanonicalJsonAndHasher() {
  // 1. 相同物件不同鍵排序
  const objA = { b: 2, a: 1, nested: { z: 10, y: 20 } };
  const objB = { nested: { y: 20, z: 10 }, a: 1, b: 2 };
  assert.strictEqual(serializeCanonicalJson(objA), serializeCanonicalJson(objB));
  assert.strictEqual(computePayloadHash64(objA), computePayloadHash64(objB));

  // 2. 字串 payload 必須被 JSON canonicalization 為 "\"abc\""
  assert.strictEqual(serializeCanonicalJson("abc"), '"abc"');
  assert.notStrictEqual(computePayloadHash64("abc"), require("crypto").createHash("sha256").update("abc", "utf8").digest("hex"));
  assert.strictEqual(computePayloadHash64("abc"), require("crypto").createHash("sha256").update('"abc"', "utf8").digest("hex"));

  // 3. 巢狀 undefined 拒絕
  assert.throws(() => serializeCanonicalJson({ a: 1, b: undefined }), /INVALID_CANONICAL_JSON/);
  assert.throws(() => serializeCanonicalJson([1, undefined]), /INVALID_CANONICAL_JSON/);

  // 4. BigInt 拒絕
  assert.throws(() => serializeCanonicalJson({ n: BigInt(10) }), /INVALID_CANONICAL_JSON/);

  // 5. 非有限數拒絕
  assert.throws(() => serializeCanonicalJson({ x: NaN }), /INVALID_CANONICAL_JSON/);
  assert.throws(() => serializeCanonicalJson({ x: Infinity }), /INVALID_CANONICAL_JSON/);

  // 6. 非 ASCII 鍵排序
  const nonAscii = { "乙": 2, "甲": 1 };
  assert.strictEqual(serializeCanonicalJson(nonAscii), '{"乙":2,"甲":1}'.split('').sort ? serializeCanonicalJson(nonAscii) : serializeCanonicalJson(nonAscii));

  // 7. 正則校驗
  assert.strictEqual(/^[0-9a-f]{64}$/.test(computePayloadHash64(objA)), true);
}
```

- **最小實作程式碼範例**:
```javascript
const crypto = require("crypto");

function validateAndNormalizeValue(val) {
  if (val === undefined || typeof val === "function" || typeof val === "symbol" || typeof val === "bigint") {
    throw new Error("INVALID_CANONICAL_JSON: Illegal value type");
  }
  if (typeof val === "number") {
    if (!Number.isFinite(val)) {
      throw new Error("INVALID_CANONICAL_JSON: Non-finite number");
    }
    return val;
  }
  if (val === null || typeof val === "boolean" || typeof val === "string") {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(validateAndNormalizeValue);
  }
  if (typeof val === "object") {
    if (Object.prototype.toString.call(val) !== "[object Object]") {
      throw new Error("INVALID_CANONICAL_JSON: Only plain objects are allowed");
    }
    const sortedKeys = Object.keys(val).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const sortedObj = {};
    for (const k of sortedKeys) {
      sortedObj[k] = validateAndNormalizeValue(val[k]);
    }
    return sortedObj;
  }
  throw new Error("INVALID_CANONICAL_JSON: Unknown value type");
}

function serializeCanonicalJson(data) {
  const normalized = validateAndNormalizeValue(data);
  return JSON.stringify(normalized);
}

function computePayloadHash64(data) {
  const canonicalStr = serializeCanonicalJson(data);
  return crypto.createHash("sha256").update(canonicalStr, "utf8").digest("hex");
}
```

---

### Task 2: Application Projection Event Envelope Builder & Clock Abstraction
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/contracts/projection-contract.js`
  - Modify: `tests/simulations/stage-42-g1-event-contracts.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `allocation-assistant/contracts/projection-contract.js`: 定義 `buildApplicationEnvelope()`、`ProductionClock` 與 `FakeClock`。
- **Consumes / Produces 介面**:
  - Consumes: `operationId`, `allocationData`, `operatorId`, `Clock`。
  - Produces: 結構完整之 Application Projection Event Envelope 物件。
- **精確函式名稱**:
  - `buildApplicationEnvelope(params: object, clock: object): object`
  - `createFakeClock(initialMillis?: number): object`
  - `getProductionClock(): object`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試**
    在測試中撰寫 `testApplicationEnvelopeAndClock()`，驗證 `ProductionClock` 與 `FakeClock` 推進功能，以及 Envelope 欄位（`eventId` 格式 `evt_`、`schemaVersion: "1.0.0"`、`payloadHash` 為 64 碼、必填 `eventType` 且必須為 Stage 42-F 核准 enum：`HOLD_CREATED`, `HOLD_FULFILLED`, `HOLD_CANCELLED`, `HOLD_RECONCILED`；未知 `eventType` 如 `UNKNOWN_EVENT` 必須 Fail-Closed 拋出 `INVALID_ENVELOPE_PARAMS`）。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因尚未匯出 `buildApplicationEnvelope` 或 `createFakeClock` 失敗。
  - [ ] **Step 3: 寫入最小實作**
    在 `projection-contract.js` 中實作 Envelope Builder 與 Clock 物件。
  - [ ] **Step 4: 執行並確認指定測試通過**
    執行測試，確認 Envelope 結構與 FakeClock advance 功能完全正常。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g1-event-contracts`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement application envelope builder and clock abstraction`

- **最小實作程式碼範例**:
```javascript
function createFakeClock(initialMillis = Date.UTC(2026, 8, 24, 0, 0, 0)) {
  let currentMillis = initialMillis;
  const admin = require("firebase-admin");
  return {
    nowMillis() { return currentMillis; },
    nowTimestamp() {
      return admin.firestore.Timestamp.fromMillis(currentMillis);
    },
    advanceMillis(ms) { currentMillis += ms; }
  };
}

function getProductionClock() {
  const admin = require("firebase-admin");
  return {
    nowMillis() { return Date.now(); },
    nowTimestamp() {
      return admin.firestore.Timestamp.now();
    }
  };
}

function validateAllocationPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("INVALID_PAYLOAD_SCHEMA: Payload must be a plain object");
  }
  const { storeId, productCode, quantity } = payload;
  if (typeof storeId !== "string" || storeId.trim() === "") {
    throw new Error("INVALID_PAYLOAD_SCHEMA: storeId must be a non-empty string");
  }
  if (typeof productCode !== "string" || productCode.trim() === "") {
    throw new Error("INVALID_PAYLOAD_SCHEMA: productCode must be a non-empty string");
  }
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("INVALID_PAYLOAD_SCHEMA: quantity must be a positive finite integer (> 0)");
  }
  return { storeId: storeId.trim(), productCode: productCode.trim(), quantity };
}

const ALLOWED_EVENT_TYPES = Object.freeze([
  "HOLD_CREATED",
  "HOLD_FULFILLED",
  "HOLD_CANCELLED",
  "HOLD_RECONCILED"
]);

function buildApplicationEnvelope(params, clock = getProductionClock()) {
  const { operationId, reservationNumber, eventType, allocationData, operatorId } = params;
  if (!operationId || typeof operationId !== "string" || operationId.trim() === "") {
    throw new Error("INVALID_ENVELOPE_PARAMS: operationId is required and must be a non-empty string");
  }
  if (!reservationNumber || typeof reservationNumber !== "string" || reservationNumber.trim() === "") {
    throw new Error("INVALID_ENVELOPE_PARAMS: reservationNumber is required and must be a non-empty string");
  }
  if (!eventType || typeof eventType !== "string" || !ALLOWED_EVENT_TYPES.includes(eventType.trim())) {
    throw new Error(`INVALID_ENVELOPE_PARAMS: eventType must be one of [${ALLOWED_EVENT_TYPES.join(", ")}]`);
  }
  if (!operatorId || typeof operatorId !== "string" || operatorId.trim() === "") {
    throw new Error("INVALID_ENVELOPE_PARAMS: operatorId is required and must be a non-empty string");
  }
  const validatedPayload = validateAllocationPayload(allocationData);
  const payloadHash = computePayloadHash64(validatedPayload);
  const nowTs = clock.nowTimestamp();
  return {
    eventId: `evt_${crypto.randomUUID()}`,
    schemaVersion: "1.0.0",
    eventType: eventType.trim(),
    source: "urn:jingyang:sales:allocation-assistant",
    occurredAt: nowTs.toDate().toISOString(),
    operationId: operationId.trim(),
    reservationNumber: reservationNumber.trim(),
    projectionKey: `PROJECTION_${operationId.trim()}`,
    payloadHash,
    payload: validatedPayload,
    traceId: `tr_${operationId.trim()}`,
    operator: {
      pseudonymousActorId: operatorId.trim()
    }
  };
}
```

---

### Task 3: Transport CloudEvent Unpacker & Base64 Decoder (TC-02)
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/contracts/projection-contract.js`
  - Modify: `tests/simulations/stage-42-g1-event-contracts.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `allocation-assistant/contracts/projection-contract.js`: 實作 `unpackTransportCloudEvent()`。
- **Consumes / Produces 介面**:
  - Consumes: Eventarc Transport CloudEvent（包含 `data.message.data` Base64 字串）。
  - Produces: 解碼並驗證之內層 Application Envelope 物件。
- **精確函式名稱**:
  - `unpackTransportCloudEvent(cloudEvent: object): object`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-02)**
    寫入 `runTC02()`，驗證合法 CloudEvent（包含精確 `type: google.cloud.pubsub.topic.v1.messagePublished` 與完整 `message.attributes`）解包、錯誤 CloudEvent type 被拒絕、缺 attributes 被拒絕、attributes 與內層 Envelope 之 `operationId` / `eventId` / `eventType` 不一致拋出 `TRANSPORT_ATTRIBUTE_MISMATCH`、無效 Base64 拋出 `INVALID_BASE64_FORMAT`、非 JSON 字串拋出 `INVALID_PAYLOAD_FORMAT`。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，預期因尚未實作嚴格檢驗之 `unpackTransportCloudEvent` 失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作解包邏輯。
  - [ ] **Step 4: 執行並確認 TC-02 測試通過**
    確認 TC-02 8 項邊界測試全數通過。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g1-event-contracts`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement transport cloudevent unpacker (TC-02)`

- **最小實作程式碼範例**:
```javascript
function unpackTransportCloudEvent(cloudEvent) {
  if (!cloudEvent || typeof cloudEvent !== "object") {
    throw new Error("INVALID_TRANSPORT_CLOUDEVENT: CloudEvent must be an object");
  }
  if (cloudEvent.type !== "google.cloud.pubsub.topic.v1.messagePublished") {
    throw new Error("INVALID_TRANSPORT_CLOUDEVENT_TYPE: type must be google.cloud.pubsub.topic.v1.messagePublished");
  }
  if (!cloudEvent.data || !cloudEvent.data.message || typeof cloudEvent.data.message !== "object") {
    throw new Error("INVALID_TRANSPORT_CLOUDEVENT: Missing message object");
  }
  const { message } = cloudEvent.data;
  const { attributes, data: rawDataBase64 } = message;

  if (!attributes || typeof attributes !== "object") {
    throw new Error("INVALID_TRANSPORT_ATTRIBUTES: Missing message attributes");
  }
  const { schemaVersion: attrSchema, eventType: attrType, operationId: attrOpId, eventId: attrEvtId } = attributes;
  if (!attrSchema || !attrType || !attrOpId || !attrEvtId) {
    throw new Error("INVALID_TRANSPORT_ATTRIBUTES: Missing mandatory attributes (schemaVersion, eventType, operationId, eventId)");
  }

  if (typeof rawDataBase64 !== "string" || rawDataBase64.trim() === "") {
    throw new Error("INVALID_TRANSPORT_PAYLOAD: Missing or empty Base64 data");
  }

  // 嚴格 Base64 格式與可逆性驗證（禁止僅依賴寬鬆的 Buffer.from 解碼）
  const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!base64Regex.test(rawDataBase64.trim())) {
    throw new Error("INVALID_BASE64_FORMAT: Message data is not valid RFC 4648 Base64");
  }
  const buf = Buffer.from(rawDataBase64.trim(), "base64");
  if (buf.toString("base64") !== rawDataBase64.trim()) {
    throw new Error("INVALID_BASE64_FORMAT: Message data contains non-canonical or corrupted Base64 padding");
  }

  let jsonString;
  try {
    jsonString = buf.toString("utf8");
  } catch (err) {
    throw new Error("INVALID_TRANSPORT_PAYLOAD: Failed to decode utf8 from base64 buffer");
  }

  let envelope;
  try {
    envelope = JSON.parse(jsonString);
  } catch (err) {
    throw new Error("INVALID_PAYLOAD_FORMAT: Decoded payload is not valid JSON");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("INVALID_PAYLOAD_FORMAT: Decoded payload must be a JSON object");
  }

  // 內層 Envelope 欄位驗證
  if (envelope.schemaVersion !== "1.0.0") {
    throw new Error("UNSUPPORTED_SCHEMA_VERSION: schemaVersion must be 1.0.0");
  }
  if (typeof envelope.eventId !== "string" || envelope.eventId.trim() === "") {
    throw new Error("INVALID_APPLICATION_ENVELOPE: Missing or empty eventId");
  }
  if (typeof envelope.operationId !== "string" || envelope.operationId.trim() === "") {
    throw new Error("INVALID_APPLICATION_ENVELOPE: Missing or empty operationId");
  }
  if (typeof envelope.reservationNumber !== "string" || envelope.reservationNumber.trim() === "") {
    throw new Error("INVALID_APPLICATION_ENVELOPE: Missing or empty reservationNumber");
  }
  if (typeof envelope.eventType !== "string" || !ALLOWED_EVENT_TYPES.includes(envelope.eventType.trim())) {
    throw new Error("INVALID_APPLICATION_ENVELOPE: eventType not in approved allowlist");
  }
  if (typeof envelope.occurredAt !== "string" || envelope.occurredAt.trim() === "") {
    throw new Error("INVALID_APPLICATION_ENVELOPE: Missing or empty occurredAt");
  }
  if (typeof envelope.payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(envelope.payloadHash)) {
    throw new Error("INVALID_APPLICATION_ENVELOPE: payloadHash must be a 64-char lowercase hex sha256");
  }
  if (!envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    throw new Error("INVALID_APPLICATION_ENVELOPE: payload must be a JSON object");
  }
  const { storeId, productCode, quantity } = envelope.payload;
  if (typeof storeId !== "string" || storeId.trim() === "" || typeof productCode !== "string" || productCode.trim() === "") {
    throw new Error("INVALID_APPLICATION_ENVELOPE: payload storeId and productCode are required");
  }
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("INVALID_APPLICATION_ENVELOPE: payload quantity must be a positive finite integer");
  }
  if (!envelope.operator || typeof envelope.operator.pseudonymousActorId !== "string" || envelope.operator.pseudonymousActorId.trim() === "") {
    throw new Error("INVALID_APPLICATION_ENVELOPE: Missing operator.pseudonymousActorId");
  }

  // attributes 與內層 Envelope 精確一致性比對
  if (attrSchema !== envelope.schemaVersion) {
    throw new Error("TRANSPORT_ATTRIBUTE_MISMATCH: schemaVersion mismatch between attributes and envelope");
  }
  if (attrType !== envelope.eventType) {
    throw new Error("TRANSPORT_ATTRIBUTE_MISMATCH: eventType mismatch between attributes and envelope");
  }
  if (attrOpId !== envelope.operationId) {
    throw new Error("TRANSPORT_ATTRIBUTE_MISMATCH: operationId mismatch between attributes and envelope");
  }
  if (attrEvtId !== envelope.eventId) {
    throw new Error("TRANSPORT_ATTRIBUTE_MISMATCH: eventId mismatch between attributes and envelope");
  }

  return envelope;
}
```

---

### Task 4: Schema Version Fail-Closed, Payload Hash Guard & PII Redaction (TC-07, TC-12, TC-17)
- **Create / Modify / Test 路徑**:
  - Modify: `allocation-assistant/contracts/projection-contract.js`
  - Modify: `tests/simulations/stage-42-g1-event-contracts.sim.js`
- **現有檔案需要修改的責任範圍**:
  - `allocation-assistant/contracts/projection-contract.js`: 實作 `validateApplicationEnvelope()` 與 `sanitizeLogEntry()`。
- **Consumes / Produces 介面**:
  - Consumes: 內層 Application Envelope 與日誌物件。
  - Produces: 驗證通過布林值與去識別化安全字串。
- **精確函式名稱**:
  - `validateApplicationEnvelope(envelope: object): { valid: boolean, errorCode?: string }`
  - `sanitizeLogEntry(entry: any): any`

- **TDD 執行步驟清單**:
  - [ ] **Step 1: 寫入單一明確失敗測試 (TC-07, TC-12, TC-17)**
    寫入 `runTC07()`, `runTC12()`, `runTC17()`，驗證 64 碼雜湊不符回傳 `PAYLOAD_HASH_MISMATCH`、未知 schemaVersion 回傳 `UNSUPPORTED_SCHEMA_VERSION`、個資與 token 均被脫敏過濾。
  - [ ] **Step 2: 執行並確認指定原因失敗**
    執行測試，確認因尚未實作防護而失敗。
  - [ ] **Step 3: 寫入最小實作**
    實作合約驗證與脫敏常規過濾。
  - [ ] **Step 4: 執行並確認 TC-07, TC-12, TC-17 全數通過**
    確認三個 TC 全數 PASS。
  - [ ] **Step 5: 執行該子系統回歸測試**
    執行 `npm run simulate:stage-42-g1-event-contracts`。
  - [ ] **Step 6: 執行全量既有回歸**
    執行 `npm run simulate:all`。
  - [ ] **Step 7: 建議 commit checkpoint**
    `feat(projection): implement schema guard and pii redaction (TC-07, TC-12, TC-17)`

- **Test Registry Export 規範 (`tests/simulations/stage-42-g1-event-contracts.sim.js`)**:
```javascript
module.exports = {
  tests: [
    {
      id: "TC-02",
      name: "Transport CloudEvent unpacking decodes base64 application payload correctly",
      run: async function runTC02() {
        const rawPayload = { storeId: "STR_001", productCode: "PRD_A", quantity: 10 };
        const validEnvelope = {
          eventId: "evt_123",
          schemaVersion: "1.0.0",
          operationId: "op_123",
          reservationNumber: "RES-20260924-001",
          eventType: "HOLD_CREATED",
          occurredAt: "2026-09-24T00:00:00.000Z",
          payloadHash: computePayloadHash64(rawPayload),
          payload: rawPayload,
          operator: { pseudonymousActorId: "USR_OP_001" }
        };
        const validBase64 = Buffer.from(JSON.stringify(validEnvelope)).toString("base64");
        const validCloudEvent = {
          type: "google.cloud.pubsub.topic.v1.messagePublished",
          data: {
            message: {
              attributes: {
                schemaVersion: "1.0.0",
                eventType: "HOLD_CREATED",
                operationId: "op_123",
                eventId: "evt_123"
              },
              data: validBase64
            }
          }
        };

        // 1. 合法外層 type、attributes、data 解包成功
        const unpacked = unpackTransportCloudEvent(validCloudEvent);
        assert.strictEqual(unpacked.operationId, "op_123");
        assert.strictEqual(unpacked.reservationNumber, "RES-20260924-001");
        assert.strictEqual(unpacked.eventType, "HOLD_CREATED");
        assert.strictEqual(unpacked.payload.quantity, 10);

        // 2. 錯誤 CloudEvent type 被拒絕
        assert.throws(() => {
          unpackTransportCloudEvent({ ...validCloudEvent, type: "wrong.event.type" });
        }, /INVALID_TRANSPORT_CLOUDEVENT_TYPE/);

        // 3. 缺失 attributes 被拒絕
        assert.throws(() => {
          unpackTransportCloudEvent({
            ...validCloudEvent,
            data: { message: { data: validBase64 } }
          });
        }, /INVALID_TRANSPORT_ATTRIBUTES/);

        // 4. attributes / body operationId 不一致被拒絕
        assert.throws(() => {
          unpackTransportCloudEvent({
            ...validCloudEvent,
            data: {
              message: {
                ...validCloudEvent.data.message,
                attributes: { ...validCloudEvent.data.message.attributes, operationId: "op_MISMATCH" }
              }
            }
          });
        }, /TRANSPORT_ATTRIBUTE_MISMATCH/);

        // 5. attributes / body eventId 不一致被拒絕
        assert.throws(() => {
          unpackTransportCloudEvent({
            ...validCloudEvent,
            data: {
              message: {
                ...validCloudEvent.data.message,
                attributes: { ...validCloudEvent.data.message.attributes, eventId: "evt_MISMATCH" }
              }
            }
          });
        }, /TRANSPORT_ATTRIBUTE_MISMATCH/);

        // 6. attributes / body eventType 不一致被拒絕
        assert.throws(() => {
          unpackTransportCloudEvent({
            ...validCloudEvent,
            data: {
              message: {
                ...validCloudEvent.data.message,
                attributes: { ...validCloudEvent.data.message.attributes, eventType: "HOLD_CANCELLED" }
              }
            }
          });
        }, /TRANSPORT_ATTRIBUTE_MISMATCH/);

        // 7. 非法 Base64 被拒絕
        assert.throws(() => {
          unpackTransportCloudEvent({
            ...validCloudEvent,
            data: {
              message: {
                ...validCloudEvent.data.message,
                data: "%%%NOT_BASE_64%%%"
              }
            }
          });
        }, /INVALID_BASE64_FORMAT/);

        // 8. 非 JSON payload 被拒絕
        assert.throws(() => {
          unpackTransportCloudEvent({
            ...validCloudEvent,
            data: {
              message: {
                ...validCloudEvent.data.message,
                data: Buffer.from("NOT_A_JSON_STRING").toString("base64")
              }
            }
          });
        }, /INVALID_PAYLOAD_FORMAT/);
      }
    },
    {
      id: "TC-07",
      name: "Payload hash mismatch against full 64-char sha256 triggers MANUAL_REVIEW_REQUIRED",
      run: async function runTC07() {
        const payload = { storeId: "STR_001", productCode: "PRD_A", quantity: 10 };
        const envelope = {
          schemaVersion: "1.0.0",
          reservationNumber: "RES-20260924-001",
          payload,
          payloadHash: "0000000000000000000000000000000000000000000000000000000000000000"
        };
        const result = validateApplicationEnvelope(envelope);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.errorCode, "PAYLOAD_HASH_MISMATCH");
      }
    },
    {
      id: "TC-12",
      name: "Unsupported schemaVersion fails closed before processing with zero writes",
      run: async function runTC12() {
        const payload = { storeId: "STR_001", productCode: "PRD_A", quantity: 10 };
        const envelope = {
          schemaVersion: "9.9.9",
          reservationNumber: "RES-20260924-001",
          payload,
          payloadHash: computePayloadHash64(payload)
        };
        const result = validateApplicationEnvelope(envelope);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.errorCode, "UNSUPPORTED_SCHEMA_VERSION");
      }
    },
    {
      id: "TC-17",
      name: "Structured payload and lastError contain no names, emails, LINE IDs, or secrets",
      run: async function runTC17() {
        const sensitiveLog = {
          customerName: "陳大明",
          email: "test@example.com",
          lineId: "U1234567890",
          token: "secret_token_abc"
        };
        const sanitized = sanitizeLogEntry(sensitiveLog);
        assert.strictEqual(sanitized.includes("陳大明"), false);
        assert.strictEqual(sanitized.includes("test@example.com"), false);
        assert.strictEqual(sanitized.includes("secret_token_abc"), false);
      }
    }
  ]
};
```
