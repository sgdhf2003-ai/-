"use strict";

const {
  LOG_HEADERS,
  assert,
  buildDedupeKey,
  buildLookupIndex,
  evaluateReservation,
  makeCandidate,
  makeLogRow,
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
  }
]);
