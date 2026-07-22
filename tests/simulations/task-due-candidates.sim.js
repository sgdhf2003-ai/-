"use strict";

const { assert, buildDedupeKey, isDateKey, lineUserId, runSuite } = require("./helpers");

function isFinishedOrCancelled(task) {
  return ["finished", "completed", "cancelled", "canceled"].includes(String(task.status || "").trim().toLowerCase());
}

function classifyTask(task, today) {
  if (!task || !task.id || !task.dueDate || !isDateKey(task.dueDate)) return null;
  if (isFinishedOrCancelled(task)) return null;
  if (task.dueDate < today) return "OVERDUE";
  if (task.dueDate === today) return "DUE_TODAY";
  return null;
}

function buildCandidate(task, user, today) {
  const bucket = classifyTask(task, today);
  if (!bucket) return null;
  if (!user || user.status !== "active" || !user.username || !/^U[a-fA-F0-9]{32}$/.test(String(user.lineId || ""))) return null;
  const username = user.username.trim().toLowerCase();
  if (user.username !== username) return null;
  const bucketDate = today;
  return {
    taskId: task.id,
    bucket,
    bucketDate,
    dueDateKey: task.dueDate,
    recipientUsername: username,
    dedupeKey: buildDedupeKey(task.id, bucketDate, bucket, username)
  };
}

runSuite("task-due-candidates", [
  {
    name: "today active task creates DUE_TODAY candidate",
    run() {
      const c = buildCandidate({ id: "T1", status: "Created", dueDate: "2026-07-22" }, { username: "sales01", status: "active", lineId: lineUserId() }, "2026-07-22");
      assert(c && c.bucket === "DUE_TODAY", "expected due today");
    }
  },
  {
    name: "overdue active task creates OVERDUE candidate",
    run() {
      const c = buildCandidate({ id: "T2", status: "Waiting", dueDate: "2026-07-21" }, { username: "sales01", status: "active", lineId: lineUserId() }, "2026-07-22");
      assert(c && c.bucket === "OVERDUE", "expected overdue");
    }
  },
  {
    name: "future task is skipped",
    run() {
      assert(buildCandidate({ id: "T3", status: "Created", dueDate: "2026-07-23" }, { username: "sales01", status: "active", lineId: lineUserId() }, "2026-07-22") === null, "expected skip");
    }
  },
  {
    name: "finished task is skipped",
    run() {
      assert(buildCandidate({ id: "T4", status: "Finished", dueDate: "2026-07-22" }, { username: "sales01", status: "active", lineId: lineUserId() }, "2026-07-22") === null, "expected skip");
    }
  },
  {
    name: "cancelled task is skipped",
    run() {
      assert(buildCandidate({ id: "T5", status: "Cancelled", dueDate: "2026-07-21" }, { username: "sales01", status: "active", lineId: lineUserId() }, "2026-07-22") === null, "expected skip");
    }
  },
  {
    name: "invalid due date is skipped",
    run() {
      assert(buildCandidate({ id: "T6", status: "Created", dueDate: "07/22" }, { username: "sales01", status: "active", lineId: lineUserId() }, "2026-07-22") === null, "expected skip");
    }
  },
  {
    name: "inactive recipient fails closed",
    run() {
      assert(buildCandidate({ id: "T7", status: "Created", dueDate: "2026-07-22" }, { username: "sales01", status: "inactive", lineId: lineUserId() }, "2026-07-22") === null, "expected fail closed");
    }
  },
  {
    name: "missing line binding fails closed",
    run() {
      assert(buildCandidate({ id: "T8", status: "Created", dueDate: "2026-07-22" }, { username: "sales01", status: "active", lineId: "" }, "2026-07-22") === null, "expected fail closed");
    }
  }
]);
