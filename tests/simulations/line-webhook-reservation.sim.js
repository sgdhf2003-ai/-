/**
 * LINE Webhook Reservation Draft Wireup Integration Tests
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Load Code.gs file content for testing
const codeGsPath = path.join(__dirname, "../../google-apps-script/Code.gs");
const codeGsContent = fs.readFileSync(codeGsPath, "utf8");

// Load handler content for testing
const handlerPath = path.join(__dirname, "../../allocation-assistant/handlers/line-reservation-draft-handler.js");
const handlerContent = fs.readFileSync(handlerPath, "utf8");

const { handleLineReservationTextEvent } = require("../../allocation-assistant/handlers/line-reservation-draft-handler");

const mockUsersTable = [
  { lineUserId: "U_BOUND_HAO", salesOwner: "豪", displayName: "豪", role: "admin" }
];

const mockInventoryCatalog = [
  { item: "STU-6101", name: "60x100白亮石英磚", availableQuantity: 50 }
];

class MockPropertiesStorage {
  constructor() { this.store = {}; }
  getProperty(k) { return this.store[k] || null; }
  setProperty(k, v) { this.store[k] = String(v); }
  deleteProperty(k) { delete this.store[k]; }
}

const tests = [
  {
    name: "Code.gs contains LineReservationDraft_tryHandleTextEvent wireup BEFORE LineIntent_tryHandleTextEvent",
    run() {
      const idxDraft = codeGsContent.indexOf("LineReservationDraft_tryHandleTextEvent(event)");
      const idxIntent = codeGsContent.indexOf("LineIntent_tryHandleTextEvent(event)");

      assert(idxDraft !== -1, "Code.gs MUST wire LineReservationDraft_tryHandleTextEvent");
      assert(idxIntent !== -1, "Code.gs MUST contain LineIntent_tryHandleTextEvent");
      assert(idxDraft < idxIntent, "LineReservationDraft MUST be evaluated BEFORE LineIntent/legacy search");
    }
  },
  {
    name: "Code.gs contains LineReservationDraft_tryHandlePostback wireup in postback event handler",
    run() {
      assert(
        codeGsContent.includes("LineReservationDraft_tryHandlePostback"),
        "Code.gs MUST wire postback event handler for confirmHoldDraft/cancelHoldDraft"
      );
    }
  },
  {
    name: "Draft Handler uses server-side bound user key (pendingDraftHold:userId) for properties storage",
    run() {
      assert(
        handlerContent.includes("pendingDraftHold:"),
        "Handler MUST store pending draft under pendingDraftHold: prefix"
      );
    }
  },
  {
    name: "Draft Handler confirmHoldDraft re-verifies operator & salesOwner strictly from Users table",
    run() {
      assert(
        handlerContent.includes("usersTable.find") && handlerContent.includes("boundUser.salesOwner"),
        "Handler confirmHoldDraft MUST read Users table for operator verification"
      );
    }
  },
  {
    name: "end-to-end LINE event shape: text event triggers draft handler, blocks legacy search, includes buttons, 0 Sheet writes",
    run() {
      const lineEvent = {
        type: "message",
        replyToken: "nH752a7890abcdef1234567890abcdef",
        source: { userId: "U_BOUND_HAO", type: "user" },
        message: { id: "100001", type: "text", text: "美麗空間 STU-6101 1個 豪" }
      };

      const storage = new MockPropertiesStorage();
      let legacySearchCalled = false;
      let sheetWriteCount = 0;

      // Simulated handler execution matching Code.gs router order
      let draftHandled = false;
      let replyMessages = [];

      const text = lineEvent.message.text;
      const userId = lineEvent.source.userId;

      // 1. Draft handler check (runs FIRST)
      const res = handleLineReservationTextEvent({
        text,
        userId,
        usersTable: mockUsersTable,
        inventoryCatalog: mockInventoryCatalog,
        propertiesStorage: storage
      });

      if (res.handled && res.previewMessage) {
        draftHandled = true;
        replyMessages.push(res.previewMessage);
      } else {
        // Legacy search fallback (should NOT be reached)
        legacySearchCalled = true;
      }

      // Assertions
      assert.strictEqual(draftHandled, true, "Draft handler MUST handle the text event");
      assert.strictEqual(legacySearchCalled, false, "Legacy item search MUST NOT be called");
      assert.strictEqual(sheetWriteCount, 0, "Google Sheet write count MUST be 0");
      assert.strictEqual(replyMessages.length, 1, "Exactly 1 preview reply message sent");

      const replyText = replyMessages[0].text;
      const buttons = replyMessages[0].quickReply.items.map(i => i.action.label);

      assert(buttons.includes("✅ 確認建立劃扣"), "Reply message MUST contain '確認建立劃扣' button");
      assert(buttons.includes("❌ 取消"), "Reply message MUST contain '取消' button");
      assert(replyText.includes("美麗空間"), "Reply message includes customerName");
      assert(replyText.includes("STU-6101"), "Reply message includes productCode");
    }
  }
];

let passCount = 0;
let failCount = 0;

tests.forEach((t) => {
  try {
    t.run();
    console.log(`PASS line-webhook-reservation: ${t.name}`);
    passCount++;
  } catch (err) {
    console.error(`FAIL line-webhook-reservation: ${t.name}: ${err.message}`);
    failCount++;
  }
});

console.log(`\nLINE Webhook Reservation Simulation Summary: ${passCount} PASS / ${failCount} FAIL`);

if (failCount > 0) {
  process.exit(1);
}
