/**
 * LINE Reservation Draft State Machine & Postback Handler Simulation Tests
 */

const assert = require("assert");
const {
  handleLineReservationTextEvent,
  handleLineReservationPostback
} = require("../../allocation-assistant/handlers/line-reservation-draft-handler");

// Mock Inventory Catalog
const mockInventoryCatalog = [
  { item: "STU-6101", name: "60x100白亮石英磚", availableQuantity: 50 },
  { item: "LOW-9999", name: "低庫存磚", availableQuantity: 1 }
];

// Mock Users Table
const mockUsersTable = [
  { lineUserId: "U_BOUND_HAO", salesOwner: "豪", displayName: "豪", role: "admin" },
  { lineUserId: "U_BOUND_ASSISTANT", salesOwner: "助理01", displayName: "小美", role: "assistant" }
];

// In-Memory Script Properties Mock Storage
class MockPropertiesStorage {
  constructor() {
    this.store = {};
  }
  getProperty(key) {
    return this.store[key] || null;
  }
  setProperty(key, val) {
    this.store[key] = String(val);
  }
  deleteProperty(key) {
    delete this.store[key];
  }
}

const tests = [
  {
    name: "1. LINE reservation text event creates server-side pendingDraftHold and returns preview card with 2 Postbacks",
    run() {
      const storage = new MockPropertiesStorage();
      const text = "美麗空間 STU-6101 1個 豪";
      const userId = "U_BOUND_HAO";

      const res = handleLineReservationTextEvent({
        text,
        userId,
        usersTable: mockUsersTable,
        inventoryCatalog: mockInventoryCatalog,
        propertiesStorage: storage
      });

      assert.strictEqual(res.handled, true, "handled MUST be true");
      assert.strictEqual(res.draftCreated, true, "draftCreated MUST be true");
      assert(res.draftId.startsWith("DRAFT-"), "draftId has correct prefix");
      assert.strictEqual(res.previewMessage.quickReply.items.length, 2, "preview has 2 postback actions");

      // Verify draft in storage under key pendingDraftHold:U_BOUND_HAO
      const savedDraftRaw = storage.getProperty("pendingDraftHold:" + userId);
      assert(savedDraftRaw !== null, "draft MUST be stored in properties storage");
      const savedDraft = JSON.parse(savedDraftRaw);
      assert.strictEqual(savedDraft.customerName, "美麗空間");
      assert.strictEqual(savedDraft.productCode, "STU-6101");
      assert.strictEqual(savedDraft.quantity, 1);
    }
  },
  {
    name: "2. Postback cancelHoldDraft removes pendingDraftHold without writing to Sheet or creating real hold",
    run() {
      const storage = new MockPropertiesStorage();
      const userId = "U_BOUND_HAO";
      const draftId = "DRAFT-TEST-CANCEL-123";

      storage.setProperty("pendingDraftHold:" + userId, JSON.stringify({
        draftId,
        customerName: "美麗空間",
        productCode: "STU-6101",
        quantity: 1,
        salesOwnerName: "豪",
        expiresAt: new Date(Date.now() + 600000).toISOString()
      }));

      let holdWritten = false;
      const res = handleLineReservationPostback({
        postbackData: "action=cancelHoldDraft&draftId=" + draftId,
        userId,
        usersTable: mockUsersTable,
        inventoryCatalog: mockInventoryCatalog,
        propertiesStorage: storage,
        upsertHoldActionFn: () => { holdWritten = true; }
      });

      assert.strictEqual(res.handled, true, "handled MUST be true");
      assert.strictEqual(res.action, "cancelHoldDraft", "action matches");
      assert.strictEqual(holdWritten, false, "0 Sheet writes performed");
      assert.strictEqual(storage.getProperty("pendingDraftHold:" + userId), null, "draft MUST be cleared");
    }
  },
  {
    name: "3. Postback confirmHoldDraft re-verifies operator identity, re-checks inventory, calls upsertHoldAction, and clears draft",
    run() {
      const storage = new MockPropertiesStorage();
      const userId = "U_BOUND_HAO";
      const draftId = "DRAFT-TEST-CONFIRM-456";

      storage.setProperty("pendingDraftHold:" + userId, JSON.stringify({
        draftId,
        customerName: "美麗空間",
        productCode: "STU-6101",
        quantity: 1,
        salesOwnerName: "豪",
        expiresAt: new Date(Date.now() + 600000).toISOString()
      }));

      let writtenHoldPayload = null;
      const res = handleLineReservationPostback({
        postbackData: "action=confirmHoldDraft&draftId=" + draftId,
        userId,
        usersTable: mockUsersTable,
        inventoryCatalog: mockInventoryCatalog,
        propertiesStorage: storage,
        upsertHoldActionFn: (payload) => {
          writtenHoldPayload = payload;
          return { ok: true, status: "ACTIVE", reservationNumber: "RES-CONFIRMED-001" };
        }
      });

      assert.strictEqual(res.handled, true, "handled MUST be true");
      assert.strictEqual(res.action, "confirmHoldDraft", "action matches");
      assert.strictEqual(res.success, true, "confirmation MUST succeed");
      assert(writtenHoldPayload !== null, "upsertHoldAction WAS called");
      assert.strictEqual(writtenHoldPayload.hold.storeName, "美麗空間");
      assert.strictEqual(writtenHoldPayload.hold.item, "STU-6101");
      assert.strictEqual(writtenHoldPayload.hold.quantity, 1);
      assert.strictEqual(writtenHoldPayload.hold.salesOwner, "豪");
      assert.strictEqual(storage.getProperty("pendingDraftHold:" + userId), null, "draft MUST be cleared after confirmation");
    }
  },
  {
    name: "4. Postback confirmHoldDraft rejects expired draft (expiresAt < now) with EXPIRED_DRAFT error",
    run() {
      const storage = new MockPropertiesStorage();
      const userId = "U_BOUND_HAO";
      const draftId = "DRAFT-TEST-EXPIRED-789";

      // Expired 5 minutes ago
      storage.setProperty("pendingDraftHold:" + userId, JSON.stringify({
        draftId,
        customerName: "美麗空間",
        productCode: "STU-6101",
        quantity: 1,
        salesOwnerName: "豪",
        expiresAt: new Date(Date.now() - 300000).toISOString()
      }));

      let holdWritten = false;
      const res = handleLineReservationPostback({
        postbackData: "action=confirmHoldDraft&draftId=" + draftId,
        userId,
        usersTable: mockUsersTable,
        inventoryCatalog: mockInventoryCatalog,
        propertiesStorage: storage,
        upsertHoldActionFn: () => { holdWritten = true; }
      });

      assert.strictEqual(res.handled, true, "handled MUST be true");
      assert.strictEqual(res.success, false, "confirmation MUST fail for expired draft");
      assert.strictEqual(res.errorCode, "EXPIRED_DRAFT", "errorCode matches EXPIRED_DRAFT");
      assert.strictEqual(holdWritten, false, "0 Sheet writes performed");
      assert.strictEqual(storage.getProperty("pendingDraftHold:" + userId), null, "expired draft MUST be deleted");
    }
  },
  {
    name: "5. Postback confirmHoldDraft rejects non-existent or mismatched draftId with INVALID_DRAFT_ID error",
    run() {
      const storage = new MockPropertiesStorage();
      const userId = "U_BOUND_HAO";

      let holdWritten = false;
      const res = handleLineReservationPostback({
        postbackData: "action=confirmHoldDraft&draftId=DRAFT-NONEXISTENT",
        userId,
        usersTable: mockUsersTable,
        inventoryCatalog: mockInventoryCatalog,
        propertiesStorage: storage,
        upsertHoldActionFn: () => { holdWritten = true; }
      });

      assert.strictEqual(res.handled, true, "handled MUST be true");
      assert.strictEqual(res.success, false, "confirmation MUST fail for invalid draftId");
      assert.strictEqual(res.errorCode, "INVALID_DRAFT_ID", "errorCode matches INVALID_DRAFT_ID");
      assert.strictEqual(holdWritten, false, "0 Sheet writes performed");
    }
  },
  {
    name: "6. Security: confirmHoldDraft ignores forged salesOwner/role in text draft and resolves operator & salesOwner strictly from server-side bound user",
    run() {
      const storage = new MockPropertiesStorage();
      const userId = "U_BOUND_ASSISTANT"; // Bound user role: assistant, salesOwner: "助理01"
      const draftId = "DRAFT-TEST-FORGED-999";

      // Forged salesOwnerName "admin_god" in text draft
      storage.setProperty("pendingDraftHold:" + userId, JSON.stringify({
        draftId,
        customerName: "美麗空間",
        productCode: "STU-6101",
        quantity: 1,
        salesOwnerName: "admin_god", // Forged text field
        expiresAt: new Date(Date.now() + 600000).toISOString()
      }));

      let writtenHoldPayload = null;
      const res = handleLineReservationPostback({
        postbackData: "action=confirmHoldDraft&draftId=" + draftId,
        userId,
        usersTable: mockUsersTable,
        inventoryCatalog: mockInventoryCatalog,
        propertiesStorage: storage,
        upsertHoldActionFn: (payload) => {
          writtenHoldPayload = payload;
          return { ok: true, status: "ACTIVE" };
        }
      });

      assert.strictEqual(res.success, true, "confirmation succeeds");
      // Security check: salesOwner MUST be resolved from server-side bound user ("助理01"), NOT forged draft field ("admin_god")
      assert.strictEqual(writtenHoldPayload.hold.salesOwner, "助理01", "salesOwner MUST be server-side bound salesOwner");
    }
  }
];

let passCount = 0;
let failCount = 0;

tests.forEach((t) => {
  try {
    t.run();
    console.log(`PASS line-reservation-draft: ${t.name}`);
    passCount++;
  } catch (err) {
    console.error(`FAIL line-reservation-draft: ${t.name}: ${err.message}`);
    failCount++;
  }
});

console.log(`\nLine Reservation Draft Simulation Summary: ${passCount} PASS / ${failCount} FAIL`);

if (failCount > 0) {
  process.exit(1);
}
