/**
 * Admin & Sales Assistant End-to-End Reservation Vertical Slice & Code.gs App Readback Integration Simulation Test
 *
 * Flow & Scope:
 * 1. LINE text event -> Parse Draft -> Store Pending Draft under lineUserId
 * 2. LINE Postback confirm -> Backend lineCreateHoldAction verifies role -> Creates Hold
 * 3. App Readback via Code.gs doGet(e) -> Returns JSON payload from doGet containing newly created hold
 * 4. Complete End-to-End Vertical Slice for Admin (LINE Text -> Postback -> Code.gs Hold Creation -> Code.gs doGet App Readback)
 * 5. Complete End-to-End Vertical Slice for Sales Assistant (role === "assistant")
 * 6. Role Allowlist & Security Verification:
 *    - Authorized roles (admin, boss, assistant) create hold successfully
 *    - Unauthorized roles (sales, retail, showroomsales, unbound lineUserId) are rejected with UNAUTHORIZED_OPERATOR / INTERNAL_USER_UNBOUND
 *    - Rejections result in 0 hold writes in backend store
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const repoRoot = path.join(__dirname, "../..");
const { runSuite } = require("./helpers");

const codeGsPath = path.join(repoRoot, "google-apps-script/Code.gs");
const codeGsContent = fs.readFileSync(codeGsPath, "utf8");

const { handleLineReservationTextEvent, handleLineReservationPostback } = require(
  path.join(repoRoot, "allocation-assistant/handlers/line-reservation-draft-handler.js")
);

class MockPropertiesStorage {
  constructor() { this.store = {}; }
  getProperty(k) { return this.store[k] || null; }
  setProperty(k, v) { this.store[k] = String(v); }
  deleteProperty(k) { delete this.store[k]; }
}

class MockBackendStore {
  constructor() {
    this.holds = [];
    this.users = [
      {
        id: "U001",
        lineUserId: "U_ADMIN_HAO",
        displayName: "豪",
        username: "admin_hao",
        role: "admin",
        status: "啟用",
        salesOwner: "豪"
      },
      {
        id: "U002",
        lineUserId: "U_BOSS_CHEN",
        displayName: "陳老闆",
        username: "boss_chen",
        role: "boss",
        status: "啟用",
        salesOwner: "陳老闆"
      },
      {
        id: "U003",
        lineUserId: "U_ASSISTANT_LIN",
        displayName: "林助理",
        username: "assistant_lin",
        role: "assistant",
        status: "啟用",
        salesOwner: "林助理"
      },
      {
        id: "U004",
        lineUserId: "U_SALES_ZHANG",
        displayName: "張業務",
        username: "sales_zhang",
        role: "sales",
        status: "啟用",
        salesOwner: "張業務"
      },
      {
        id: "U005",
        lineUserId: "U_RETAIL_WANG",
        displayName: "王門市",
        username: "retail_wang",
        role: "retail",
        status: "啟用",
        salesOwner: "王門市"
      },
      {
        id: "U006",
        lineUserId: "U_SHOWROOM_LIU",
        displayName: "劉展廳",
        username: "showroom_liu",
        role: "showroomsales",
        status: "啟用",
        salesOwner: "劉展廳"
      }
    ];
  }

  upsertHold(hold) {
    const reservationNumber = hold.reservationNumber || hold.id || `RES-${Date.now()}`;
    const record = {
      ...hold,
      id: reservationNumber,
      reservationNumber,
      status: hold.status || "ACTIVE",
      createdAt: hold.createdAt || new Date().toISOString()
    };
    const idx = this.holds.findIndex(h => h.id === reservationNumber || h.reservationNumber === reservationNumber);
    if (idx >= 0) {
      this.holds[idx] = record;
    } else {
      this.holds.push(record);
    }
    return { ok: true, reservationNumber, holdRecord: record };
  }
}

/**
 * Creates a controlled GAS environment running Code.gs functions (doGet, lineCreateHoldAction, readAll, jsonOutput).
 */
function createCodeGsRunner(backendStore) {
  const scriptProps = {
    LINE_BOT_BRIDGE_SECRET: "TEST_BRIDGE_SECRET_123",
    SPREADSHEET_ID: "MOCK_SPREADSHEET_ID"
  };

  const ContentService = {
    MimeType: { JSON: "JSON" },
    createTextOutput(content) {
      return {
        getContent() { return content; },
        setMimeType(mime) { this.mimeType = mime; return this; }
      };
    }
  };

  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(k) { return scriptProps[k] || null; },
        setProperty(k, v) { scriptProps[k] = String(v); }
      };
    }
  };

  const HEADERS = {
    users: ["id", "username", "displayName", "password", "role", "salesOwner", "status", "note", "createdAt", "updatedAt", "lineUserId"],
    holds: ["id", "storeId", "storeName", "salesOwner", "item", "quantity", "reservationStatus", "holdAddress", "holdDate", "expiresAt", "reminderAt", "note", "status", "createdAt", "updatedAt"],
    stores: ["id", "customerCode", "name", "shortName", "salesOwner", "phone", "phone2", "mobile", "address", "region", "contactName", "taxId", "note", "createdAt", "updatedAt", "ownerEdited"],
    projects: ["id", "storeId", "storeName", "salesOwner", "projectName", "projectAddress", "tileDetails", "expectedDeliveryDate", "status", "note", "createdAt", "updatedAt"],
    samples: ["id", "storeId", "storeName", "salesOwner", "itemType", "modelName", "quantity", "status", "driveUrl", "fileId", "note", "createdAt", "updatedAt"],
    complaints: ["id", "storeId", "storeName", "salesOwner", "issueDescription", "category", "driveUrl", "fileId", "status", "coordinationLog", "createdAt", "updatedAt"],
    settings: ["key", "value", "updatedAt"],
    tasks: ["id", "type", "title", "description", "customerId", "customerName", "productName", "quantity", "assignedTo", "assignedRole", "status", "priority", "dueDate", "source", "createdBy", "createdAt", "updatedAt", "completedAt", "note", "workflowStage", "parentWorkId", "sourceRole", "sourceUser", "blockedReason", "startedAt", "updatedBy"],
    auditLogs: ["id", "workId", "action", "operator", "operatorRole", "fromStatus", "toStatus", "details", "createdAt"]
  };

  function getSheetData(name) {
    if (name === "Users") return backendStore.users;
    if (name === "保留物品") return backendStore.holds;
    return [];
  }

  function createMockSheet(name) {
    const headerKey = Object.keys(HEADERS).find(k => (
      (name === "Users" && k === "users") ||
      (name === "保留物品" && k === "holds") ||
      k === name
    ));
    const headers = HEADERS[headerKey] || [];

    return {
      getName() { return name; },
      getLastRow() {
        const data = getSheetData(name);
        return data.length + 1; // 1 header row + N data rows
      },
      getLastColumn() {
        return headers.length || 15;
      },
      getRange(startRow, startCol, numRows, numCols) {
        return {
          getValues() {
            if (startRow === 1 && numRows === 1) {
              return [headers];
            }
            const data = getSheetData(name);
            const slice = data.slice(startRow - 2, startRow - 2 + numRows);
            return slice.map(item => headers.map(h => item[h] ?? ""));
          },
          setValues() {},
          clearContent() {}
        };
      },
      clear() {},
      setFrozenRows() {},
      appendRow() {}
    };
  }

  const mockSpreadsheet = {
    getId() { return "MOCK_SPREADSHEET_ID"; },
    getUrl() { return "https://example.com/mock_sheet"; },
    getSheetByName(name) { return createMockSheet(name); },
    insertSheet(name) { return createMockSheet(name); }
  };

  const SpreadsheetApp = {
    openById(id) { return mockSpreadsheet; },
    getActiveSpreadsheet() { return mockSpreadsheet; },
    create(name) { return mockSpreadsheet; }
  };

  const fn = new Function(
    "ContentService",
    "PropertiesService",
    "SpreadsheetApp",
    "actionName",
    "params",
    "adapter",
    `
      ${codeGsContent}
      if (actionName === "doGet") return doGet(params);
      if (actionName === "lineCreateHold") return lineCreateHoldAction(params, adapter);
      if (actionName === "readAll") return readAll();
    `
  );

  return {
    doGet(e) {
      return fn(ContentService, PropertiesService, SpreadsheetApp, "doGet", e, null);
    },
    lineCreateHold(data, adapter) {
      return fn(ContentService, PropertiesService, SpreadsheetApp, "lineCreateHold", data, adapter);
    },
    readAll() {
      return fn(ContentService, PropertiesService, SpreadsheetApp, "readAll", null, null);
    }
  };
}

const tests = [
  {
    name: "1. LINE Text Event -> Parse Draft -> Store Pending Draft under Admin lineUserId",
    run() {
      const storage = new MockPropertiesStorage();
      const backendStore = new MockBackendStore();
      const mockCatalog = [
        { item: "STU-6101", name: "60x100白亮石英磚", availableQuantity: 50 }
      ];

      const lineEvent = {
        type: "message",
        replyToken: "reply_token_admin_1",
        source: { userId: "U_ADMIN_HAO", type: "user" },
        message: { id: "msg_001", type: "text", text: "美麗空間 STU-6101 1個 豪" }
      };

      const result = handleLineReservationTextEvent({
        text: lineEvent.message.text,
        userId: lineEvent.source.userId,
        usersTable: backendStore.users,
        inventoryCatalog: mockCatalog,
        propertiesStorage: storage
      });

      assert.strictEqual(result.handled, true, "Text event MUST be handled by draft handler");
      assert.ok(result.previewMessage, "Preview message MUST be generated");
      assert(
        result.previewMessage.text.includes("美麗空間") && result.previewMessage.text.includes("STU-6101"),
        "Preview text MUST contain parsed storeName and item"
      );

      const storedDraftRaw = storage.getProperty("pendingDraftHold:U_ADMIN_HAO");
      assert.ok(storedDraftRaw, "Draft MUST be stored in PropertiesStorage under pendingDraftHold:U_ADMIN_HAO");
      const storedDraft = JSON.parse(storedDraftRaw);
      assert.strictEqual(storedDraft.customerName, "美麗空間");
      assert.strictEqual(storedDraft.productCode, "STU-6101");
      assert.strictEqual(storedDraft.quantity, 1);
    }
  },
  {
    name: "2. Postback Confirm -> Backend lineCreateHoldAction verifies Admin role -> Creates Hold",
    run() {
      const backendStore = new MockBackendStore();
      const runner = createCodeGsRunner(backendStore);
      const mockAdapter = {
        upsertHold(hold) { return backendStore.upsertHold(hold); }
      };

      const requestPayload = {
        bridgeSecret: "TEST_BRIDGE_SECRET_123",
        lineUserId: "U_ADMIN_HAO",
        usersTable: backendStore.users,
        hold: {
          reservationNumber: "RES-20260906-001001",
          storeName: "美麗空間",
          item: "STU-6101",
          quantity: 1,
          salesOwner: "豪",
          reservationStatus: "未收訂"
        }
      };

      const createRes = runner.lineCreateHold(requestPayload, mockAdapter);

      assert.strictEqual(createRes.ok, true, `lineCreateHoldAction MUST succeed for Admin role, got: ${JSON.stringify(createRes)}`);
      assert.ok(createRes.reservationNumber, "Response MUST include reservationNumber");
      assert.ok(createRes.reservationNumber.startsWith("RES-"), "Reservation number MUST follow RES- format");
      assert.strictEqual(backendStore.holds.length, 1, "Backend store MUST have 1 hold record");
      assert.strictEqual(backendStore.holds[0].storeName, "美麗空間");
      assert.strictEqual(backendStore.holds[0].item, "STU-6101");
    }
  },
  {
    name: "3. App Readback via Code.gs doGet(e) -> Returns JSON containing Admin created hold record",
    run() {
      const backendStore = new MockBackendStore();
      const runner = createCodeGsRunner(backendStore);
      const mockAdapter = {
        upsertHold(hold) { return backendStore.upsertHold(hold); }
      };

      // Step A: Create hold via lineCreateHoldAction in Code.gs
      const createRes = runner.lineCreateHold({
        bridgeSecret: "TEST_BRIDGE_SECRET_123",
        lineUserId: "U_ADMIN_HAO",
        usersTable: backendStore.users,
        hold: {
          reservationNumber: "RES-20260906-001002",
          storeName: "美麗空間",
          item: "STU-6101",
          quantity: 1,
          salesOwner: "豪"
        }
      }, mockAdapter);

      assert.strictEqual(createRes.ok, true, "Hold creation MUST succeed");

      // Step B: App Query via Code.gs doGet(e)
      const doGetEvent = { parameter: { action: "readAll" } };
      const doGetOutput = runner.doGet(doGetEvent);

      assert.ok(doGetOutput && typeof doGetOutput.getContent === "function", "doGet MUST return ContentService text output");
      const readbackData = JSON.parse(doGetOutput.getContent());

      assert.strictEqual(readbackData.ok, true, "doGet readback response MUST have ok: true");
      assert.ok(Array.isArray(readbackData.holds), "doGet readback response holds MUST be an array");
      assert.strictEqual(readbackData.holds.length, 1, "holds array MUST contain the created hold");

      const queriedHold = readbackData.holds[0];
      assert.strictEqual(queriedHold.id, "RES-20260906-001002");
      assert.strictEqual(queriedHold.storeName, "美麗空間");
      assert.strictEqual(queriedHold.item, "STU-6101");
      assert.strictEqual(queriedHold.salesOwner, "豪");
    }
  },
  {
    name: "4. End-to-End Vertical Flow for Admin (LINE Text -> Postback -> Code.gs Hold Creation -> Code.gs doGet App Readback)",
    run() {
      const storage = new MockPropertiesStorage();
      const backendStore = new MockBackendStore();
      const runner = createCodeGsRunner(backendStore);
      const mockAdapter = {
        upsertHold(hold) { return backendStore.upsertHold(hold); }
      };
      const mockCatalog = [{ item: "STU-6101", name: "60x100白亮石英磚", availableQuantity: 50 }];

      // Step 1: LINE Text Event
      const textRes = handleLineReservationTextEvent({
        text: "美麗空間 STU-6101 1個 豪",
        userId: "U_ADMIN_HAO",
        usersTable: backendStore.users,
        inventoryCatalog: mockCatalog,
        propertiesStorage: storage
      });
      assert.strictEqual(textRes.handled, true, "Text event handled");

      // Step 2: Postback event (confirmHoldDraft)
      const postbackRes = handleLineReservationPostback({
        postbackData: `action=confirmHoldDraft&draftId=${textRes.draftId}`,
        userId: "U_ADMIN_HAO",
        usersTable: backendStore.users,
        inventoryCatalog: mockCatalog,
        propertiesStorage: storage,
        upsertHoldActionFn(holdPayload) {
          return runner.lineCreateHold({
            bridgeSecret: "TEST_BRIDGE_SECRET_123",
            lineUserId: "U_ADMIN_HAO",
            usersTable: backendStore.users,
            hold: holdPayload.hold
          }, mockAdapter);
        }
      });

      assert.strictEqual(postbackRes.handled, true, "Postback event handled");
      assert.strictEqual(postbackRes.success, true, "Postback execution MUST succeed");

      // Step 3: App fetch data via Code.gs doGet(e)
      const doGetOutput = runner.doGet({ parameter: { action: "readAll" } });
      const readbackData = JSON.parse(doGetOutput.getContent());

      assert.strictEqual(readbackData.ok, true, "doGet readback ok MUST be true");
      assert.strictEqual(readbackData.holds.length, 1, "App query via doGet MUST see the hold");
      assert.strictEqual(readbackData.holds[0].item, "STU-6101");
      assert.strictEqual(readbackData.holds[0].storeName, "美麗空間");
    }
  },
  {
    name: "5. Sales Assistant End-to-End Vertical Flow (role === 'assistant', LINE Text -> Postback -> Code.gs Hold -> App Readback)",
    run() {
      const storage = new MockPropertiesStorage();
      const backendStore = new MockBackendStore();
      const runner = createCodeGsRunner(backendStore);
      const mockAdapter = {
        upsertHold(hold) { return backendStore.upsertHold(hold); }
      };
      const mockCatalog = [{ item: "EQA-6522", name: "60x120灰霧石英磚", availableQuantity: 100 }];

      // Step 1: Sales Assistant LINE Text Event (lineUserId: U_ASSISTANT_LIN, role: assistant, status: 啟用)
      const textRes = handleLineReservationTextEvent({
        text: "極致空間 EQA-6522 10片 林助理",
        userId: "U_ASSISTANT_LIN",
        usersTable: backendStore.users,
        inventoryCatalog: mockCatalog,
        propertiesStorage: storage
      });
      assert.strictEqual(textRes.handled, true, "Sales Assistant text event MUST be handled");
      assert.ok(textRes.draftId, "draftId generated for Sales Assistant");

      // Step 2: Postback event (confirmHoldDraft) from Sales Assistant
      const postbackRes = handleLineReservationPostback({
        postbackData: `action=confirmHoldDraft&draftId=${textRes.draftId}`,
        userId: "U_ASSISTANT_LIN",
        usersTable: backendStore.users,
        inventoryCatalog: mockCatalog,
        propertiesStorage: storage,
        upsertHoldActionFn(holdPayload) {
          return runner.lineCreateHold({
            bridgeSecret: "TEST_BRIDGE_SECRET_123",
            lineUserId: "U_ASSISTANT_LIN",
            usersTable: backendStore.users,
            hold: holdPayload.hold
          }, mockAdapter);
        }
      });

      assert.strictEqual(postbackRes.handled, true, "Postback event MUST be handled for Sales Assistant");
      assert.strictEqual(postbackRes.success, true, "Sales Assistant postback confirm MUST succeed");
      assert.ok(postbackRes.reservationNumber.startsWith("RES-"), "Reservation number generated");

      // Step 3: App Readback via Code.gs doGet(e)
      const doGetOutput = runner.doGet({ parameter: { action: "readAll" } });
      const readbackData = JSON.parse(doGetOutput.getContent());

      assert.strictEqual(readbackData.ok, true, "doGet readback ok MUST be true");
      assert.strictEqual(readbackData.holds.length, 1, "App query MUST see Sales Assistant created hold");

      const createdHold = readbackData.holds[0];
      const resNo = createdHold.id || createdHold.reservationNumber;
      assert.strictEqual(resNo, postbackRes.reservationNumber, "Reservation number matched in App readback");
      assert.strictEqual(createdHold.storeName, "極致空間");
      assert.strictEqual(createdHold.item, "EQA-6522");
      assert.strictEqual(createdHold.salesOwner, "林助理");
    }
  },
  {
    name: "6. Role Allowlist & Security Boundary Verification (Admin/Boss/Assistant ALLOWED, Sales/Retail/Showroom/Unbound REJECTED with 0 writes)",
    run() {
      const backendStore = new MockBackendStore();
      const runner = createCodeGsRunner(backendStore);
      const mockAdapter = {
        upsertHold(hold) { return backendStore.upsertHold(hold); }
      };

      const holdData = { storeName: "測試門市", item: "EQA-6522", quantity: 5 };

      // 1. Authorized Role: Admin -> ALLOWED
      const resAdmin = runner.lineCreateHold({
        bridgeSecret: "TEST_BRIDGE_SECRET_123",
        lineUserId: "U_ADMIN_HAO",
        usersTable: backendStore.users,
        hold: { ...holdData, reservationNumber: "RES-ADMIN-001" }
      }, mockAdapter);
      assert.strictEqual(resAdmin.ok, true, "Admin role MUST be permitted");

      // 2. Authorized Role: Boss -> ALLOWED
      const resBoss = runner.lineCreateHold({
        bridgeSecret: "TEST_BRIDGE_SECRET_123",
        lineUserId: "U_BOSS_CHEN",
        usersTable: backendStore.users,
        hold: { ...holdData, reservationNumber: "RES-BOSS-001" }
      }, mockAdapter);
      assert.strictEqual(resBoss.ok, true, "Boss role MUST be permitted");

      // 3. Authorized Role: Assistant -> ALLOWED
      const resAssistant = runner.lineCreateHold({
        bridgeSecret: "TEST_BRIDGE_SECRET_123",
        lineUserId: "U_ASSISTANT_LIN",
        usersTable: backendStore.users,
        hold: { ...holdData, reservationNumber: "RES-ASSISTANT-001" }
      }, mockAdapter);
      assert.strictEqual(resAssistant.ok, true, "Assistant role MUST be permitted");

      const countAfterAuthorized = backendStore.holds.length;
      assert.strictEqual(countAfterAuthorized, 3, "Exactly 3 holds created for authorized roles");

      // 4. Unauthorized Role: Sales -> REJECTED (0 writes)
      const resSales = runner.lineCreateHold({
        bridgeSecret: "TEST_BRIDGE_SECRET_123",
        lineUserId: "U_SALES_ZHANG",
        usersTable: backendStore.users,
        hold: { ...holdData, reservationNumber: "RES-SALES-999" }
      }, mockAdapter);
      assert.strictEqual(resSales.ok, false, "Sales role MUST be rejected");
      assert.strictEqual(resSales.errorCode, "UNAUTHORIZED_OPERATOR", "Sales rejection errorCode MUST be UNAUTHORIZED_OPERATOR");

      // 5. Unauthorized Role: Retail -> REJECTED (0 writes)
      const resRetail = runner.lineCreateHold({
        bridgeSecret: "TEST_BRIDGE_SECRET_123",
        lineUserId: "U_RETAIL_WANG",
        usersTable: backendStore.users,
        hold: { ...holdData, reservationNumber: "RES-RETAIL-999" }
      }, mockAdapter);
      assert.strictEqual(resRetail.ok, false, "Retail role MUST be rejected");
      assert.strictEqual(resRetail.errorCode, "UNAUTHORIZED_OPERATOR");

      // 6. Unauthorized Role: Showroom -> REJECTED (0 writes)
      const resShowroom = runner.lineCreateHold({
        bridgeSecret: "TEST_BRIDGE_SECRET_123",
        lineUserId: "U_SHOWROOM_LIU",
        usersTable: backendStore.users,
        hold: { ...holdData, reservationNumber: "RES-SHOWROOM-999" }
      }, mockAdapter);
      assert.strictEqual(resShowroom.ok, false, "Showroomsales role MUST be rejected");
      assert.strictEqual(resShowroom.errorCode, "UNAUTHORIZED_OPERATOR");

      // 7. Unbound User -> REJECTED (0 writes)
      const resUnbound = runner.lineCreateHold({
        bridgeSecret: "TEST_BRIDGE_SECRET_123",
        lineUserId: "U_UNBOUND_UNKNOWN",
        usersTable: backendStore.users,
        hold: { ...holdData, reservationNumber: "RES-UNBOUND-999" }
      }, mockAdapter);
      assert.strictEqual(resUnbound.ok, false, "Unbound lineUserId MUST be rejected");
      assert.strictEqual(resUnbound.errorCode, "INTERNAL_USER_UNBOUND");

      // Final check: Hold count MUST remain exactly 3 (0 writes added during 4 rejection attempts)
      assert.strictEqual(backendStore.holds.length, 3, "Store hold count MUST remain 3 after rejections (0 writes)");

      // App Readback via Code.gs doGet(e) sees exactly 3 holds
      const doGetOutput = runner.doGet({ parameter: { action: "readAll" } });
      const readbackData = JSON.parse(doGetOutput.getContent());
      assert.strictEqual(readbackData.holds.length, 3, "doGet readback MUST see exactly 3 holds");
    }
  }
];

runSuite("Admin & Sales Assistant Line-to-App Reservation Vertical Slice Suite", tests);
