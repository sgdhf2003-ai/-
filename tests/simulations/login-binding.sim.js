"use strict";

const { assert, isValidLineUserId, lineUserId, normalizeUsername, runSuite } = require("./helpers");

function resolveRecipient(lineId, users) {
  if (!isValidLineUserId(lineId)) return { ok: false, errorCode: "RECIPIENT_ID_INVALID" };
  const matches = users.filter((u) => String(u.lineUserId || "").trim() === lineId);
  if (matches.length === 0) return { ok: false, errorCode: "RECIPIENT_BINDING_NOT_FOUND" };
  if (matches.length > 1) return { ok: false, errorCode: "RECIPIENT_BINDING_DUPLICATE" };
  const user = matches[0];
  if (user.status !== "active") return { ok: false, errorCode: "RECIPIENT_ACCOUNT_INACTIVE" };
  const username = normalizeUsername(user.username);
  if (!username || !/^[a-z0-9_.-]{1,64}$/.test(username) || user.username !== username) return { ok: false, errorCode: "RECIPIENT_USERNAME_INVALID" };
  return { ok: true, recipientUsername: username, recipientLineId: lineId };
}

runSuite("login-binding", [
  {
    name: "active unique binding resolves",
    run() {
      const id = lineUserId();
      const res = resolveRecipient(id, [{ username: "sales01", status: "active", lineUserId: id }]);
      assert(res.ok === true && res.recipientUsername === "sales01", "expected resolve");
    }
  },
  {
    name: "invalid line id fails closed",
    run() {
      assert(resolveRecipient("bad", []).errorCode === "RECIPIENT_ID_INVALID", "expected invalid");
    }
  },
  {
    name: "missing binding fails closed",
    run() {
      assert(resolveRecipient(lineUserId(), []).errorCode === "RECIPIENT_BINDING_NOT_FOUND", "expected missing");
    }
  },
  {
    name: "duplicate binding fails closed",
    run() {
      const id = lineUserId();
      assert(resolveRecipient(id, [
        { username: "sales01", status: "active", lineUserId: id },
        { username: "sales02", status: "active", lineUserId: id }
      ]).errorCode === "RECIPIENT_BINDING_DUPLICATE", "expected duplicate");
    }
  },
  {
    name: "inactive binding fails closed",
    run() {
      const id = lineUserId();
      assert(resolveRecipient(id, [{ username: "sales01", status: "inactive", lineUserId: id }]).errorCode === "RECIPIENT_ACCOUNT_INACTIVE", "expected inactive");
    }
  },
  {
    name: "noncanonical username fails closed",
    run() {
      const id = lineUserId();
      assert(resolveRecipient(id, [{ username: "Sales01", status: "active", lineUserId: id }]).errorCode === "RECIPIENT_USERNAME_INVALID", "expected username invalid");
    }
  }
]);
