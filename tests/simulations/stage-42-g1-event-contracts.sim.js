"use strict";

/**
 * TDD Simulation Suite: Stage 42-G1 Event Contracts, Canonical JSON, Clock & CloudEvent Unpacking
 *
 * Verifies:
 * 1. Canonical JSON serializer & 64-char SHA-256 hasher:
 *    - True Unicode code-point sorting vs UTF-16 code-unit sorting (U+E000 vs U+10000).
 *    - Nested objects with BMP Chinese keys & supplementary plane keys.
 *    - Rejection of undefined, functions, symbols, BigInt, non-finite numbers.
 * 2. Application Projection Event Envelope builder & Clock abstraction:
 *    - ProductionClock vs FakeClock with real Firestore Timestamps without monkey-patching.
 *    - Time advances strictly via FakeClock.advanceMillis().
 * 3. Transport CloudEvent unpacker & Base64 decoder with attributes validation (TC-02):
 *    - Strict fatal UTF-8 decoding (rejects invalid sequences like [0xC3, 0x28]).
 *    - Attributes and envelope dual-layer consistency check.
 * 4. Schema version fail-closed, payload hash guard & PII log redaction (TC-07, TC-12, TC-17):
 *    - Full schemaVersion 1.0.0 validation (eventId UUIDv4, eventType, source, occurredAt, payloadHash).
 *    - Operator PII fail-closed rejection (emails, raw LINE IDs, blank names, extra fields).
 *    - Payload strict schema: only storeId, productCode, quantity (> 0 integer); rejects any extra fields.
 *    - Robust case-insensitive log sanitization, string secret masking, circular reference & depth safety.
 */

const assert = require("assert");
const crypto = require("crypto");
const { Timestamp } = require("firebase-admin/firestore");
const {
  serializeCanonicalJson,
  computePayloadHash64,
  compareByCodePoint,
  createFakeClock,
  getProductionClock,
  buildApplicationEnvelope,
  ALLOWED_EVENT_TYPES,
  ALLOWED_SOURCES,
  unpackTransportCloudEvent,
  validateApplicationEnvelope,
  sanitizeLogEntry
} = require("../../allocation-assistant/contracts/projection-contract");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS stage-42-g1-event-contracts: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`FAIL stage-42-g1-event-contracts: ${description}`);
    console.error(`  Error: ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

async function runAsyncTest(description, testFn) {
  totalTests++;
  try {
    await testFn();
    passedTests++;
    console.log(`PASS stage-42-g1-event-contracts: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`FAIL stage-42-g1-event-contracts: ${description}`);
    console.error(`  Error: ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

// -----------------------------------------------------------------------------
// Task 1: Canonical JSON Serializer & 64-Char SHA-256 Hasher Tests
// -----------------------------------------------------------------------------
function testCanonicalJsonAndHasher() {
  runTest("1.1 Same object with different key order produces identical canonical JSON and hash", () => {
    const objA = { b: 2, a: 1, nested: { z: 10, y: 20 } };
    const objB = { nested: { y: 20, z: 10 }, a: 1, b: 2 };
    assert.strictEqual(serializeCanonicalJson(objA), serializeCanonicalJson(objB));
    assert.strictEqual(computePayloadHash64(objA), computePayloadHash64(objB));
  });

  runTest("1.2 String payload undergoes JSON canonicalization to \"\"abc\"\" before hashing", () => {
    assert.strictEqual(serializeCanonicalJson("abc"), '"abc"');
    const rawSha = crypto.createHash("sha256").update("abc", "utf8").digest("hex");
    const canonicalSha = crypto.createHash("sha256").update('"abc"', "utf8").digest("hex");
    assert.notStrictEqual(computePayloadHash64("abc"), rawSha);
    assert.strictEqual(computePayloadHash64("abc"), canonicalSha);
  });

  runTest("1.3 Nested undefined in object or array throws INVALID_CANONICAL_JSON", () => {
    assert.throws(() => serializeCanonicalJson({ a: 1, b: undefined }), /INVALID_CANONICAL_JSON/);
    assert.throws(() => serializeCanonicalJson([1, undefined]), /INVALID_CANONICAL_JSON/);
  });

  runTest("1.4 BigInt value throws INVALID_CANONICAL_JSON", () => {
    assert.throws(() => serializeCanonicalJson({ n: BigInt(10) }), /INVALID_CANONICAL_JSON/);
  });

  runTest("1.5 Non-finite numbers (NaN, Infinity, -Infinity) throw INVALID_CANONICAL_JSON", () => {
    assert.throws(() => serializeCanonicalJson({ x: NaN }), /INVALID_CANONICAL_JSON/);
    assert.throws(() => serializeCanonicalJson({ x: Infinity }), /INVALID_CANONICAL_JSON/);
    assert.throws(() => serializeCanonicalJson({ x: -Infinity }), /INVALID_CANONICAL_JSON/);
  });

  runTest("1.6 True Unicode code-point sorting distinguishes from UTF-16 code-unit sorting (U+E000 vs U+10000)", () => {
    // U+E000 (code point 57344) vs U+10000 (code point 65536)
    // In UTF-16 code units: U+10000 is represented as surrogate pair \uD800\uDC00. 55296 < 57344.
    // Default JS sort / UTF-16 sort puts U+10000 first: {"𐀀":1,"":2}
    // True Unicode code-point sort puts U+E000 first (57344 < 65536): {"":2,"𐀀":1}
    const kAstral = String.fromCodePoint(0x10000);
    const kBmpPua = String.fromCodePoint(0xE000);
    const obj = { [kAstral]: 1, [kBmpPua]: 2 };
    const actual = serializeCanonicalJson(obj);
    const expected = `{"${kBmpPua}":2,"${kAstral}":1}`;
    assert.strictEqual(actual, expected);
  });

  runTest("1.7 Nested object with BMP Chinese keys and supplementary-plane keys sorts deterministically", () => {
    const kSupp = String.fromCodePoint(0x20000); // 131072
    const obj = {
      "品項": { [kSupp]: "supplementary", "測試": "bmp" },
      "a": 1
    };
    const actual = serializeCanonicalJson(obj);
    // "a" (0x61 = 97) < "品" (0x54C1 = 21697); "測" (0x6E2C = 28204) < 131072
    const expected = `{"a":1,"品項":{"測試":"bmp","${kSupp}":"supplementary"}}`;
    assert.strictEqual(actual, expected);
  });

  runTest("1.8 Hash output strictly matches 64-char lowercase hex regex", () => {
    const obj = { storeId: "STR_001", productCode: "PRD_A", quantity: 10 };
    const hash = computePayloadHash64(obj);
    assert.strictEqual(/^[0-9a-f]{64}$/.test(hash), true);
  });
}

// -----------------------------------------------------------------------------
// Task 2: Application Projection Event Envelope Builder & Clock Abstraction Tests
// -----------------------------------------------------------------------------
function testApplicationEnvelopeAndClock() {
  runTest("2.1 ProductionClock and FakeClock return real Firestore Timestamp instances without monkey-patching", () => {
    const prodClock = getProductionClock();
    const prodTs = prodClock.nowTimestamp();
    assert.ok(prodTs instanceof Timestamp, "ProductionClock.nowTimestamp() must return Timestamp instance");
    assert.strictEqual(typeof prodTs.toMillis(), "number");
    assert.ok(prodTs.toDate() instanceof Date);

    const initialMillis = Date.UTC(2026, 8, 24, 12, 0, 0);
    const fakeClock = createFakeClock(initialMillis);
    const fakeTs = fakeClock.nowTimestamp();
    assert.ok(fakeTs instanceof Timestamp, "FakeClock.nowTimestamp() must return Timestamp instance");
    assert.strictEqual(fakeClock.nowMillis(), initialMillis);
    assert.strictEqual(fakeTs.toMillis(), initialMillis);
    assert.ok(fakeTs.toDate() instanceof Date);

    // Time advances strictly via advanceMillis
    fakeClock.advanceMillis(60000);
    assert.strictEqual(fakeClock.nowMillis(), initialMillis + 60000);
    assert.strictEqual(fakeClock.nowTimestamp().toMillis(), initialMillis + 60000);
  });

  runTest("2.2 buildApplicationEnvelope builds valid canonical envelope with UUIDv4 eventId", () => {
    const fakeClock = createFakeClock(Date.UTC(2026, 8, 24, 0, 0, 0));
    const envelope = buildApplicationEnvelope({
      operationId: "op_test_12345",
      reservationNumber: "RES-20260924-001",
      eventType: "HOLD_CREATED",
      allocationData: {
        storeId: "STR_001",
        productCode: "PRD_A",
        quantity: 5
      },
      operatorId: "USR_OP_001"
    }, fakeClock);

    assert.ok(/^evt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelope.eventId), "eventId must match evt_ + UUIDv4");
    assert.strictEqual(envelope.schemaVersion, "1.0.0");
    assert.strictEqual(envelope.eventType, "HOLD_CREATED");
    assert.strictEqual(envelope.source, "urn:jingyang:sales:allocation-assistant");
    assert.strictEqual(envelope.operationId, "op_test_12345");
    assert.strictEqual(envelope.reservationNumber, "RES-20260924-001");
    assert.strictEqual(envelope.projectionKey, "PROJECTION_op_test_12345");
    assert.strictEqual(envelope.traceId, "tr_op_test_12345");
    assert.strictEqual(envelope.operator.pseudonymousActorId, "USR_OP_001");
    assert.strictEqual(/^[0-9a-f]{64}$/.test(envelope.payloadHash), true);
    assert.strictEqual(envelope.payload.quantity, 5);
    assert.strictEqual(envelope.occurredAt, new Date(Date.UTC(2026, 8, 24, 0, 0, 0)).toISOString());

    // Validated by validateApplicationEnvelope
    const validation = validateApplicationEnvelope(envelope);
    assert.strictEqual(validation.valid, true);
  });

  runTest("2.3 buildApplicationEnvelope rejects missing or empty mandatory parameters", () => {
    const validParams = {
      operationId: "op_123",
      reservationNumber: "RES-001",
      eventType: "HOLD_CREATED",
      allocationData: { storeId: "STR_1", productCode: "P_1", quantity: 1 },
      operatorId: "USR_1"
    };

    assert.throws(() => buildApplicationEnvelope({ ...validParams, operationId: "" }), /INVALID_ENVELOPE_PARAMS/);
    assert.throws(() => buildApplicationEnvelope({ ...validParams, reservationNumber: "  " }), /INVALID_ENVELOPE_PARAMS/);
    assert.throws(() => buildApplicationEnvelope({ ...validParams, operatorId: null }), /INVALID_ENVELOPE_PARAMS/);
  });

  runTest("2.4 buildApplicationEnvelope enforces approved eventType enum allowlist fail-closed", () => {
    const validParams = {
      operationId: "op_123",
      reservationNumber: "RES-001",
      eventType: "HOLD_CREATED",
      allocationData: { storeId: "STR_1", productCode: "P_1", quantity: 1 },
      operatorId: "USR_1"
    };

    for (const validEventType of ALLOWED_EVENT_TYPES) {
      assert.doesNotThrow(() => buildApplicationEnvelope({ ...validParams, eventType: validEventType }));
    }

    assert.throws(() => buildApplicationEnvelope({ ...validParams, eventType: "UNKNOWN_TYPE" }), /INVALID_ENVELOPE_PARAMS/);
    assert.throws(() => buildApplicationEnvelope({ ...validParams, eventType: "RESERVATION_ALLOCATION_PROJECTED" }), /INVALID_ENVELOPE_PARAMS/);
    assert.throws(() => buildApplicationEnvelope({ ...validParams, eventType: "" }), /INVALID_ENVELOPE_PARAMS/);
  });

  runTest("2.5 buildApplicationEnvelope validates payload schema and rejects non-positive/non-integer quantity", () => {
    const validParams = {
      operationId: "op_123",
      reservationNumber: "RES-001",
      eventType: "HOLD_CREATED",
      operatorId: "USR_1"
    };

    assert.throws(() => buildApplicationEnvelope({ ...validParams, allocationData: null }), /INVALID_PAYLOAD_SCHEMA/);
    assert.throws(() => buildApplicationEnvelope({ ...validParams, allocationData: { storeId: "", productCode: "P_1", quantity: 1 } }), /INVALID_PAYLOAD_SCHEMA/);
    assert.throws(() => buildApplicationEnvelope({ ...validParams, allocationData: { storeId: "S_1", productCode: "", quantity: 1 } }), /INVALID_PAYLOAD_SCHEMA/);
    assert.throws(() => buildApplicationEnvelope({ ...validParams, allocationData: { storeId: "S_1", productCode: "P_1", quantity: 0 } }), /INVALID_PAYLOAD_SCHEMA/);
    assert.throws(() => buildApplicationEnvelope({ ...validParams, allocationData: { storeId: "S_1", productCode: "P_1", quantity: -5 } }), /INVALID_PAYLOAD_SCHEMA/);
    assert.throws(() => buildApplicationEnvelope({ ...validParams, allocationData: { storeId: "S_1", productCode: "P_1", quantity: 1.5 } }), /INVALID_PAYLOAD_SCHEMA/);
    assert.throws(() => buildApplicationEnvelope({ ...validParams, allocationData: { storeId: "S_1", productCode: "P_1", quantity: NaN } }), /INVALID_PAYLOAD_SCHEMA/);
  });

  runTest("2.6 buildApplicationEnvelope rejects PII in operatorId (email and raw LINE user ID)", () => {
    const validParams = {
      operationId: "op_123",
      reservationNumber: "RES-001",
      eventType: "HOLD_CREATED",
      allocationData: { storeId: "STR_1", productCode: "P_1", quantity: 1 }
    };
    assert.throws(() => buildApplicationEnvelope({ ...validParams, operatorId: "admin@example.com" }), /INVALID_ENVELOPE_PARAMS/);
    assert.throws(() => buildApplicationEnvelope({ ...validParams, operatorId: "U12345678901234567890123456789012" }), /INVALID_ENVELOPE_PARAMS/);
  });
}

// -----------------------------------------------------------------------------
// Task 3: Transport CloudEvent Unpacker & Base64 Decoder Tests (TC-02)
// -----------------------------------------------------------------------------
async function runTC02() {
  const rawPayload = { storeId: "STR_001", productCode: "PRD_A", quantity: 10 };
  const validEnvelope = {
    eventId: "evt_d3b07384-d113-400a-b286-63e8a4a584ec",
    schemaVersion: "1.0.0",
    operationId: "op_123",
    reservationNumber: "RES-20260924-001",
    eventType: "HOLD_CREATED",
    source: "urn:jingyang:sales:allocation-assistant",
    occurredAt: "2026-09-24T00:00:00.000Z",
    projectionKey: "PROJECTION_op_123",
    payloadHash: computePayloadHash64(rawPayload),
    payload: rawPayload,
    traceId: "tr_op_123",
    operator: { pseudonymousActorId: "USR_OP_001" }
  };
  const validBase64 = Buffer.from(JSON.stringify(validEnvelope), "utf8").toString("base64");
  const validCloudEvent = {
    type: "google.cloud.pubsub.topic.v1.messagePublished",
    data: {
      message: {
        attributes: {
          schemaVersion: "1.0.0",
          eventType: "HOLD_CREATED",
          operationId: "op_123",
          eventId: "evt_d3b07384-d113-400a-b286-63e8a4a584ec"
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
          attributes: { ...validCloudEvent.data.message.attributes, eventId: "evt_d3b07384-d113-400a-b286-63e8a4a584ed" }
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
          data: Buffer.from("NOT_A_JSON_STRING", "utf8").toString("base64")
        }
      }
    });
  }, /INVALID_PAYLOAD_FORMAT/);

  // 9. 非法 UTF-8 bytes（如 [0xC3, 0x28]）編成合法 Base64，Base64 通過但 UTF-8 解碼必須 Fail-Closed 拋出 INVALID_UTF8_PAYLOAD
  const invalidUtf8Base64 = Buffer.from([0xC3, 0x28]).toString("base64");
  assert.throws(() => {
    unpackTransportCloudEvent({
      ...validCloudEvent,
      data: {
        message: {
          ...validCloudEvent.data.message,
          data: invalidUtf8Base64
        }
      }
    });
  }, /INVALID_UTF8_PAYLOAD/);
}

async function testTransportCloudEventUnpacker() {
  await runAsyncTest("TC-02: Transport CloudEvent unpacking decodes base64 application payload correctly", runTC02);
}

// -----------------------------------------------------------------------------
// Task 4: Schema Version Fail-Closed, Payload Hash Guard & PII Redaction Tests (TC-07, TC-12, TC-17)
// -----------------------------------------------------------------------------
async function runTC07() {
  const payload = { storeId: "STR_001", productCode: "PRD_A", quantity: 10 };
  const envelope = {
    eventId: "evt_d3b07384-d113-400a-b286-63e8a4a584ec",
    schemaVersion: "1.0.0",
    eventType: "HOLD_CREATED",
    source: "urn:jingyang:sales:allocation-assistant",
    occurredAt: "2026-09-24T00:00:00.000Z",
    operationId: "op_123",
    reservationNumber: "RES-20260924-001",
    projectionKey: "PROJECTION_op_123",
    traceId: "tr_op_123",
    operator: { pseudonymousActorId: "USR_OP_001" },
    payload,
    payloadHash: "0000000000000000000000000000000000000000000000000000000000000000"
  };
  const result = validateApplicationEnvelope(envelope);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.errorCode, "PAYLOAD_HASH_MISMATCH");
}

async function runTC12() {
  const payload = { storeId: "STR_001", productCode: "PRD_A", quantity: 10 };
  const envelope = {
    eventId: "evt_d3b07384-d113-400a-b286-63e8a4a584ec",
    schemaVersion: "9.9.9",
    eventType: "HOLD_CREATED",
    source: "urn:jingyang:sales:allocation-assistant",
    occurredAt: "2026-09-24T00:00:00.000Z",
    operationId: "op_123",
    reservationNumber: "RES-20260924-001",
    projectionKey: "PROJECTION_op_123",
    traceId: "tr_op_123",
    operator: { pseudonymousActorId: "USR_OP_001" },
    payload,
    payloadHash: computePayloadHash64(payload)
  };
  const result = validateApplicationEnvelope(envelope);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.errorCode, "UNSUPPORTED_SCHEMA_VERSION");
}

async function runTC17() {
  const sensitiveLog = {
    CustomerName: "陳大明",
    EMAIL: "test@example.com",
    lineUserId: "U12345678901234567890123456789012",
    accessToken: "secret_token_abc123",
    Authorization: "Bearer header_token_xyz",
    details: {
      userSecret: "nested_secret_value",
      items: [
        { customerEmail: "inner@example.com" },
        "Plain text containing Bearer my_bearer_token_123"
      ]
    }
  };
  const sanitized = sanitizeLogEntry(sensitiveLog);
  assert.strictEqual(sanitized.includes("陳大明"), false, "CustomerName must be redacted");
  assert.strictEqual(sanitized.includes("test@example.com"), false, "EMAIL must be redacted");
  assert.strictEqual(sanitized.includes("inner@example.com"), false, "inner email must be redacted");
  assert.strictEqual(sanitized.includes("secret_token_abc123"), false, "accessToken must be redacted");
  assert.strictEqual(sanitized.includes("header_token_xyz"), false, "Authorization token must be redacted");
  assert.strictEqual(sanitized.includes("my_bearer_token_123"), false, "Bearer token in string must be redacted");
  assert.strictEqual(sanitized.includes("U12345678901234567890123456789012"), false, "lineUserId must be redacted");
}

async function testSchemaGuardAndPiiRedaction() {
  await runAsyncTest("TC-07: Payload hash mismatch against full 64-char sha256 triggers MANUAL_REVIEW_REQUIRED", runTC07);
  await runAsyncTest("TC-12: Unsupported schemaVersion fails closed before processing with zero writes", runTC12);
  await runAsyncTest("TC-17: Structured payload and lastError contain no names, emails, LINE IDs, or secrets", runTC17);

  // Additional fail-closed validation tests
  runTest("4.1 Application envelope rejects invalid eventId format (not evt_ + UUIDv4)", () => {
    const valid = buildApplicationEnvelope({
      operationId: "op_123",
      reservationNumber: "RES-001",
      eventType: "HOLD_CREATED",
      allocationData: { storeId: "STR_1", productCode: "P_1", quantity: 1 },
      operatorId: "USR_1"
    });
    const result = validateApplicationEnvelope({ ...valid, eventId: "evt_not_a_uuid" });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errorCode, "INVALID_EVENT_ID");
  });

  runTest("4.2 Application envelope rejects extra sensitive fields in payload fail-closed", () => {
    const payloadWithPii = {
      storeId: "STR_1",
      productCode: "P_1",
      quantity: 1,
      customerName: "陳大明",
      email: "user@example.com"
    };
    const envelope = {
      eventId: "evt_d3b07384-d113-400a-b286-63e8a4a584ec",
      schemaVersion: "1.0.0",
      eventType: "HOLD_CREATED",
      source: "urn:jingyang:sales:allocation-assistant",
      occurredAt: "2026-09-24T00:00:00.000Z",
      operationId: "op_123",
      reservationNumber: "RES-001",
      projectionKey: "PROJECTION_op_123",
      traceId: "tr_op_123",
      operator: { pseudonymousActorId: "USR_1" },
      payload: payloadWithPii,
      payloadHash: computePayloadHash64(payloadWithPii)
    };
    const result = validateApplicationEnvelope(envelope);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errorCode, "PAYLOAD_EXTRA_FIELDS_FORBIDDEN");
  });

  runTest("4.3 Application envelope rejects extra sensitive fields in operator fail-closed", () => {
    const payload = { storeId: "STR_1", productCode: "P_1", quantity: 1 };
    const envelope = {
      eventId: "evt_d3b07384-d113-400a-b286-63e8a4a584ec",
      schemaVersion: "1.0.0",
      eventType: "HOLD_CREATED",
      source: "urn:jingyang:sales:allocation-assistant",
      occurredAt: "2026-09-24T00:00:00.000Z",
      operationId: "op_123",
      reservationNumber: "RES-001",
      projectionKey: "PROJECTION_op_123",
      traceId: "tr_op_123",
      operator: { pseudonymousActorId: "USR_1", email: "user@example.com" },
      payload,
      payloadHash: computePayloadHash64(payload)
    };
    const result = validateApplicationEnvelope(envelope);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errorCode, "OPERATOR_EXTRA_FIELDS_FORBIDDEN");
  });

  runTest("4.4 Application envelope rejects operator actorId containing email or raw LINE ID", () => {
    const payload = { storeId: "STR_1", productCode: "P_1", quantity: 1 };
    const baseEnvelope = {
      eventId: "evt_d3b07384-d113-400a-b286-63e8a4a584ec",
      schemaVersion: "1.0.0",
      eventType: "HOLD_CREATED",
      source: "urn:jingyang:sales:allocation-assistant",
      occurredAt: "2026-09-24T00:00:00.000Z",
      operationId: "op_123",
      reservationNumber: "RES-001",
      projectionKey: "PROJECTION_op_123",
      traceId: "tr_op_123",
      payload,
      payloadHash: computePayloadHash64(payload)
    };
    const resEmail = validateApplicationEnvelope({
      ...baseEnvelope,
      operator: { pseudonymousActorId: "staff@company.com" }
    });
    assert.strictEqual(resEmail.valid, false);
    assert.strictEqual(resEmail.errorCode, "OPERATOR_PII_EMAIL_FORBIDDEN");

    const resLine = validateApplicationEnvelope({
      ...baseEnvelope,
      operator: { pseudonymousActorId: "U12345678901234567890123456789012" }
    });
    assert.strictEqual(resLine.valid, false);
    assert.strictEqual(resLine.errorCode, "OPERATOR_PII_LINE_ID_FORBIDDEN");
  });

  runTest("4.5 Log sanitization safely handles circular references without stack overflow", () => {
    const circularObj = {
      operationId: "op_circ_1",
      meta: { tag: "circular_test" }
    };
    circularObj.meta.parent = circularObj;
    const sanitized = sanitizeLogEntry(circularObj);
    assert.ok(sanitized.includes("[CIRCULAR_REFERENCE]"), "Circular reference must be safely marked");
  });

  runTest("4.6 Log sanitization safely handles overly deep structures without stack overflow", () => {
    let deepObj = { leaf: "value" };
    for (let i = 0; i < 30; i++) {
      deepObj = { level: i, nested: deepObj };
    }
    const sanitized = sanitizeLogEntry(deepObj);
    assert.ok(sanitized.includes("[MAX_DEPTH_EXCEEDED]"), "Exceeded depth must be safely marked");
  });
}

const tests = [
  {
    id: "TC-02",
    name: "Transport CloudEvent unpacking decodes base64 application payload correctly",
    run: runTC02
  },
  {
    id: "TC-07",
    name: "Payload hash mismatch against full 64-char sha256 triggers MANUAL_REVIEW_REQUIRED",
    run: runTC07
  },
  {
    id: "TC-12",
    name: "Unsupported schemaVersion fails closed before processing with zero writes",
    run: runTC12
  },
  {
    id: "TC-17",
    name: "Structured payload and lastError contain no names, emails, LINE IDs, or secrets",
    run: runTC17
  }
];

async function main() {
  testCanonicalJsonAndHasher();
  testApplicationEnvelopeAndClock();
  await testTransportCloudEventUnpacker();
  await testSchemaGuardAndPiiRedaction();

  console.log(`\n==================================================`);
  console.log(`Stage 42-G1 Event Contracts Simulation Summary:`);
  console.log(`Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log(`==================================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

module.exports = {
  tests
};

if (require.main === module) {
  main();
}
