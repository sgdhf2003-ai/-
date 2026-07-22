"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  LOG_HEADERS,
  assert,
  buildDedupeKey,
  buildLookupIndex,
  evaluateReservation,
  makeCandidate,
  makeLogRow,
  reserveInMemory,
  runSuite,
  validateLogRow,
  validateLogSchema
} = require("./helpers");

runSuite("task-notification-log", [
  {
    name: "schema headers valid",
    run() {
      assert(validateLogSchema(LOG_HEADERS).ok === true, "expected valid schema");
    }
  },
  {
    name: "schema rejects duplicate header",
    run() {
      const headers = LOG_HEADERS.slice();
      headers[1] = headers[0];
      assert(validateLogSchema(headers).errorCode === "LOG_SCHEMA_INVALID", "expected schema invalid");
    }
  },
  {
    name: "valid reserved row builds lookup index",
    run() {
      const index = buildLookupIndex([makeLogRow()]);
      assert(index.ok === true, "expected valid index");
      assert(index.statusCounts.RESERVED === 1, "expected reserved count");
    }
  },
  {
    name: "row rejects forbidden sensitive field",
    run() {
      const row = makeLogRow({ lineUserId: "U123" });
      assert(validateLogRow(row).errorCode === "LOG_ROW_INVALID", "expected forbidden field rejection");
    }
  },
  {
    name: "duplicate dedupe key fails closed",
    run() {
      const first = makeLogRow({ id: "1" });
      const second = makeLogRow({ id: "2" });
      assert(buildLookupIndex([first, second]).errorCode === "LOG_DUPLICATE_KEY", "expected duplicate key");
    }
  },
  {
    name: "same task day different bucket fails closed",
    run() {
      const first = makeLogRow({ id: "1", bucket: "DUE_TODAY" });
      const second = makeLogRow({ id: "2", bucket: "OVERDUE" });
      second.dedupeKey = buildDedupeKey(second.taskId, second.bucketDate, second.bucket, second.recipientUsername);
      assert(buildLookupIndex([first, second]).errorCode === "LOG_RESERVATION_CONFLICT", "expected task-day conflict");
    }
  },
  {
    name: "fresh candidate allows reservation",
    run() {
      const decision = evaluateReservation(makeCandidate(), buildLookupIndex([]));
      assert(decision.decision === "ALLOW_RESERVATION", "expected allow");
    }
  },
  {
    name: "exact duplicate blocks reservation",
    run() {
      const row = makeLogRow({ status: "SENT", sentAt: "2026-07-22T01:10:00.000Z", reservedAt: "" });
      const decision = evaluateReservation(makeCandidate(), buildLookupIndex([row]));
      assert(decision.decision === "BLOCK_RESERVATION", "expected block");
      assert(decision.reason === "DUPLICATE_SENT", "expected duplicate sent");
    }
  },
  {
    name: "invalid candidate fails closed",
    run() {
      const candidate = makeCandidate({ recipientUsername: "Sales01" });
      const decision = evaluateReservation(candidate, buildLookupIndex([]));
      assert(decision.decision === "ERROR", "expected error");
    }
  },
  {
    name: "dedupe mismatch fails closed",
    run() {
      const candidate = makeCandidate();
      candidate.dedupeKey = "a".repeat(64);
      assert(evaluateReservation(candidate, buildLookupIndex([])).errorCode === "RESERVATION_DEDUPE_MISMATCH", "expected mismatch");
    }
  },
  {
    name: "reservation success returns row and dedupe key",
    run() {
      const store = { rows: [] };
      const result = reserveInMemory(makeCandidate(), store, { id: "reserved-1" });
      assert(result.ok === true, "expected ok");
      assert(result.status === "RESERVED", "expected reserved");
      assert(result.created === true, "expected created");
      assert(result.row && result.row.status === "RESERVED", "expected returned row");
      assert(result.dedupeKey === result.row.dedupeKey, "expected dedupe key returned");
      assert(store.rows.length === 1, "expected one appended row");
    }
  },
  {
    name: "invalid source fails before append",
    run() {
      const store = { rows: [] };
      const result = reserveInMemory(makeCandidate({ source: "UNSAFE_SOURCE" }), store);
      assert(result.ok === false, "expected failure");
      assert(result.errorCode === "LOG_ROW_INVALID", "expected invalid row");
      assert(store.rows.length === 0, "expected no append");
    }
  },
  {
    name: "controlled live source is explicit",
    run() {
      const store = { rows: [] };
      const result = reserveInMemory(makeCandidate({ source: "CONTROLLED_LIVE_TEST", noteSafe: "CONTROLLED_LIVE_TEST" }), store);
      assert(result.ok === true && result.created === true, "expected controlled live allowed");
    }
  },
  {
    name: "lock timeout returns no append",
    run() {
      const store = { rows: [] };
      const result = reserveInMemory(makeCandidate(), store, { lockAvailable: false });
      assert(result.errorCode === "LOG_LOCK_TIMEOUT", "expected timeout");
      assert(store.rows.length === 0, "expected no append");
    }
  },
  {
    name: "invalid schema returns no append",
    run() {
      const store = { rows: [makeLogRow({ source: "UNSAFE_SOURCE" })] };
      const result = reserveInMemory(makeCandidate({ taskId: "TASK-002" }), store);
      assert(result.errorCode === "LOG_ROW_INVALID", "expected invalid existing row");
      assert(store.rows.length === 1, "expected no append");
    }
  },
  {
    name: "duplicate exact reservation returns created false",
    run() {
      const store = { rows: [makeLogRow()] };
      const result = reserveInMemory(makeCandidate(), store);
      assert(result.ok === true, "expected safe block");
      assert(result.created === false, "expected no create");
      assert(result.duplicateBlocked === true, "expected duplicate block");
      assert(store.rows.length === 1, "expected no append");
    }
  },
  {
    name: "same task day different bucket blocks write",
    run() {
      const existing = makeLogRow({ bucket: "DUE_TODAY" });
      const store = { rows: [existing] };
      const result = reserveInMemory(makeCandidate({ bucket: "OVERDUE" }), store);
      assert(result.created === false, "expected no create");
      assert(result.reason === "TASK_DAY_RESERVED", "expected task-day block");
      assert(store.rows.length === 1, "expected no append");
    }
  },
  {
    name: "append reread conflict returns update conflict",
    run() {
      const store = { rows: [] };
      const result = reserveInMemory(makeCandidate(), store, { reReadConflict: true });
      assert(result.errorCode === "LOG_UPDATE_CONFLICT", "expected update conflict");
      assert(store.rows.length === 0, "expected no committed append in simulation");
    }
  },
  {
    name: "dry run reservation evaluates without append",
    run() {
      const store = { rows: [] };
      const result = reserveInMemory(makeCandidate(), store, { dryRun: true });
      assert(result.status === "WOULD_RESERVE", "expected would reserve");
      assert(result.created === false, "expected no create");
      assert(store.rows.length === 0, "expected no append");
    }
  },
  {
    name: "controlled orchestration does not wrap reservation in outer lock",
    run() {
      const source = fs.readFileSync(path.join(__dirname, "../../google-apps-script/Code.gs"), "utf8");
      const start = source.indexOf("function triggerControlledTaskDueReminderLiveTest()");
      const end = source.indexOf("/**\n * Stage 20-F", start);
      assert(start >= 0 && end > start, "expected controlled live function block");
      const block = source.slice(start, end);
      const reservationCall = block.indexOf("reserveTaskNotificationLogEntry_(candidate");
      assert(reservationCall >= 0, "expected reservation call");
      const beforeCall = block.slice(Math.max(0, reservationCall - 400), reservationCall);
      assert(!beforeCall.includes("LockService.getScriptLock()"), "expected reservation helper to own lock");
    }
  }
]);
