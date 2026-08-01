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

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function createRouterSandbox(userMock = null) {
  const sandbox = {
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => ""
      })
    },
    JingyangAssistant_readUsers_: () => (userMock ? [userMock] : []),
    JingyangAssistant_buildAppViewUrl_: (v) => `https://app.test/${v}`,
    replyToLine: () => {}
  };
  const assistantCode = fs.readFileSync(
    path.join(__dirname, "../../line-bot-apps-script/src/JingyangAssistant.gs"),
    "utf8"
  );
  const routerCode = fs.readFileSync(
    path.join(__dirname, "../../line-bot-apps-script/src/core/line_intent_router.gs"),
    "utf8"
  );
  vm.createContext(sandbox);
  vm.runInContext(assistantCode, sandbox);
  vm.runInContext(routerCode, sandbox);
  sandbox.JingyangAssistant_readUsers_ = () => (userMock ? [userMock] : []);
  return sandbox;
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
  },
  {
    name: "detectLineIntent correctly detects whoami, id, and 我的ID as intent whoami",
    run() {
      const sandbox = createRouterSandbox();
      const userContext = sandbox.getLineUserContext("U1234567890abcdef1234567890abcdef");
      assert(sandbox.detectLineIntent("whoami", userContext).intent === "whoami", "whoami should detect as intent whoami");
      assert(sandbox.detectLineIntent("id", userContext).intent === "whoami", "id should detect as intent whoami");
      assert(sandbox.detectLineIntent("我的ID", userContext).intent === "whoami", "我的ID should detect as intent whoami");
      assert(sandbox.detectLineIntent("我的id", userContext).intent === "whoami", "我的id should detect as intent whoami");
    }
  },
  {
    name: "routeLineIntent formats whoami response containing lineUserId, role, and mode",
    run() {
      const staffUser = {
        id: "USR-001",
        lineUserId: "U1234567890abcdef1234567890abcdef",
        username: "admin",
        displayName: "管理員",
        role: "admin",
        status: "啟用"
      };
      const sandbox = createRouterSandbox(staffUser);
      const userContext = sandbox.getLineUserContext("U1234567890abcdef1234567890abcdef");
      assert(userContext.mode === "staff", "expected staff mode");
      assert(userContext.role === "admin", "expected admin role");

      let repliedText = "";
      const handlers = sandbox.LineIntent_defaultHandlers_();
      handlers.whoami = (ctx) => sandbox.replyWhoamiInfo(ctx);

      const intentRes = sandbox.detectLineIntent("whoami", userContext);
      assert(intentRes.intent === "whoami", "expected whoami intent");

      const responseText = sandbox.replyWhoamiInfo(userContext);
      assert(responseText.includes("U1234567890abcdef1234567890abcdef"), "response must include lineUserId");
      assert(responseText.includes("staff"), "response must include staff mode");
      assert(responseText.includes("admin"), "response must include admin role");
    }
  },
  {
    name: "internal staff user routes to staff menu whereas customer receives customer fallback for staff commands",
    run() {
      const staffUser = {
        id: "USR-002",
        lineUserId: "U_STAFF_001",
        username: "assistant1",
        displayName: "張助理",
        role: "assistant",
        status: "啟用"
      };
      const sandbox = createRouterSandbox(staffUser);
      const staffContext = sandbox.getLineUserContext("U_STAFF_001");
      assert(staffContext.mode === "staff", "expected staff mode");

      const staffIntent = sandbox.detectLineIntent("選單", staffContext);
      assert(staffIntent.intent === "staff_menu", "staff should detect staff_menu");

      const customerContext = sandbox.getLineUserContext("U_UNKNOWN_CUSTOMER");
      assert(customerContext.mode === "customer", "expected customer mode");

      const customerIntent = sandbox.detectLineIntent("選單", customerContext);
      assert(customerIntent.intent !== "staff_menu", "customer should NOT route to staff_menu");
    }
  },
  {
    name: "getLineUserContext and isStaffUser resolve staff roles across header variants (Line User ID, line_user_id, LineUserId, Role, Status)",
    run() {
      const variants = [
        { "Line User ID": "U17700bab6816e65347549fa50965c892", Role: "admin", Status: "啟用", ID: "USR-A1", Username: "admin1" },
        { "LINE User ID": "U17700bab6816e65347549fa50965c892", ROLE: "assistant", STATUS: "enabled", Id: "USR-A2", Username: "assistant2" },
        { "line_user_id": "U17700bab6816e65347549fa50965c892", Role: "sales", Status: "active", id: "USR-A3", username: "sales3" },
        { "LineUserId": "U17700bab6816e65347549fa50965c892", role: "retail", status: "啟用", id: "USR-A4", username: "retail4" }
      ];

      variants.forEach((varUser, idx) => {
        const sandbox = createRouterSandbox(varUser);
        const ctx = sandbox.getLineUserContext("U17700bab6816e65347549fa50965c892");
        assert(ctx.mode === "staff", `variant ${idx} expected staff mode`);
        assert(ctx.lineUserId === "U17700bab6816e65347549fa50965c892", `variant ${idx} expected matching lineUserId`);
        assert(ctx.role !== "customer", `variant ${idx} expected staff role, got ${ctx.role}`);

        const foundUser = sandbox.JingyangAssistant_findUserByLineId_({ users: [varUser] }, "U17700bab6816e65347549fa50965c892");
        assert(foundUser !== null, `variant ${idx} expected JingyangAssistant_findUserByLineId_ to match`);
      });
    }
  }
]);
