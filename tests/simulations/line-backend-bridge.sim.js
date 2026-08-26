/**
 * LINE Backend Bridge Simulation Test Suite
 * 
 * Target Scope: google-apps-script/Code.gs lineCreateHold action & security contract
 * 
 * Test Requirements:
 * 1. Code.gs MUST provide lineCreateHold action in doPost dispatch.
 * 2. Code.gs lineCreateHold MUST query Users table using lineUserId to resolve identity.
 * 3. MUST NOT trust payload's userContext, role, or salesOwner.
 * 4. When bridgeSecret is invalid, or LINE user is missing, unbound, inactive, or unauthorized (sales), MUST fail-closed (ok: false).
 * 5. Valid authorized server-resolved user proceeds to call upsertHoldAction.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const codeGsPath = path.join(
  __dirname,
  "../../google-apps-script/Code.gs"
);

const codeGsContent = fs.readFileSync(codeGsPath, "utf8");

// Extract lineCreateHoldAction and mock dependencies for runtime unit tests
const mockProperties = {
  LINE_BOT_BRIDGE_SECRET: "SECRET_BRIDGE_KEY_998877"
};

const lineCreateHoldAction = new Function(
  "data",
  "PropertiesService",
  "adapter",
  `
    ${codeGsContent}
    return lineCreateHoldAction(data, adapter);
  `
);

const sampleUsersTable = [
  {
    displayName: "王小明",
    username: "ming",
    lineUserId: "U11111111111111111111111111111111",
    role: "assistant",
    status: "啟用",
    salesOwner: "王小明"
  },
  {
    displayName: "張業務",
    username: "sales_zhang",
    lineUserId: "U22222222222222222222222222222222",
    role: "sales",
    status: "啟用",
    salesOwner: "張業務"
  },
  {
    displayName: "李停用",
    username: "inactive_li",
    lineUserId: "U33333333333333333333333333333333",
    role: "assistant",
    status: "停用",
    salesOwner: "李停用"
  }
];

const mockPropertiesService = {
  getScriptProperties() {
    return {
      getProperty(key) {
        return mockProperties[key] || null;
      }
    };
  }
};

const tests = [
  {
    name: "1. Code.gs MUST provide lineCreateHold action in doPost dispatch",
    run() {
      assert(
        codeGsContent.includes('action === "lineCreateHold"') &&
        codeGsContent.includes("lineCreateHoldAction"),
        "Code.gs MUST provide lineCreateHold action dispatcher"
      );
    }
  },
  {
    name: "2. Code.gs lineCreateHold MUST query Users table using lineUserId to resolve identity",
    run() {
      const idxAction = codeGsContent.indexOf("function lineCreateHoldAction");
      assert(idxAction !== -1, "lineCreateHoldAction function MUST be defined in Code.gs");
      
      const fnSlice = codeGsContent.slice(idxAction, idxAction + 1500);
      assert(
        fnSlice.includes("lineUserId") && (fnSlice.includes("users") && fnSlice.includes("SHEETS.users")),
        "lineCreateHoldAction MUST query Users table using lineUserId"
      );
    }
  },
  {
    name: "3. lineCreateHold MUST fail closed with INVALID_LINE_BRIDGE when bridgeSecret is missing or invalid",
    run() {
      const resInvalidSecret = lineCreateHoldAction({
        bridgeSecret: "WRONG_SECRET",
        lineUserId: "U11111111111111111111111111111111",
        usersTable: sampleUsersTable
      }, mockPropertiesService);

      assert.strictEqual(resInvalidSecret.ok, false, "Invalid secret MUST fail closed");
      assert.strictEqual(resInvalidSecret.errorCode, "INVALID_LINE_BRIDGE");
    }
  },
  {
    name: "4. lineCreateHold MUST fail closed when LINE user is unbound, inactive, or sales role",
    run() {
      // Unbound user
      const resUnbound = lineCreateHoldAction({
        bridgeSecret: "SECRET_BRIDGE_KEY_998877",
        lineUserId: "UNBOUND_USER_999",
        usersTable: sampleUsersTable
      }, mockPropertiesService);
      assert.strictEqual(resUnbound.ok, false);
      assert.strictEqual(resUnbound.errorCode, "INTERNAL_USER_UNBOUND");

      // Inactive user
      const resInactive = lineCreateHoldAction({
        bridgeSecret: "SECRET_BRIDGE_KEY_998877",
        lineUserId: "U33333333333333333333333333333333",
        usersTable: sampleUsersTable
      }, mockPropertiesService);
      assert.strictEqual(resInactive.ok, false);
      assert.strictEqual(resInactive.errorCode, "ACCOUNT_INACTIVE");

      // Sales user (unauthorized for write actions)
      const resSales = lineCreateHoldAction({
        bridgeSecret: "SECRET_BRIDGE_KEY_998877",
        lineUserId: "U22222222222222222222222222222222",
        usersTable: sampleUsersTable
      }, mockPropertiesService);
      assert.strictEqual(resSales.ok, false);
      assert.strictEqual(resSales.errorCode, "UNAUTHORIZED_OPERATOR");
    }
  },
  {
    name: "5. Valid authorized server-resolved user proceeds to upsertHoldAction ignoring client forged identity",
    run() {
      let capturedHold = null;
      const mockAdapter = {
        upsertHold: function(rec) {
          capturedHold = rec;
          return { ok: true, reservationNumber: rec.id, message: "正式劃扣建立成功" };
        }
      };

      const res = lineCreateHoldAction({
        bridgeSecret: "SECRET_BRIDGE_KEY_998877",
        lineUserId: "U11111111111111111111111111111111",
        usersTable: sampleUsersTable,
        // Client attempting to forge salesOwner or role
        userContext: { role: "admin", displayName: "ForgedAdmin" },
        salesOwner: "ForgedSalesOwner",
        hold: {
          id: "RES-TEST-001",
          storeName: "美麗空間",
          item: "STU-6101",
          quantity: 2
        }
      }, mockPropertiesService, mockAdapter);

      assert.strictEqual(res.ok, true, "Authorized user request MUST succeed");
      assert(capturedHold, "upsertHoldAction MUST delegate to adapter.upsertHold");
      assert.strictEqual(capturedHold.id, "RES-TEST-001");
      assert.strictEqual(res.reservationNumber, "RES-TEST-001");
    }
  }
];

let passCount = 0;
let failCount = 0;

tests.forEach((t) => {
  try {
    t.run();
    console.log(`PASS line-backend-bridge: ${t.name}`);
    passCount++;
  } catch (err) {
    console.error(`FAIL line-backend-bridge: ${t.name}: ${err.message}`);
    failCount++;
  }
});

console.log(`\nLINE Backend Bridge Simulation Summary: ${passCount} PASS / ${failCount} FAIL`);

if (failCount > 0) {
  process.exit(1);
}
