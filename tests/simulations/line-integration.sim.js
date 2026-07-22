"use strict";

const { assert, hmacSha256Hex, isValidLineUserId, lineUserId, runSuite } = require("./helpers");

function signTaskReminderPayload(payload, secret) {
  const canonical = [
    payload.internalRequest,
    payload.action,
    payload.requestId,
    payload.timestamp,
    payload.recipientUsername,
    payload.recipientLineId,
    payload.taskIdSafe,
    payload.taskTitleSafe,
    payload.dueDateKey,
    payload.bucket,
    payload.reservationIdShort,
    String(payload.dryRun)
  ].join("|");
  return hmacSha256Hex(canonical, secret);
}

function buildTaskReminderPayload(overrides = {}) {
  const payload = Object.assign({
    internalRequest: "jy-line-push-v2",
    action: "TASK_DUE_REMINDER",
    recipientUsername: "sales01",
    recipientLineId: lineUserId(),
    taskIdSafe: "TASK-001",
    taskTitleSafe: "Follow up order",
    dueDateKey: "2026-07-22",
    bucket: "DUE_TODAY",
    reservationIdShort: "abcdef123456",
    dryRun: true,
    requestId: "req-task-0001",
    timestamp: "1784685600000"
  }, overrides);
  payload.signature = signTaskReminderPayload(payload, "shared");
  return payload;
}

function validateTaskReminderPayload(payload, secret) {
  if (!payload || payload.internalRequest !== "jy-line-push-v2") return { ok: false, errorCode: "INVALID_MARKER", lineCalled: false };
  if (payload.action !== "TASK_DUE_REMINDER") return { ok: false, errorCode: "INVALID_ACTION", lineCalled: false };
  if (!/^[a-z0-9_.-]{1,64}$/.test(payload.recipientUsername)) return { ok: false, errorCode: "INVALID_PAYLOAD", lineCalled: false };
  if (!isValidLineUserId(payload.recipientLineId)) return { ok: false, errorCode: "INVALID_PAYLOAD", lineCalled: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.dueDateKey)) return { ok: false, errorCode: "INVALID_PAYLOAD", lineCalled: false };
  if (!["DUE_TODAY", "OVERDUE"].includes(payload.bucket)) return { ok: false, errorCode: "INVALID_PAYLOAD", lineCalled: false };
  if (payload.signature !== signTaskReminderPayload(payload, secret)) return { ok: false, errorCode: "INVALID_SIGNATURE", lineCalled: false };
  return {
    ok: true,
    mode: "task-reminder-dry-run",
    action: "TASK_DUE_REMINDER",
    payloadValid: true,
    recipientCount: 1,
    messageType: "text",
    templateId: "TASK_DUE_REMINDER_V1",
    lineCalled: payload.dryRun !== true
  };
}

runSuite("line-integration", [
  {
    name: "valid dry-run payload does not call LINE",
    run() {
      const res = validateTaskReminderPayload(buildTaskReminderPayload(), "shared");
      assert(res.ok === true, "expected ok");
      assert(res.lineCalled === false, "dry run must not call line");
    }
  },
  {
    name: "wrong marker fails closed",
    run() {
      assert(validateTaskReminderPayload(buildTaskReminderPayload({ internalRequest: "bad" }), "shared").errorCode === "INVALID_MARKER", "expected invalid marker");
    }
  },
  {
    name: "wrong action fails closed",
    run() {
      assert(validateTaskReminderPayload(buildTaskReminderPayload({ action: "sendPushReminder" }), "shared").errorCode === "INVALID_ACTION", "expected invalid action");
    }
  },
  {
    name: "invalid signature fails closed",
    run() {
      const payload = buildTaskReminderPayload();
      payload.signature = "bad";
      assert(validateTaskReminderPayload(payload, "shared").errorCode === "INVALID_SIGNATURE", "expected bad signature");
    }
  },
  {
    name: "invalid bucket fails closed",
    run() {
      const payload = buildTaskReminderPayload({ bucket: "NEXT_7" });
      assert(validateTaskReminderPayload(payload, "shared").errorCode === "INVALID_PAYLOAD", "expected invalid payload");
    }
  }
]);
