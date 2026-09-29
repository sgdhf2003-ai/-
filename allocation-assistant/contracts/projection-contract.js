"use strict";

/**
 * Stage 42-G1 Event Contracts & Canonical Serializer
 *
 * Implements:
 * - Deterministic Canonical JSON serialization with Unicode code-point sorting.
 * - Full 64-character lowercase SHA-256 hex payload hashing.
 * - Fail-closed rejection of undefined, function, symbol, bigint, non-finite numbers, and non-plain objects.
 * - Clock abstraction returning true Firestore Timestamp without monkey-patching.
 * - Application Envelope Builder with strict schemaVersion 1.0.0 validation.
 * - Transport CloudEvent Unpacker with fatal UTF-8 decoding and dual-layer consistency check.
 * - PII and sensitive data fail-closed validation & circular-reference-safe log sanitization.
 */

const crypto = require("crypto");

/**
 * Compares two strings lexicographically by their Unicode code point values.
 * This strictly distinguishes code-point ascending order from UTF-16 code-unit order.
 */
function compareByCodePoint(a, b) {
  if (a === b) return 0;
  const charsA = Array.from(a);
  const charsB = Array.from(b);
  const minLen = Math.min(charsA.length, charsB.length);
  for (let i = 0; i < minLen; i++) {
    const cpA = charsA[i].codePointAt(0);
    const cpB = charsB[i].codePointAt(0);
    if (cpA !== cpB) {
      return cpA - cpB;
    }
  }
  return charsA.length - charsB.length;
}

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
    // True Unicode code-point sorting
    const sortedKeys = Object.keys(val).sort(compareByCodePoint);
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

const ALLOWED_EVENT_TYPES = Object.freeze([
  "HOLD_CREATED",
  "HOLD_FULFILLED",
  "HOLD_CANCELLED",
  "HOLD_RECONCILED"
]);

const ALLOWED_SOURCES = Object.freeze([
  "urn:jingyang:sales:allocation-assistant",
  "jy.allocation.assistant"
]);

function getFirestoreTimestamp() {
  let TimestampClass;
  try {
    TimestampClass = require("firebase-admin/firestore").Timestamp;
  } catch (e) {
    const admin = require("firebase-admin");
    TimestampClass = admin && admin.firestore ? admin.firestore.Timestamp : null;
  }
  if (!TimestampClass) {
    throw new Error("CANNOT_RESOLVE_FIRESTORE_TIMESTAMP: firebase-admin/firestore Timestamp unavailable");
  }
  return TimestampClass;
}

function createFakeClock(initialMillis = Date.UTC(2026, 8, 24, 0, 0, 0)) {
  let currentMillis = initialMillis;
  const Timestamp = getFirestoreTimestamp();
  return {
    nowMillis() {
      return currentMillis;
    },
    nowTimestamp() {
      return Timestamp.fromMillis(currentMillis);
    },
    fromMillis(ms) {
      return Timestamp.fromMillis(ms);
    },
    advanceMillis(ms) {
      currentMillis += ms;
    }
  };
}

function getProductionClock() {
  const Timestamp = getFirestoreTimestamp();
  return {
    nowMillis() {
      return Date.now();
    },
    nowTimestamp() {
      return Timestamp.now();
    },
    fromMillis(ms) {
      return Timestamp.fromMillis(ms);
    }
  };
}

function validateAllocationPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.prototype.toString.call(payload) !== "[object Object]") {
    throw new Error("INVALID_PAYLOAD_SCHEMA: Payload must be a plain object");
  }
  const keys = Object.keys(payload);
  const allowedKeys = new Set(["storeId", "productCode", "quantity"]);
  for (const k of keys) {
    if (!allowedKeys.has(k)) {
      throw new Error(`INVALID_PAYLOAD_SCHEMA: Unexpected extra field in payload: ${k}`);
    }
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

function buildApplicationEnvelope(params, clock = getProductionClock()) {
  if (!params || typeof params !== "object") {
    throw new Error("INVALID_ENVELOPE_PARAMS: params must be an object");
  }
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
  if (operatorId.includes("@")) {
    throw new Error("INVALID_ENVELOPE_PARAMS: operatorId must not be an email address");
  }
  if (/^U[0-9a-fA-F]{32,33}$/.test(operatorId)) {
    throw new Error("INVALID_ENVELOPE_PARAMS: operatorId must not be a raw LINE User ID");
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

function validateApplicationEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || Object.prototype.toString.call(envelope) !== "[object Object]") {
    return { valid: false, errorCode: "INVALID_ENVELOPE" };
  }
  if (envelope.schemaVersion !== "1.0.0") {
    return { valid: false, errorCode: "UNSUPPORTED_SCHEMA_VERSION" };
  }
  if (typeof envelope.eventId !== "string" || !/^evt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelope.eventId.trim())) {
    return { valid: false, errorCode: "INVALID_EVENT_ID" };
  }
  if (typeof envelope.eventType !== "string" || !ALLOWED_EVENT_TYPES.includes(envelope.eventType.trim())) {
    return { valid: false, errorCode: "INVALID_EVENT_TYPE" };
  }
  if (typeof envelope.source !== "string" || !ALLOWED_SOURCES.includes(envelope.source.trim())) {
    return { valid: false, errorCode: "INVALID_SOURCE" };
  }
  if (typeof envelope.occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(envelope.occurredAt.trim()) || isNaN(Date.parse(envelope.occurredAt.trim()))) {
    return { valid: false, errorCode: "INVALID_OCCURRED_AT" };
  }
  if (typeof envelope.operationId !== "string" || envelope.operationId.trim() === "") {
    return { valid: false, errorCode: "INVALID_OPERATION_ID" };
  }
  if (typeof envelope.reservationNumber !== "string" || envelope.reservationNumber.trim() === "") {
    return { valid: false, errorCode: "INVALID_RESERVATION_NUMBER" };
  }
  if (envelope.projectionKey !== `PROJECTION_${envelope.operationId.trim()}`) {
    return { valid: false, errorCode: "INVALID_PROJECTION_KEY" };
  }
  if (typeof envelope.traceId !== "string" || envelope.traceId.trim() === "") {
    return { valid: false, errorCode: "INVALID_TRACE_ID" };
  }

  // Operator validation
  if (!envelope.operator || typeof envelope.operator !== "object" || Array.isArray(envelope.operator) || Object.prototype.toString.call(envelope.operator) !== "[object Object]") {
    return { valid: false, errorCode: "INVALID_OPERATOR" };
  }
  const operatorKeys = Object.keys(envelope.operator);
  if (operatorKeys.some(k => k !== "pseudonymousActorId")) {
    return { valid: false, errorCode: "OPERATOR_EXTRA_FIELDS_FORBIDDEN" };
  }
  const actorId = envelope.operator.pseudonymousActorId;
  if (typeof actorId !== "string" || actorId.trim() === "") {
    return { valid: false, errorCode: "INVALID_OPERATOR_ACTOR_ID" };
  }
  if (actorId.includes("@") || /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(actorId)) {
    return { valid: false, errorCode: "OPERATOR_PII_EMAIL_FORBIDDEN" };
  }
  if (/^U[0-9a-fA-F]{32,33}$/.test(actorId)) {
    return { valid: false, errorCode: "OPERATOR_PII_LINE_ID_FORBIDDEN" };
  }

  // Payload validation
  if (!envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload) || Object.prototype.toString.call(envelope.payload) !== "[object Object]") {
    return { valid: false, errorCode: "INVALID_PAYLOAD" };
  }
  const payloadKeys = Object.keys(envelope.payload);
  const allowedPayloadKeys = new Set(["storeId", "productCode", "quantity"]);
  for (const k of payloadKeys) {
    if (!allowedPayloadKeys.has(k)) {
      return { valid: false, errorCode: "PAYLOAD_EXTRA_FIELDS_FORBIDDEN" };
    }
  }
  const { storeId, productCode, quantity } = envelope.payload;
  if (typeof storeId !== "string" || storeId.trim() === "") {
    return { valid: false, errorCode: "INVALID_PAYLOAD_STORE_ID" };
  }
  if (typeof productCode !== "string" || productCode.trim() === "") {
    return { valid: false, errorCode: "INVALID_PAYLOAD_PRODUCT_CODE" };
  }
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    return { valid: false, errorCode: "INVALID_PAYLOAD_QUANTITY" };
  }

  // Payload hash validation
  if (typeof envelope.payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(envelope.payloadHash)) {
    return { valid: false, errorCode: "INVALID_PAYLOAD_HASH" };
  }
  let expectedHash;
  try {
    expectedHash = computePayloadHash64(envelope.payload);
  } catch (e) {
    return { valid: false, errorCode: "PAYLOAD_HASH_COMPUTATION_FAILED" };
  }
  if (envelope.payloadHash !== expectedHash) {
    return { valid: false, errorCode: "PAYLOAD_HASH_MISMATCH" };
  }

  return { valid: true };
}

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

  // Strict RFC 4648 Base64 validation
  const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!base64Regex.test(rawDataBase64.trim())) {
    throw new Error("INVALID_BASE64_FORMAT: Message data is not valid RFC 4648 Base64");
  }
  const buf = Buffer.from(rawDataBase64.trim(), "base64");
  if (buf.toString("base64") !== rawDataBase64.trim()) {
    throw new Error("INVALID_BASE64_FORMAT: Message data contains non-canonical or corrupted Base64 padding");
  }

  // Strict fatal UTF-8 decoding
  let jsonString;
  try {
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
    jsonString = utf8Decoder.decode(buf);
  } catch (err) {
    throw new Error("INVALID_UTF8_PAYLOAD: Payload is not valid UTF-8");
  }

  let envelope;
  try {
    envelope = JSON.parse(jsonString);
  } catch (err) {
    throw new Error("INVALID_PAYLOAD_FORMAT: Decoded payload is not valid JSON");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || Object.prototype.toString.call(envelope) !== "[object Object]") {
    throw new Error("INVALID_PAYLOAD_FORMAT: Decoded payload must be a JSON object");
  }

  // Explicit check for schemaVersion 1.0.0
  if (envelope.schemaVersion !== "1.0.0") {
    throw new Error("UNSUPPORTED_SCHEMA_VERSION: schemaVersion must be 1.0.0");
  }

  // Validate complete envelope schema
  const validation = validateApplicationEnvelope(envelope);
  if (!validation.valid) {
    throw new Error(`INVALID_APPLICATION_ENVELOPE: ${validation.errorCode}`);
  }

  // Attributes vs envelope strict matching
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

const SENSITIVE_KEYS = new Set([
  "customername", "name", "email", "lineid", "lineuserid", "userid",
  "token", "secret", "apikey", "password", "bearertoken", "auth",
  "credential", "authorization", "accesstoken", "refreshtoken",
  "idtoken", "clientsecret", "privatekey", "cookie", "setcookie"
]);

function sanitizeStringValue(str) {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  const lineIdRegex = /\bU[0-9a-fA-F]{32,33}\b/g;
  const bearerRegex = /\bBearer\s+[A-Za-z0-9_\-\.]+\b/gi;
  const tokenRegex = /(?:token|secret|key|password|credential|bearer)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{8,})['"]?/gi;

  let s = str.replace(bearerRegex, "Bearer [REDACTED]");
  s = s.replace(emailRegex, "[REDACTED_EMAIL]");
  s = s.replace(lineIdRegex, "[REDACTED_LINE_ID]");
  s = s.replace(tokenRegex, (match, p1) => match.replace(p1, "[REDACTED_SECRET]"));
  return s;
}

function redactSensitiveFields(obj, seen = new WeakSet(), depth = 0) {
  if (obj === null || typeof obj !== "object") {
    if (typeof obj === "string") {
      return sanitizeStringValue(obj);
    }
    return obj;
  }
  if (depth > 20) {
    return "[MAX_DEPTH_EXCEEDED]";
  }
  if (seen.has(obj)) {
    return "[CIRCULAR_REFERENCE]";
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveFields(item, seen, depth + 1));
  }

  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const normalizedKey = k.toLowerCase().replace(/[-_]/g, "");
    const isSensitive = SENSITIVE_KEYS.has(k.toLowerCase()) || SENSITIVE_KEYS.has(normalizedKey);
    if (isSensitive) {
      result[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null) {
      result[k] = redactSensitiveFields(v, seen, depth + 1);
    } else if (typeof v === "string") {
      result[k] = sanitizeStringValue(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function sanitizeLogEntry(entry) {
  if (entry === null || entry === undefined) return "";
  let str;
  if (typeof entry === "object") {
    try {
      const redactedObj = redactSensitiveFields(entry);
      str = JSON.stringify(redactedObj);
    } catch (err) {
      return "[LOG_SANITIZATION_FAILED]";
    }
  } else {
    str = sanitizeStringValue(String(entry));
  }
  return sanitizeStringValue(str);
}

module.exports = {
  serializeCanonicalJson,
  computePayloadHash64,
  compareByCodePoint,
  createFakeClock,
  getProductionClock,
  getFirestoreTimestamp,
  validateAllocationPayload,
  buildApplicationEnvelope,
  ALLOWED_EVENT_TYPES,
  ALLOWED_SOURCES,
  unpackTransportCloudEvent,
  validateApplicationEnvelope,
  sanitizeLogEntry
};
