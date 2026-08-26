/**
 * LINE Bot Production Project Workflow Routing Simulation Test Suite
 * 
 * Target Scope: linebot-production-apps-script/
 * 
 * Test Requirements:
 * 1. line程式碼.js MUST call JingyangWorkflow_tryHandlePostback before handleAssistantPostback_.
 * 2. line程式碼.js MUST call JingyangWorkflow_tryHandleTextEvent before LineIntent_tryHandleTextEvent.
 * 3. Core workflow modules MUST exist in linebot-production-apps-script/core/.
 * 4. Legacy replyToLine, product search, and customer reply text MUST NOT be deleted or modified.
 * 5. confirmHoldDraft payload passed to callback MUST contain lineUserId equal to postback event userId.
 * 6. JingyangWorkflow_lineCreateHoldBridge_ function implementation exists.
 * 7. Bridge MUST call JingyangAssistant_getApiUrl_().
 * 8. Bridge request body MUST contain action="lineCreateHold", bridgeSecret, lineUserId, and hold.
 * 9. Bridge request body MUST NOT contain userContext, sessionToken, or role.
 * 10. Bridge MUST fail closed (ok: false, BRIDGE_SECRET_MISSING) when LINE_BOT_BRIDGE_SECRET is missing.
 * 11. Model code normalization matching for STU-6101 vs STU6101 in Hash Map inventory catalog.
 * 12. confirmHoldDraft missing draft diagnostic MUST mask LINE user IDs to last 4 digits and NEVER expose full user ID.
 * 13. confirmHoldDraft draftId mismatch diagnostic MUST mask draftId to last 4 digits and NEVER expose full draftId.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const prodDir = path.join(
  __dirname,
  "../../linebot-production-apps-script"
);

const lineMainPath = path.join(prodDir, "line程式碼.js");
const assistantPath = path.join(prodDir, "JingyangAssistant.js");
const parserJsPath = path.join(prodDir, "core/reservation_parser.js");
const handlerJsPath = path.join(prodDir, "core/reservation_workflow_handler.js");

const lineMainContent = fs.readFileSync(lineMainPath, "utf8");
const assistantContent = fs.readFileSync(assistantPath, "utf8");
const parserJsContent = fs.readFileSync(parserJsPath, "utf8");
const handlerJsContent = fs.readFileSync(handlerJsPath, "utf8");

const parseReservationText = new Function(
  "text",
  "inventoryCatalog",
  `
    ${parserJsContent}
    return parseReservationText(text, inventoryCatalog);
  `
);

const handleLineReservationPostback = new Function(
  "options",
  `
    ${parserJsContent}
    ${handlerJsContent}
    return handleLineReservationPostback(options);
  `
);

const tests = [
  {
    name: "1. line程式碼.gs doPost MUST call JingyangWorkflow_tryHandlePostback before handleAssistantPostback_",
    run() {
      const idxPostback = lineMainContent.indexOf("function doPost");
      assert(idxPostback !== -1, "line程式碼.js MUST contain doPost");

      const fnBody = lineMainContent.slice(idxPostback, idxPostback + 10000);
      const idxWorkflowPb = fnBody.indexOf("JingyangWorkflow_tryHandlePostback");
      const idxAssistantPb = fnBody.indexOf("handleAssistantPostback_");

      assert(idxWorkflowPb !== -1, "line程式碼.js MUST wire JingyangWorkflow_tryHandlePostback");
      assert(idxAssistantPb !== -1, "line程式碼.js MUST preserve handleAssistantPostback_");
      assert(
        idxWorkflowPb < idxAssistantPb,
        "JingyangWorkflow_tryHandlePostback MUST be called before handleAssistantPostback_"
      );
    }
  },
  {
    name: "2. line程式碼.gs doPost MUST call JingyangWorkflow_tryHandleTextEvent before LineIntent_tryHandleTextEvent",
    run() {
      const idxPost = lineMainContent.indexOf("function doPost");
      assert(idxPost !== -1, "line程式碼.js MUST contain doPost");

      const fnBody = lineMainContent.slice(idxPost, idxPost + 10000);
      const idxWorkflowText = fnBody.indexOf("JingyangWorkflow_tryHandleTextEvent");
      const idxIntentText = fnBody.indexOf("LineIntent_tryHandleTextEvent");

      assert(idxWorkflowText !== -1, "line程式碼.js MUST wire JingyangWorkflow_tryHandleTextEvent");
      assert(idxIntentText !== -1, "line程式碼.js MUST preserve LineIntent_tryHandleTextEvent");
      assert(
        idxWorkflowText < idxIntentText,
        "JingyangWorkflow_tryHandleTextEvent MUST be called before LineIntent_tryHandleTextEvent"
      );
    }
  },
  {
    name: "3. Core reservation modules MUST exist in linebot-production-apps-script/core/",
    run() {
      const parserGsPath = path.join(prodDir, "core/reservation_parser.gs");
      const handlerGsPath = path.join(prodDir, "core/reservation_workflow_handler.gs");

      const hasParser = fs.existsSync(parserJsPath) || fs.existsSync(parserGsPath);
      const hasHandler = fs.existsSync(handlerJsPath) || fs.existsSync(handlerGsPath);

      assert(hasParser, "core/reservation_parser.js or .gs MUST exist in production project");
      assert(hasHandler, "core/reservation_workflow_handler.js or .gs MUST exist in production project");
    }
  },
  {
    name: "4. Legacy replyToLine, product search, and customer reply text MUST NOT be deleted or altered",
    run() {
      assert(lineMainContent.includes("function replyToLine"), "replyToLine function MUST be preserved");
      assert(lineMainContent.includes("系統沒有找到完全符合"), "Legacy customer search reply text MUST be preserved");
      assert(lineMainContent.includes("歡迎使用勁揚建材庫存查詢系統"), "Welcome text MUST be preserved");
      assert(assistantContent.includes("JingyangAssistant_tryHandleLineEvent"), "Assistant event handler MUST be preserved");
    }
  },
  {
    name: "5. confirmHoldDraft payload passed to callback MUST contain lineUserId equal to postback event userId",
    run() {
      let capturedPayload = null;
      const testUserId = "U98765432101234567890123456789012";
      const draftId = "DRAFT-TEST-123";

      const mockStore = {
        "pendingDraftHold:U98765432101234567890123456789012": JSON.stringify({
          draftId: draftId,
          customerName: "美麗空間",
          productCode: "STU-6101",
          quantity: 2,
          expiresAt: new Date(Date.now() + 600000).toISOString()
        })
      };

      const mockPropertiesStorage = {
        getProperty(key) { return mockStore[key] || null; },
        setProperty(key, val) { mockStore[key] = val; },
        deleteProperty(key) { delete mockStore[key]; }
      };

      const mockUsersTable = [
        {
          displayName: "王小明",
          username: "ming",
          lineUserId: testUserId,
          role: "assistant",
          salesOwner: "王小明"
        }
      ];

      const res = handleLineReservationPostback({
        postbackData: "action=confirmHoldDraft&draftId=" + draftId,
        userId: testUserId,
        usersTable: mockUsersTable,
        inventoryCatalog: [{ item: "STU-6101", availableQuantity: 50 }],
        propertiesStorage: mockPropertiesStorage,
        upsertHoldActionFn: function(payload) {
          capturedPayload = payload;
          return { ok: true, reservationNumber: "RES-TEST-888" };
        }
      });

      assert.strictEqual(res.handled, true);
      assert.strictEqual(res.success, true);
      assert(capturedPayload, "Bridge callback MUST be called");
      assert.strictEqual(capturedPayload.lineUserId, testUserId, "lineUserId in payload MUST equal event userId");
    }
  },
  {
    name: "6. JingyangWorkflow_lineCreateHoldBridge_ function implementation exists in JingyangAssistant.js",
    run() {
      assert(
        assistantContent.includes("function JingyangWorkflow_lineCreateHoldBridge_"),
        "JingyangAssistant.js MUST define function JingyangWorkflow_lineCreateHoldBridge_"
      );
    }
  },
  {
    name: "7. Bridge MUST call JingyangAssistant_getApiUrl_() for Backend URL resolution",
    run() {
      const idxBridge = assistantContent.indexOf("function JingyangWorkflow_lineCreateHoldBridge_");
      assert(idxBridge !== -1, "Bridge function MUST exist");
      const bridgeFnBody = assistantContent.slice(idxBridge, idxBridge + 1500);

      assert(
        bridgeFnBody.includes("JingyangAssistant_getApiUrl_"),
        "Bridge function MUST call JingyangAssistant_getApiUrl_()"
      );
    }
  },
  {
    name: "8. Bridge request body MUST contain action='lineCreateHold', bridgeSecret, lineUserId, and hold",
    run() {
      const idxBridge = assistantContent.indexOf("function JingyangWorkflow_lineCreateHoldBridge_");
      assert(idxBridge !== -1, "Bridge function MUST exist");
      const bridgeFnBody = assistantContent.slice(idxBridge, idxBridge + 1500);

      assert(bridgeFnBody.includes('action: "lineCreateHold"'), "Request body MUST set action: 'lineCreateHold'");
      assert(bridgeFnBody.includes("bridgeSecret:"), "Request body MUST set bridgeSecret");
      assert(bridgeFnBody.includes("lineUserId:"), "Request body MUST set lineUserId");
      assert(bridgeFnBody.includes("hold:"), "Request body MUST set hold");
    }
  },
  {
    name: "9. Bridge request body MUST NOT contain userContext, sessionToken, or role",
    run() {
      const idxBridge = assistantContent.indexOf("function JingyangWorkflow_lineCreateHoldBridge_");
      assert(idxBridge !== -1, "Bridge function MUST exist");
      const bridgeFnBody = assistantContent.slice(idxBridge, idxBridge + 1500);

      const idxReqBody = bridgeFnBody.indexOf("requestBody = {");
      assert(idxReqBody !== -1, "requestBody object literal MUST exist");
      const reqBodySlice = bridgeFnBody.slice(idxReqBody, idxReqBody + 200);

      assert(!reqBodySlice.includes("userContext"), "Bridge requestBody MUST NOT contain userContext");
      assert(!reqBodySlice.includes("sessionToken"), "Bridge requestBody MUST NOT contain sessionToken");
      assert(!reqBodySlice.includes("role"), "Bridge requestBody MUST NOT contain role");
    }
  },
  {
    name: "10. Bridge MUST fail closed (ok: false, BRIDGE_SECRET_MISSING) when LINE_BOT_BRIDGE_SECRET is missing",
    run() {
      const bridgeFn = new Function(
        "holdPayload",
        "PropertiesService",
        "UrlFetchApp",
        `
          ${assistantContent}
          return JingyangWorkflow_lineCreateHoldBridge_(holdPayload);
        `
      );

      const mockEmptyProperties = {
        getScriptProperties() {
          return {
            getProperty() { return null; }
          };
        }
      };

      const res = bridgeFn({
        lineUserId: "U99999999999999999999999999999999",
        hold: { id: "RES-TEST-001", storeName: "美麗空間", item: "STU-6101", quantity: 1 }
      }, mockEmptyProperties, null);

      assert.strictEqual(res.ok, false, "Missing bridge secret MUST fail closed");
      assert.strictEqual(res.errorCode, "BRIDGE_SECRET_MISSING");
    }
  },
  {
    name: "11. Model code normalization matching for STU-6101 vs STU6101 in Hash Map inventory catalog",
    run() {
      const catalogHashMapNormalized = { "STU6101": 50 };
      const parseRes1 = parseReservationText("美麗空間 STU-6101 1個 豪", catalogHashMapNormalized);
      assert.strictEqual(parseRes1.ok, true, "STU-6101 input MUST match Hash Map catalog key STU6101");
      assert.strictEqual(parseRes1.productCode, "STU-6101");

      const catalogHashMapHyphenated = { "STU-6101": 50 };
      const parseRes2 = parseReservationText("美麗空間 STU6101 1個 豪", catalogHashMapHyphenated);
      assert.strictEqual(parseRes2.ok, true, "STU6101 input MUST match Hash Map catalog key STU-6101");

      const testUserId = "U98765432101234567890123456789012";
      const draftId = "DRAFT-TEST-NORM";
      const mockStore = {
        "pendingDraftHold:U98765432101234567890123456789012": JSON.stringify({
          draftId: draftId,
          customerName: "美麗空間",
          productCode: "STU-6101",
          quantity: 2,
          expiresAt: new Date(Date.now() + 600000).toISOString()
        })
      };
      const mockPropertiesStorage = {
        getProperty(key) { return mockStore[key] || null; },
        setProperty(key, val) { mockStore[key] = val; },
        deleteProperty(key) { delete mockStore[key]; }
      };
      const mockUsersTable = [{ displayName: "王小明", username: "ming", lineUserId: testUserId, role: "assistant", salesOwner: "王小明" }];

      const postbackRes = handleLineReservationPostback({
        postbackData: "action=confirmHoldDraft&draftId=" + draftId,
        userId: testUserId,
        usersTable: mockUsersTable,
        inventoryCatalog: { "STU6101": 50 },
        propertiesStorage: mockPropertiesStorage,
        upsertHoldActionFn: function() { return { ok: true }; }
      });
      assert.strictEqual(postbackRes.handled, true);
      assert.strictEqual(postbackRes.success, true, "confirmHoldDraft re-check MUST match normalized model code STU6101");
    }
  },
  {
    name: "12. confirmHoldDraft missing draft diagnostic MUST mask LINE user IDs to last 4 digits and NEVER expose full user ID",
    run() {
      const fullPostbackUserId = "U11111111222222223333333344445555";
      const fullDraftUserId = "U66666666777777778888888899990000";

      const mockStore = {
        ["pendingDraftHold:" + fullDraftUserId]: JSON.stringify({
          draftId: "DRAFT-OTHER-USER",
          customerName: "測試店家",
          productCode: "STU-6101",
          quantity: 1,
          expiresAt: new Date(Date.now() + 600000).toISOString()
        })
      };

      const mockPropertiesStorage = {
        getProperty(key) { return mockStore[key] || null; },
        setProperty(key, val) { mockStore[key] = val; },
        deleteProperty(key) { delete mockStore[key]; },
        getProperties() { return mockStore; }
      };

      const res = handleLineReservationPostback({
        postbackData: "action=confirmHoldDraft&draftId=DRAFT-MISSING",
        userId: fullPostbackUserId,
        usersTable: [],
        inventoryCatalog: {},
        propertiesStorage: mockPropertiesStorage,
        upsertHoldActionFn: function() { return { ok: true }; }
      });

      assert.strictEqual(res.handled, true);
      assert.strictEqual(res.success, false);
      assert(res.message.includes("⚠️ 找不到草稿或已取消。"), "MUST preserve original error message prefix");
      assert(res.message.includes("...5555"), "MUST include masked Postback user ID last 4 digits (...5555)");
      assert(res.message.includes("...0000"), "MUST include masked draft key user ID last 4 digits (...0000)");

      // ABSOLUTE SECURITY CHECK: full LINE User IDs MUST NOT appear in the response message!
      assert(!res.message.includes(fullPostbackUserId), "Full postback LINE User ID MUST NOT be exposed");
      assert(!res.message.includes(fullDraftUserId), "Full draft key LINE User ID MUST NOT be exposed");
    }
  },
  {
    name: "13. confirmHoldDraft draftId mismatch diagnostic MUST mask draftId to last 4 digits and NEVER expose full draftId",
    run() {
      const testUserId = "U98765432101234567890123456789012";
      const fullReqDraftId = "DRAFT-1724680000000-8888";
      const fullSavedDraftId = "DRAFT-1724680000000-9999";

      const mockStore = {
        ["pendingDraftHold:" + testUserId]: JSON.stringify({
          draftId: fullSavedDraftId,
          customerName: "美麗空間",
          productCode: "STU-6101",
          quantity: 2,
          expiresAt: new Date(Date.now() + 600000).toISOString()
        })
      };

      const mockPropertiesStorage = {
        getProperty(key) { return mockStore[key] || null; },
        setProperty(key, val) { mockStore[key] = val; },
        deleteProperty(key) { delete mockStore[key]; }
      };

      const res = handleLineReservationPostback({
        postbackData: "action=confirmHoldDraft&draftId=" + fullReqDraftId,
        userId: testUserId,
        usersTable: [],
        inventoryCatalog: {},
        propertiesStorage: mockPropertiesStorage,
        upsertHoldActionFn: function() { return { ok: true }; }
      });

      assert.strictEqual(res.handled, true);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.errorCode, "INVALID_DRAFT_ID");
      assert(res.message.includes("⚠️ 草稿編號不一致。"), "MUST preserve original error message prefix");
      assert(res.message.includes("...8888"), "MUST include masked request draftId last 4 digits (...8888)");
      assert(res.message.includes("...9999"), "MUST include masked saved draftId last 4 digits (...9999)");

      // ABSOLUTE SECURITY CHECK: full draft IDs MUST NOT appear in the response message!
      assert(!res.message.includes(fullReqDraftId), "Full request draftId MUST NOT be exposed");
      assert(!res.message.includes(fullSavedDraftId), "Full saved draftId MUST NOT be exposed");
    }
  }
];

let passCount = 0;
let failCount = 0;

tests.forEach((t) => {
  try {
    t.run();
    console.log(`PASS linebot-production-workflow: ${t.name}`);
    passCount++;
  } catch (err) {
    console.error(`FAIL linebot-production-workflow: ${t.name}: ${err.message}`);
    failCount++;
  }
});

console.log(`\nLINE Bot Production Workflow Simulation Summary: ${passCount} PASS / ${failCount} FAIL`);

if (failCount > 0) {
  process.exit(1);
}
