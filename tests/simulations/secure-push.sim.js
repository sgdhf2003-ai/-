"use strict";

const { assert, hmacSha256Hex, isValidLineUserId, lineUserId, runSuite } = require("./helpers");

function buildPushDryRun(options = {}) {
  const recipient = String(options.recipient || "");
  if (!isValidLineUserId(recipient)) return { ok: false, status: "INVALID_RECIPIENT_FORMAT", lineCalled: false };
  const message = "fixed test message";
  const requestId = options.requestId || "req-20260722-000001";
  const timestamp = String(options.timestamp || 1784685600000);
  const secret = options.secret || "dry-run-secret";
  const canonical = ["jy-line-push-v1", "sendPushReminder", requestId, timestamp, recipient, message].join("|");
  return {
    ok: true,
    status: "DRY_RUN",
    mode: "dry-run",
    lineCalled: false,
    payload: {
      internalRequest: "jy-line-push-v1",
      action: "sendPushReminder",
      requestId,
      timestamp,
      recipient,
      message,
      signature: hmacSha256Hex(canonical, secret)
    }
  };
}

function verifyInternalPush(payload, secret, now, seen) {
  if (!payload || payload.internalRequest !== "jy-line-push-v1" || payload.action !== "sendPushReminder") return { ok: false, status: "INVALID_MARKER", lineCalled: false };
  if (!isValidLineUserId(payload.recipient)) return { ok: false, status: "INVALID_RECIPIENT", lineCalled: false };
  const timestamp = Number(payload.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300000) return { ok: false, status: "EXPIRED_REQUEST", lineCalled: false };
  if (seen.has(payload.requestId)) return { ok: false, status: "REPLAYED_REQUEST", lineCalled: false };
  const canonical = ["jy-line-push-v1", "sendPushReminder", payload.requestId, payload.timestamp, payload.recipient, payload.message].join("|");
  if (payload.signature !== hmacSha256Hex(canonical, secret)) return { ok: false, status: "INVALID_SIGNATURE", lineCalled: false };
  seen.add(payload.requestId);
  return { ok: true, status: "DRY_RUN_ACCEPTED", lineCalled: false };
}

runSuite("secure-push", [
  {
    name: "dry run builds signed payload without LINE call",
    run() {
      const res = buildPushDryRun({ recipient: lineUserId() });
      assert(res.ok === true, "expected ok");
      assert(res.lineCalled === false, "must not call line");
    }
  },
  {
    name: "invalid recipient fails closed",
    run() {
      assert(buildPushDryRun({ recipient: "bad" }).status === "INVALID_RECIPIENT_FORMAT", "expected invalid");
    }
  },
  {
    name: "internal route accepts valid signature",
    run() {
      const secret = "shared";
      const payload = buildPushDryRun({ recipient: lineUserId(), secret }).payload;
      assert(verifyInternalPush(payload, secret, Number(payload.timestamp), new Set()).ok === true, "expected accept");
    }
  },
  {
    name: "internal route rejects invalid signature",
    run() {
      const secret = "shared";
      const payload = buildPushDryRun({ recipient: lineUserId(), secret }).payload;
      payload.signature = "0".repeat(64);
      assert(verifyInternalPush(payload, secret, Number(payload.timestamp), new Set()).status === "INVALID_SIGNATURE", "expected reject");
    }
  },
  {
    name: "internal route rejects expired timestamp",
    run() {
      const payload = buildPushDryRun({ recipient: lineUserId() }).payload;
      assert(verifyInternalPush(payload, "dry-run-secret", Number(payload.timestamp) + 400000, new Set()).status === "EXPIRED_REQUEST", "expected expired");
    }
  },
  {
    name: "internal route rejects replay",
    run() {
      const payload = buildPushDryRun({ recipient: lineUserId() }).payload;
      const seen = new Set();
      assert(verifyInternalPush(payload, "dry-run-secret", Number(payload.timestamp), seen).ok === true, "expected first ok");
      assert(verifyInternalPush(payload, "dry-run-secret", Number(payload.timestamp), seen).status === "REPLAYED_REQUEST", "expected replay");
    }
  }
]);
