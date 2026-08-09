/**
 * Identity Resolution Integration Simulation Suite
 *
 * Verifies unified identity resolution contract across LINE Bot, Backend, and App.
 * Ensures:
 * 1. Valid LINE ID hits unique Users row.
 * 2. Duplicate LINE ID is rejected (DUPLICATE_LINE_USER_ID).
 * 3. Unbound internal user returns INTERNAL_USER_UNBOUND (does not fall back to customer visitor fallback).
 * 4. Internal roles typing "今日工作" receive the proper App entrance link (https://brown-phi.vercel.app/).
 * 5. Customer identity can only access customer features.
 * 6. Identity resolution uses a consistent Users data source contract across entrypoints.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { assert, runSuite } = require("./helpers");

function createTestSandbox(usersMock = []) {
  const sandbox = {
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => {
          if (key === "JINGYANG_MANAGER_SPREADSHEET_ID" || key === "SPREADSHEET_ID") {
            return "TEST_SPREADSHEET_ID";
          }
          return "";
        }
      })
    },
    JingyangAssistant_readUsers_: () => usersMock,
    JingyangAssistant_buildAppViewUrl_: (v) => `https://brown-phi.vercel.app/?view=${encodeURIComponent(v)}`,
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
  sandbox.JingyangAssistant_readUsers_ = () => usersMock;
  return sandbox;
}

const mockUsersDataset = [
  {
    id: "user-001",
    username: "cai",
    displayName: "蔡",
    role: "sales",
    salesOwner: "蔡",
    lineUserId: "U_STAFF_SALES_001",
    status: "啟用"
  },
  {
    id: "user-002",
    username: "assistant01",
    displayName: "助理A",
    role: "assistant",
    salesOwner: "助理A",
    lineUserId: "U_STAFF_ASSISTANT_001",
    status: "啟用"
  },
  {
    id: "user-003",
    username: "admin01",
    displayName: "管理員",
    role: "admin",
    salesOwner: "全部",
    lineUserId: "U_STAFF_ADMIN_001",
    status: "啟用"
  },
  {
    id: "user-004",
    username: "cust01",
    displayName: "客戶張先生",
    role: "customer",
    salesOwner: "",
    lineUserId: "U_CUSTOMER_001",
    status: "啟用"
  },
  {
    id: "user-005",
    username: "inactive01",
    displayName: "已離職人員",
    role: "sales",
    salesOwner: "離職",
    lineUserId: "U_INACTIVE_001",
    status: "停用"
  },
  {
    id: "user-006a",
    username: "dup01a",
    displayName: "重複A",
    role: "sales",
    salesOwner: "重複A",
    lineUserId: "U_DUPLICATE_001",
    status: "啟用"
  },
  {
    id: "user-006b",
    username: "dup01b",
    displayName: "重複B",
    role: "sales",
    salesOwner: "重複B",
    lineUserId: "U_DUPLICATE_001",
    status: "啟用"
  }
];

runSuite("identity-integration", [
  {
    name: "Valid LINE ID hits unique Users record with correct staff mode and role",
    run() {
      const sandbox = createTestSandbox(mockUsersDataset);
      const identity = sandbox.resolveUserIdentity("U_STAFF_ASSISTANT_001", mockUsersDataset);

      assert(identity.ok === true, "resolveUserIdentity should succeed for valid bound staff");
      assert(identity.mode === "staff", "mode should be staff");
      assert(identity.role === "assistant", "role should match Users sheet");
      assert(identity.displayName === "助理A", "displayName should match Users sheet");
      assert(identity.errorCode === null, "errorCode should be null");

      const foundUser = sandbox.JingyangAssistant_findUserByLineId_({ users: mockUsersDataset }, "U_STAFF_ASSISTANT_001");
      assert(foundUser !== null, "findUserByLineId_ should return user object");
      assert(foundUser.username === "assistant01", "username should match");
    }
  },
  {
    name: "Duplicate LINE ID is rejected with DUPLICATE_LINE_USER_ID",
    run() {
      const sandbox = createTestSandbox(mockUsersDataset);
      const identity = sandbox.resolveUserIdentity("U_DUPLICATE_001", mockUsersDataset);

      assert(identity.ok === false, "resolveUserIdentity should fail for duplicate LINE ID");
      assert(identity.errorCode === "DUPLICATE_LINE_USER_ID", "errorCode must be DUPLICATE_LINE_USER_ID");
      assert(identity.mode === "error", "mode should be error");

      const foundUser = sandbox.JingyangAssistant_findUserByLineId_({ users: mockUsersDataset }, "U_DUPLICATE_001");
      assert(foundUser === null, "findUserByLineId_ must return null on duplicate LINE ID");

      let repliedText = "";
      sandbox.replyToLine = (token, text) => { repliedText = text; };
      const event = { type: "message", source: { userId: "U_DUPLICATE_001" }, message: { type: "text", text: "今日工作" }, replyToken: "test_token" };
      sandbox.LineIntent_tryHandleTextEvent(event);

      assert(repliedText.includes("DUPLICATE_LINE_USER_ID"), "Response must mention DUPLICATE_LINE_USER_ID error");
      assert(repliedText.includes("重複"), "Response must mention duplicate notice");
    }
  },
  {
    name: "Unbound internal user returns INTERNAL_USER_UNBOUND and warning without customer fallback",
    run() {
      const sandbox = createTestSandbox(mockUsersDataset);
      const identity = sandbox.resolveUserIdentity("U_UNBOUND_9999", mockUsersDataset);

      assert(identity.ok === false, "resolveUserIdentity should fail for unbound LINE ID");
      assert(identity.errorCode === "INTERNAL_USER_UNBOUND", "errorCode must be INTERNAL_USER_UNBOUND");
      assert(identity.mode === "unbound", "mode should be unbound");

      let repliedText = "";
      sandbox.replyToLine = (token, text) => { repliedText = text; };
      const event = { type: "message", source: { userId: "U_UNBOUND_9999" }, message: { type: "text", text: "今日工作" }, replyToken: "test_token" };
      sandbox.LineIntent_tryHandleTextEvent(event);

      assert(repliedText.includes("INTERNAL_USER_UNBOUND"), "Response must mention INTERNAL_USER_UNBOUND error");
      assert(repliedText.includes("尚未綁定內部人員身分"), "Response must warn user about missing binding");
      assert(!repliedText.includes("感謝您的訊息"), "Response must NOT return generic visitor customer fallback");
    }
  },
  {
    name: "Internal role typing '今日工作' receives valid App entrance URL",
    run() {
      const sandbox = createTestSandbox(mockUsersDataset);
      const rolesToTest = ["U_STAFF_SALES_001", "U_STAFF_ASSISTANT_001", "U_STAFF_ADMIN_001"];

      rolesToTest.forEach((lineId) => {
        let repliedText = "";
        sandbox.replyToLine = (token, text) => { repliedText = text; };
        const event = { type: "message", source: { userId: lineId }, message: { type: "text", text: "今日工作" }, replyToken: "test_token" };
        sandbox.LineIntent_tryHandleTextEvent(event);

        assert(repliedText.includes("https://brown-phi.vercel.app/"), "Must include official Vercel App entrypoint URL");
        assert(repliedText.includes("工作中心與今日摘要已準備好"), "Must confirm work center readiness");
      });
    }
  },
  {
    name: "Customer identity cannot access internal staff features or App work center link",
    run() {
      const sandbox = createTestSandbox(mockUsersDataset);
      const identity = sandbox.resolveUserIdentity("U_CUSTOMER_001", mockUsersDataset);

      assert(identity.ok === true, "Customer identity resolution should succeed");
      assert(identity.mode === "customer", "mode should be customer");
      assert(identity.role === "customer", "role should be customer");

      let repliedText = "";
      sandbox.replyToLine = (token, text) => { repliedText = text; };
      const event = { type: "message", source: { userId: "U_CUSTOMER_001" }, message: { type: "text", text: "今日工作" }, replyToken: "test_token" };
      sandbox.LineIntent_tryHandleTextEvent(event);

      assert(!repliedText.includes("工作中心與今日摘要已準備好"), "Customer MUST NOT access staff work center link");
      assert(!repliedText.includes("https://brown-phi.vercel.app/?view=tasks"), "Customer MUST NOT receive staff tasks link");
    }
  },
  {
    name: "Identity resolution uses consistent Users dataset contract across entrypoints",
    run() {
      const sandbox = createTestSandbox(mockUsersDataset);
      const user = sandbox.JingyangAssistant_findUserByLineId_({ users: mockUsersDataset }, "U_STAFF_SALES_001");
      const ctx = sandbox.getLineUserContext("U_STAFF_SALES_001", mockUsersDataset);

      assert(user.username === ctx.username, "username must be identical across helpers");
      assert(user.role === ctx.role, "role must be identical across helpers");
      assert(user.displayName === ctx.displayName, "displayName must be identical across helpers");
    }
  },
  {
    name: "Whitespace-padded inactive status variants fail closed",
    run() {
      const statusVariants = [" disabled ", " inactive ", " DISABLED ", " 停用 "];
      statusVariants.forEach((statusVal, idx) => {
        const lineId = `U_INACTIVE_VAR_${idx}`;
        const user = {
          id: `USR-INACTIVE-${idx}`,
          lineUserId: lineId,
          username: `inactive-${idx}`,
          displayName: `停用測試${idx}`,
          role: "sales",
          status: statusVal
        };
        const sandbox = createTestSandbox([user]);
        const result = sandbox.resolveUserIdentity(lineId, [user]);
        assert(result.ok === false, `whitespace status '${statusVal}' must fail closed`);
        assert(result.errorCode === "ACCOUNT_INACTIVE", "expected ACCOUNT_INACTIVE");
        assert(result.mode === "inactive", "expected inactive mode");
      });
    }
  },
  {
    name: "Staff role with surrounding whitespace resolves cleanly",
    run() {
      const user = {
        id: "USR-ROLE-TRIM",
        lineUserId: "U_STAFF_TRIM_ROLE",
        username: "staff-trim",
        displayName: "助理選單測試",
        role: " assistant ",
        status: "啟用"
      };
      const sandbox = createTestSandbox([user]);
      const result = sandbox.resolveUserIdentity("U_STAFF_TRIM_ROLE", [user]);
      assert(result.ok === true, "role with whitespace should resolve successfully");
      assert(result.mode === "staff", "mode should be staff");
      assert(result.role === "assistant", "role should be trimmed");
    }
  },
  {
    name: "Entrypoint-level inactive user receives ACCOUNT_INACTIVE warning without staff work center link",
    run() {
      const user = {
        id: "USR-INACTIVE-ENTRY",
        lineUserId: "U_INACTIVE_ENTRY_001",
        username: "inactive-entry",
        displayName: "離職同仁",
        role: "sales",
        status: " disabled "
      };
      const sandbox = createTestSandbox([user]);
      let repliedText = "";
      sandbox.replyToLine = (token, text) => { repliedText = text; };
      const event = {
        type: "message",
        source: { userId: "U_INACTIVE_ENTRY_001" },
        message: { type: "text", text: "今日工作" },
        replyToken: "test_token"
      };
      sandbox.LineIntent_tryHandleTextEvent(event);

      assert(repliedText.includes("ACCOUNT_INACTIVE"), "Entrypoint reply must mention ACCOUNT_INACTIVE");
      assert(repliedText.includes("停用狀態"), "Entrypoint reply must mention inactive status");
      assert(!repliedText.includes("工作中心與今日摘要已準備好"), "Inactive user MUST NOT receive staff work center link");
    }
  }
]);
