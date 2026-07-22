"use strict";

const crypto = require("node:crypto");

const LOG_SCHEMA_VERSION = "v1";
const LOG_HEADERS = [
  "id", "dedupeKey", "schemaVersion", "taskId", "recipientUsername", "recipientMasked",
  "bucket", "bucketDate", "dueDateKey", "status", "createdAt", "reservedAt", "sentAt",
  "updatedAt", "requestIdShort", "attemptCount", "errorCode", "source", "noteSafe",
  "parentLogId", "resolution", "resolvedAt", "resolvedBy"
];
const LOG_STATUSES = [
  "CANDIDATE", "RESERVED", "SENT", "FAILED", "UNKNOWN_OUTCOME", "SKIPPED",
  "CANCELLED_RESERVATION", "RESOLVED_SENT", "RESOLVED_NOT_SENT"
];
const LOG_BUCKETS = ["DUE_TODAY", "OVERDUE"];
const LOG_SOURCES = ["TASK_DUE_REMINDER", "MANUAL_RETRY", "SETUP_TEST", "CONTROLLED_LIVE_TEST"];
const LOG_NOTE_SAFE_VALUES = ["", "DO_NOT_RETRY", "OPERATOR_REVIEW_REQUIRED", "SCHEMA_CHECK", "SETUP_CREATED", "SETUP_EXISTS", "CONTROLLED_TEST", "CONTROLLED_LIVE_TEST"];
const LOG_EXACT_BLOCK_REASONS = {
  RESERVED: "DUPLICATE_RESERVED",
  SENT: "DUPLICATE_SENT",
  UNKNOWN_OUTCOME: "DUPLICATE_UNKNOWN_OUTCOME",
  RESOLVED_SENT: "DUPLICATE_RESOLVED_SENT",
  FAILED: "DUPLICATE_FAILED",
  RESOLVED_NOT_SENT: "DUPLICATE_RESOLVED_NOT_SENT",
  CANCELLED_RESERVATION: "DUPLICATE_CANCELLED_RESERVATION",
  CANDIDATE: "LOG_NONRESERVABLE_STATE",
  SKIPPED: "LOG_NONRESERVABLE_STATE"
};
const LOG_TASK_DAY_BLOCK_REASONS = {
  RESERVED: "TASK_DAY_RESERVED",
  SENT: "TASK_DAY_SENT",
  UNKNOWN_OUTCOME: "TASK_DAY_UNKNOWN_OUTCOME",
  RESOLVED_SENT: "TASK_DAY_RESOLVED_SENT",
  FAILED: "TASK_DAY_FAILED",
  RESOLVED_NOT_SENT: "TASK_DAY_RESOLVED_NOT_SENT",
  CANCELLED_RESERVATION: "TASK_DAY_CANCELLED_RESERVATION",
  CANDIDATE: "LOG_NONRESERVABLE_STATE",
  SKIPPED: "LOG_NONRESERVABLE_STATE"
};

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function hmacSha256Hex(value, key) {
  return crypto.createHmac("sha256", String(key || "")).update(String(value || "")).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runSuite(name, cases) {
  let pass = 0;
  const failures = [];
  for (const item of cases) {
    try {
      item.run();
      pass += 1;
      console.log(`PASS ${name}: ${item.name}`);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      failures.push({ name: item.name, error: message });
      console.error(`FAIL ${name}: ${item.name}: ${message}`);
    }
  }
  console.log(`${name}: ${pass} PASS / ${failures.length} FAIL`);
  if (failures.length) process.exitCode = 1;
  return { pass, fail: failures.length, failures };
}

function isDateKey(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function buildDedupeKey(taskId, bucketDate, bucket, username) {
  return sha256([
    LOG_SCHEMA_VERSION,
    String(taskId || "").trim(),
    String(bucketDate || "").trim(),
    String(bucket || "").trim().toUpperCase(),
    normalizeUsername(username)
  ].join("|"));
}

function buildTaskDayGuardKey(taskId, bucketDate, username) {
  const taskIdKey = String(taskId || "").trim();
  const dateKey = String(bucketDate || "").trim();
  const usernameKey = normalizeUsername(username);
  if (!taskIdKey || !isDateKey(dateKey) || !usernameKey) return "";
  return sha256([LOG_SCHEMA_VERSION, taskIdKey, dateKey, usernameKey].join("|"));
}

function validTimestamp(value, allowBlank) {
  if (value === undefined || value === null || value === "") return allowBlank === true;
  if (typeof value !== "string" || !value.includes("T")) return false;
  return Number.isFinite(Date.parse(value));
}

function validateLogSchema(headers) {
  if (!Array.isArray(headers) || headers.length !== LOG_HEADERS.length) return { ok: false, errorCode: "LOG_SCHEMA_INVALID" };
  const seen = new Set();
  for (let i = 0; i < LOG_HEADERS.length; i += 1) {
    if (!headers[i] || seen.has(headers[i]) || headers[i] !== LOG_HEADERS[i]) return { ok: false, errorCode: "LOG_SCHEMA_INVALID" };
    seen.add(headers[i]);
  }
  return { ok: true, status: "VALID", columnCount: LOG_HEADERS.length };
}

function validateLogRow(row) {
  const item = row || {};
  for (const key of Object.keys(item)) {
    if (!LOG_HEADERS.includes(key) || ["lineUserId", "customerName", "messageBody", "token", "secret", "endpoint", "rawResponse", "stack"].includes(key)) {
      return { ok: false, errorCode: "LOG_ROW_INVALID" };
    }
  }
  if (item.schemaVersion !== LOG_SCHEMA_VERSION) return { ok: false, errorCode: "LOG_VERSION_UNSUPPORTED" };
  if (!LOG_STATUSES.includes(String(item.status || ""))) return { ok: false, errorCode: "LOG_STATUS_INVALID" };
  if (!LOG_BUCKETS.includes(String(item.bucket || ""))) return { ok: false, errorCode: "LOG_ROW_INVALID" };
  if (!LOG_SOURCES.includes(String(item.source || ""))) return { ok: false, errorCode: "LOG_ROW_INVALID" };
  if (!/^[a-f0-9]{64}$/.test(String(item.dedupeKey || ""))) return { ok: false, errorCode: "LOG_ROW_INVALID" };
  if (String(item.dedupeKey) !== buildDedupeKey(item.taskId, item.bucketDate, item.bucket, item.recipientUsername)) return { ok: false, errorCode: "LOG_DEDUPE_MISMATCH" };
  if (String(item.recipientUsername || "") !== normalizeUsername(item.recipientUsername)) return { ok: false, errorCode: "LOG_ROW_INVALID" };
  if (item.recipientMasked && !/^U[a-fA-F0-9]{3}\.\.\.[a-fA-F0-9]{4}$/.test(item.recipientMasked)) return { ok: false, errorCode: "LOG_ROW_INVALID" };
  if (!isDateKey(item.bucketDate) || !isDateKey(item.dueDateKey)) return { ok: false, errorCode: "LOG_ROW_INVALID" };
  if (!validTimestamp(item.createdAt, false) || !validTimestamp(item.updatedAt, false)) return { ok: false, errorCode: "LOG_ROW_INVALID" };
  if (!Number.isInteger(Number(item.attemptCount)) || Number(item.attemptCount) < 0) return { ok: false, errorCode: "LOG_ROW_INVALID" };
  if (!LOG_NOTE_SAFE_VALUES.includes(String(item.noteSafe || ""))) return { ok: false, errorCode: "LOG_ROW_INVALID" };
  if (item.status === "RESERVED" && !validTimestamp(item.reservedAt, false)) return { ok: false, errorCode: "LOG_ROW_INVALID" };
  if (item.status === "SENT" && (!validTimestamp(item.sentAt, false) || item.errorCode || item.resolution)) return { ok: false, errorCode: "LOG_ROW_INVALID" };
  return { ok: true, status: "VALID" };
}

function buildLookupIndex(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const index = {
    ok: true,
    byDedupeKey: {},
    byTaskDayGuardKey: {},
    duplicateDedupeKeys: [],
    duplicateTaskDayGuardKeys: [],
    statusCounts: {},
    rowCount: sourceRows.length
  };
  const rowsById = {};
  for (const row of sourceRows) {
    const validation = validateLogRow(row);
    if (!validation.ok) return validation;
    if (row.id) {
      if (rowsById[row.id]) return { ok: false, errorCode: "LOG_RESERVATION_CONFLICT" };
      rowsById[row.id] = row;
    }
    if (index.byDedupeKey[row.dedupeKey]) return { ok: false, errorCode: "LOG_DUPLICATE_KEY" };
    index.byDedupeKey[row.dedupeKey] = row;
    const guardKey = buildTaskDayGuardKey(row.taskId, row.bucketDate, row.recipientUsername);
    if (!guardKey) return { ok: false, errorCode: "LOG_GUARD_CONFLICT" };
    if (!index.byTaskDayGuardKey[guardKey]) index.byTaskDayGuardKey[guardKey] = [];
    index.byTaskDayGuardKey[guardKey].push(row);
    index.statusCounts[row.status] = (index.statusCounts[row.status] || 0) + 1;
  }
  for (const rowsForGuard of Object.values(index.byTaskDayGuardKey)) {
    if (rowsForGuard.length > 1) return { ok: false, errorCode: "LOG_RESERVATION_CONFLICT" };
  }
  return index;
}

function evaluateReservation(candidate, lookupIndex) {
  const item = candidate || {};
  const username = normalizeUsername(item.recipientUsername);
  if (!item.taskId || !/^[a-f0-9]{64}$/.test(String(item.dedupeKey || "")) || !LOG_BUCKETS.includes(String(item.bucket || "").toUpperCase()) ||
      !isDateKey(String(item.bucketDate || "")) || !isDateKey(String(item.dueDateKey || "")) ||
      !username || String(item.recipientUsername || "") !== username) {
    return { ok: false, decision: "ERROR", errorCode: "RESERVATION_CANDIDATE_INVALID" };
  }
  if (item.dedupeKey !== buildDedupeKey(item.taskId, item.bucketDate, item.bucket, username)) {
    return { ok: false, decision: "ERROR", errorCode: "RESERVATION_DEDUPE_MISMATCH" };
  }
  if (!lookupIndex || lookupIndex.ok !== true) return { ok: false, decision: "ERROR", errorCode: lookupIndex && lookupIndex.errorCode ? lookupIndex.errorCode : "LOG_SCHEMA_INVALID" };
  const exact = lookupIndex.byDedupeKey[item.dedupeKey];
  if (exact) return { ok: true, decision: "BLOCK_RESERVATION", reason: LOG_EXACT_BLOCK_REASONS[exact.status] || "LOG_NONRESERVABLE_STATE" };
  const guardRows = lookupIndex.byTaskDayGuardKey[buildTaskDayGuardKey(item.taskId, item.bucketDate, username)] || [];
  if (guardRows.length) return { ok: true, decision: "BLOCK_RESERVATION", reason: LOG_TASK_DAY_BLOCK_REASONS[guardRows[0].status] || "LOG_NONRESERVABLE_STATE" };
  return { ok: true, decision: "ALLOW_RESERVATION", reason: "NO_CONFLICT" };
}

function cloneRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => Object.assign({}, row));
}

function makeReservedRowFromCandidate(candidate, nowIso, id) {
  const item = Object.assign({}, candidate || {});
  const username = normalizeUsername(item.recipientUsername);
  item.recipientUsername = username;
  item.bucket = String(item.bucket || "").trim().toUpperCase();
  item.dedupeKey = buildDedupeKey(item.taskId, item.bucketDate, item.bucket, username);
  return Object.assign({
    id: id || "generated-id-1",
    schemaVersion: LOG_SCHEMA_VERSION,
    status: "RESERVED",
    createdAt: nowIso || "2026-07-22T01:00:00.000Z",
    reservedAt: nowIso || "2026-07-22T01:00:00.000Z",
    sentAt: "",
    updatedAt: nowIso || "2026-07-22T01:00:00.000Z",
    requestIdShort: "",
    attemptCount: 0,
    errorCode: "",
    parentLogId: "",
    resolution: "",
    resolvedAt: "",
    resolvedBy: ""
  }, item);
}

function reserveInMemory(candidate, store, options = {}) {
  const rows = cloneRows(store && store.rows);
  const item = Object.assign({}, candidate || {});
  item.recipientUsername = normalizeUsername(item.recipientUsername);
  item.bucket = String(item.bucket || "").trim().toUpperCase();
  item.dedupeKey = buildDedupeKey(item.taskId, item.bucketDate, item.bucket, item.recipientUsername);
  const tempDecision = evaluateReservation(item, { ok: true, byDedupeKey: {}, byTaskDayGuardKey: {} });
  if (tempDecision.decision === "ERROR") return { ok: false, status: "INVALID", errorCode: tempDecision.errorCode };
  if (options.lockAvailable === false) return { ok: false, status: "INVALID", errorCode: "LOG_LOCK_TIMEOUT" };
  const index = buildLookupIndex(rows);
  if (!index.ok) return { ok: false, status: "INVALID", errorCode: index.errorCode || "LOG_SCHEMA_INVALID" };
  const decision = evaluateReservation(item, index);
  if (decision.decision === "BLOCK_RESERVATION") {
    return { ok: true, mode: options.mode || "controlled-write-test", status: "BLOCKED", created: false, duplicateBlocked: true, reason: decision.reason };
  }
  if (decision.decision === "ERROR") return { ok: false, status: "INVALID", errorCode: decision.errorCode || "LOG_SCHEMA_INVALID" };
  if (options.dryRun === true) {
    return { ok: true, mode: "dry-run", status: "WOULD_RESERVE", created: false, dryRun: true, dedupeKey: item.dedupeKey };
  }
  const newRow = makeReservedRowFromCandidate(item, options.nowIso, options.id);
  const validation = validateLogRow(newRow);
  if (!validation.ok) return { ok: false, status: "INVALID", errorCode: validation.errorCode || "LOG_ROW_INVALID" };
  const nextRows = rows.concat([newRow]);
  if (options.reReadConflict === true) return { ok: false, status: "INVALID", errorCode: "LOG_UPDATE_CONFLICT" };
  const reIndex = buildLookupIndex(nextRows);
  if (!reIndex.ok || !reIndex.byDedupeKey[item.dedupeKey] || reIndex.byDedupeKey[item.dedupeKey].status !== "RESERVED") {
    return { ok: false, status: "INVALID", errorCode: "LOG_UPDATE_CONFLICT" };
  }
  if (store && Array.isArray(store.rows)) store.rows = nextRows;
  return {
    ok: true,
    mode: options.mode || "controlled-write-test",
    status: "RESERVED",
    created: true,
    duplicateBlocked: false,
    schemaVersion: LOG_SCHEMA_VERSION,
    rowCountBefore: rows.length,
    rowCountAfter: nextRows.length,
    dedupeKey: item.dedupeKey,
    row: reIndex.byDedupeKey[item.dedupeKey],
    dedupeKeyShort: item.dedupeKey.substring(0, 12),
    taskDayGuardKeyShort: buildTaskDayGuardKey(item.taskId, item.bucketDate, item.recipientUsername).substring(0, 12)
  };
}

function makeCandidate(overrides = {}) {
  const candidate = Object.assign({
    taskId: "TASK-001",
    recipientUsername: "sales01",
    recipientMasked: "U123...abcd",
    bucket: "DUE_TODAY",
    bucketDate: "2026-07-22",
    dueDateKey: "2026-07-22",
    source: "TASK_DUE_REMINDER",
    noteSafe: ""
  }, overrides);
  candidate.dedupeKey = buildDedupeKey(candidate.taskId, candidate.bucketDate, candidate.bucket, candidate.recipientUsername);
  return candidate;
}

function makeLogRow(overrides = {}) {
  const candidate = makeCandidate(overrides);
  return Object.assign({
    id: "1",
    schemaVersion: LOG_SCHEMA_VERSION,
    status: "RESERVED",
    createdAt: "2026-07-22T01:00:00.000Z",
    reservedAt: "2026-07-22T01:00:00.000Z",
    sentAt: "",
    updatedAt: "2026-07-22T01:00:00.000Z",
    requestIdShort: "",
    attemptCount: 0,
    errorCode: "",
    parentLogId: "",
    resolution: "",
    resolvedAt: "",
    resolvedBy: ""
  }, candidate, overrides);
}

function lineUserId(seed = "1234567890abcdef1234567890abcdef") {
  return `U${seed.slice(0, 32).padEnd(32, "0")}`;
}

function isValidLineUserId(value) {
  return /^U[a-fA-F0-9]{32}$/.test(String(value || ""));
}

module.exports = {
  LOG_HEADERS,
  assert,
  buildDedupeKey,
  buildLookupIndex,
  buildTaskDayGuardKey,
  evaluateReservation,
  hmacSha256Hex,
  isDateKey,
  isValidLineUserId,
  lineUserId,
  makeCandidate,
  makeLogRow,
  reserveInMemory,
  normalizeUsername,
  runSuite,
  sha256,
  validateLogRow,
  validateLogSchema
};
