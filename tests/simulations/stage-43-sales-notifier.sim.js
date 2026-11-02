/**
 * Stage 43: Real-Time Sales Notifier Simulation Tests
 *
 * Verifies:
 * - TC-43-01: Flex Template rendering for locked, cancelled, and committed events
 * - TC-43-02: SalesNotifierAdapter default notificationBypassed guard
 * - TC-43-03: SalesNotifierAdapter in-memory operationId deduplication
 * - TC-43-04: SalesNotifierAdapter 3s fail-fast timeout and fetcher execution
 * - TC-43-05: SalesNotifierAdapter fail-safe error isolation and PII/token sanitization
 * - TC-43-06: ProjectionEngine integration with notifier hook on SUCCEEDED events
 * - TC-43-07: ProjectionEngine fail-safe isolation when notifier throws
 * - TC-43-08: ProjectionEngine skips notifier on duplicate / SKIP_ACK events
 */

"use strict";

const assert = require("assert");
const {
  buildReservationLockedFlexTemplate,
  buildReservationCancelledFlexTemplate,
  buildFulfillmentCommittedFlexTemplate,
  renderSalesFlexMessage
} = require("../../allocation-assistant/templates/line-flex-templates");

const {
  SalesNotifierAdapter
} = require("../../allocation-assistant/adapters/sales-notifier-adapter");

const {
  ProjectionEngine
} = require("../../allocation-assistant/projection/projection-engine");

const {
  buildApplicationEnvelope
} = require("../../allocation-assistant/contracts/projection-contract");

async function runStage43Simulation() {
  console.log("=== Running Stage 43 Sales Notifier Simulation Tests ===");
  let passed = 0;

  // -------------------------------------------------------------
  // TC-43-01: Flex Templates Schema & Parameterization
  // -------------------------------------------------------------
  {
    const lockedMsg = buildReservationLockedFlexTemplate({
      reservationNumber: "RES-20261030-001",
      clientName: "漢樺企業",
      clientId: "A0001",
      salesRep: "豪",
      itemNo: "WOW-1222",
      quantity: 300,
      unit: "支",
      remainingQuota: 1200,
      monthlySales: 2389122
    });

    assert.strictEqual(lockedMsg.type, "flex");
    assert(lockedMsg.altText.includes("漢樺企業 (A0001)"));
    assert(lockedMsg.altText.includes("+300 支"));
    assert.strictEqual(lockedMsg.contents.header.backgroundColor, "#1E3A8A");
    assert.strictEqual(lockedMsg.contents.header.contents[0].text, "📦 配貨鎖定成功");
    assert.strictEqual(lockedMsg.contents.header.contents[1].text, "單號：RES-20261030-001");
    assert.strictEqual(lockedMsg.contents.body.contents[0].contents[0].text, "漢樺企業 (A0001)");
    assert.strictEqual(lockedMsg.contents.body.contents[0].contents[1].text, "負責業務：豪");

    // Cancelled template
    const cancelMsg = buildReservationCancelledFlexTemplate({
      reservationNumber: "RES-20261030-001",
      clientName: "漢樺企業",
      clientId: "A0001",
      salesRep: "豪",
      itemNo: "WOW-1222",
      quantity: 300,
      unit: "支",
      cancelReason: "客戶延後施工"
    });
    assert.strictEqual(cancelMsg.contents.header.backgroundColor, "#991B1B");
    assert.strictEqual(cancelMsg.contents.header.contents[0].text, "❌ 配貨已取消 / 釋放");
    assert(cancelMsg.altText.includes("-300 支"));

    // Committed template
    const commitMsg = buildFulfillmentCommittedFlexTemplate({
      reservationNumber: "RES-20261030-001",
      clientName: "漢樺企業",
      clientId: "A0001",
      salesRep: "豪",
      itemNo: "WOW-1222",
      quantity: 300,
      unit: "支",
      warehouse: "忠義倉"
    });
    assert.strictEqual(commitMsg.contents.header.backgroundColor, "#065F46");
    assert.strictEqual(commitMsg.contents.header.contents[0].text, "🚚 配貨已出貨銷扣");
    assert(commitMsg.altText.includes("出貨 300 支"));

    // renderSalesFlexMessage dispatcher
    assert.strictEqual(renderSalesFlexMessage("RESERVATION_CREATED").contents.header.contents[0].text, "📦 配貨鎖定成功");
    assert.strictEqual(renderSalesFlexMessage("RESERVATION_CANCELLED").contents.header.contents[0].text, "❌ 配貨已取消 / 釋放");
    assert.strictEqual(renderSalesFlexMessage("FULFILLMENT_COMMITTED").contents.header.contents[0].text, "🚚 配貨已出貨銷扣");

    passed++;
    console.log("  [PASS] TC-43-01: Flex Template rendering for locked, cancelled, and committed events");
  }

  // -------------------------------------------------------------
  // TC-43-02: SalesNotifierAdapter default notificationBypassed guard
  // -------------------------------------------------------------
  {
    const adapter = new SalesNotifierAdapter();
    assert.strictEqual(adapter.notificationBypassed, true, "notificationBypassed must default to true");

    const res = await adapter.notifySalesReservationLocked({
      operationId: "OP-43-001",
      reservationNumber: "RES-20261030-001",
      clientName: "漢樺企業"
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.bypassed, true);
    assert.strictEqual(res.delivered, false);
    assert.strictEqual(res.reason, "NOTIFICATION_BYPASSED_BY_DEFAULT");
    assert(adapter.hasNotified("OP-43-001"), "operationId must be cached even in bypass mode");

    passed++;
    console.log("  [PASS] TC-43-02: SalesNotifierAdapter default notificationBypassed guard");
  }

  // -------------------------------------------------------------
  // TC-43-03: SalesNotifierAdapter in-memory operationId deduplication
  // -------------------------------------------------------------
  {
    const adapter = new SalesNotifierAdapter({ notificationBypassed: true });
    await adapter.dispatchSalesNotification("RESERVATION_CREATED", {
      operationId: "OP-DEDUP-123"
    });

    // Second call with same operationId
    const dedupRes = await adapter.dispatchSalesNotification("RESERVATION_CREATED", {
      operationId: "OP-DEDUP-123"
    });

    assert.strictEqual(dedupRes.success, true);
    assert.strictEqual(dedupRes.duplicate, true);
    assert.strictEqual(dedupRes.bypassed, true);
    assert.strictEqual(dedupRes.reason, "DEDUPLICATION_CACHE_HIT");

    passed++;
    console.log("  [PASS] TC-43-03: SalesNotifierAdapter in-memory operationId deduplication");
  }

  // -------------------------------------------------------------
  // TC-43-04: SalesNotifierAdapter 3s fail-fast timeout and fetcher execution
  // -------------------------------------------------------------
  {
    let fetchCalled = false;
    let receivedUrl = null;
    let receivedPayload = null;

    const fakeFetcher = async (url, options) => {
      fetchCalled = true;
      receivedUrl = url;
      receivedPayload = JSON.parse(options.payload);
      return {
        status: 200,
        getResponseCode: () => 200,
        headers: { "x-line-request-id": "req-tc-43-04" },
        getAllHeaders: () => ({ "x-line-request-id": "req-tc-43-04" })
      };
    };

    const adapter = new SalesNotifierAdapter({
      notificationBypassed: false,
      channelAccessToken: "test-channel-token-12345",
      fetcher: fakeFetcher,
      timeoutMs: 500
    });

    const sendRes = await adapter.notifySalesReservationLocked({
      operationId: "OP-SEND-01",
      reservationNumber: "RES-20261030-001",
      recipientLineUserId: "U1234567890abcdef1234567890abcdef",
      clientName: "漢樺企業",
      itemNo: "WOW-1222",
      quantity: 300
    });

    assert.strictEqual(sendRes.success, true);
    assert.strictEqual(sendRes.delivered, true);
    assert.strictEqual(sendRes.lineRequestId, "req-tc-43-04");
    assert.strictEqual(fetchCalled, true);
    assert.strictEqual(receivedUrl, "https://api.line.me/v2/bot/message/push");
    assert.strictEqual(receivedPayload.to, "U1234567890abcdef1234567890abcdef");

    // Timeout test
    const hangingFetcher = () => new Promise((resolve) => setTimeout(() => resolve({ getResponseCode: () => 200 }), 2000));
    const timeoutAdapter = new SalesNotifierAdapter({
      notificationBypassed: false,
      channelAccessToken: "test-token",
      fetcher: hangingFetcher,
      timeoutMs: 50 // Short 50ms timeout
    });

    const timeoutRes = await timeoutAdapter.notifySalesReservationLocked({
      operationId: "OP-TIMEOUT-01",
      recipientLineUserId: "U1234567890abcdef1234567890abcdef"
    });

    assert.strictEqual(timeoutRes.success, false);
    assert.strictEqual(timeoutRes.delivered, false);
    assert(timeoutRes.error.includes("NOTIFICATION_TIMEOUT"));

    passed++;
    console.log("  [PASS] TC-43-04: SalesNotifierAdapter 3s fail-fast timeout and fetcher execution");
  }

  // -------------------------------------------------------------
  // TC-43-05: SalesNotifierAdapter fail-safe error isolation and PII/token sanitization
  // -------------------------------------------------------------
  {
    const explodingFetcher = () => {
      throw new Error("HTTP connection failed with Bearer secret-raw-token-abc for U1234567890abcdef1234567890abcdef");
    };

    const adapter = new SalesNotifierAdapter({
      notificationBypassed: false,
      channelAccessToken: "secret-raw-token-abc",
      fetcher: explodingFetcher
    });

    const errRes = await adapter.notifySalesReservationLocked({
      operationId: "OP-ERR-01",
      recipientLineUserId: "U1234567890abcdef1234567890abcdef"
    });

    assert.strictEqual(errRes.success, false);
    assert.strictEqual(errRes.delivered, false);
    // Token must be redacted
    assert(!errRes.error.includes("secret-raw-token-abc"), "Token must be redacted in error");
    assert(!errRes.error.includes("U1234567890abcdef1234567890abcdef"), "User ID must be redacted in error");

    passed++;
    console.log("  [PASS] TC-43-05: SalesNotifierAdapter fail-safe error isolation and PII/token sanitization");
  }

  // -------------------------------------------------------------
  // TC-43-06: ProjectionEngine integration with notifier hook on SUCCEEDED events
  // -------------------------------------------------------------
  {
    let notifiedEvent = null;
    let notifiedData = null;

    const fakeNotifier = {
      dispatchSalesNotification: async (eventType, data) => {
        notifiedEvent = eventType;
        notifiedData = data;
        return { success: true, delivered: true };
      }
    };

    const fakeDb = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false, data: () => null }),
          set: async () => {},
          update: async () => {}
        })
      }),
      runTransaction: async (updateFunction) => {
        const fakeTx = {
          get: async () => ({ exists: false, data: () => null }),
          set: () => {},
          update: () => {}
        };
        return await updateFunction(fakeTx);
      }
    };

    const fakeSheets = {
      appendRows: async () => ({ appendedRows: 1 }),
      readRows: async () => []
    };

    const engine = new ProjectionEngine({
      firestoreDb: fakeDb,
      sheetsClient: fakeSheets,
      notifier: fakeNotifier
    });

    // Mock worker processEvent returning SUCCEEDED
    const payload = {
      reservationNumber: "RES-20261030-001",
      storeId: "A0001",
      storeName: "漢樺企業",
      productCode: "WOW-1222",
      quantity: 300,
      salesPerson: "豪",
      remainingQuota: 1200
    };

    const eventEnvelope = {
      operationId: "RES-20261030-001",
      eventType: "RESERVATION_CREATED",
      source: "TEST_SUITE",
      occurredAt: "2026-10-30T09:00:00.000Z",
      payload,
      operator: { pseudonymousActorId: "豪" }
    };

    const snapshot = {
      reservationNumber: "RES-20261030-001",
      eventType: "RESERVATION_CREATED",
      storeId: "A0001",
      productCode: "WOW-1222",
      quantity: 300,
      pseudonymousActorId: "豪",
      occurredAt: "2026-10-30T09:00:00.000Z",
      payloadHash: "a".repeat(64)
    };

    await engine._dispatchNotification(eventEnvelope, snapshot, "RES-20261030-001");

    assert.strictEqual(notifiedEvent, "RESERVATION_CREATED");
    assert.strictEqual(notifiedData.operationId, "RES-20261030-001");
    assert.strictEqual(notifiedData.clientId, "A0001");
    assert.strictEqual(notifiedData.clientName, "漢樺企業");
    assert.strictEqual(notifiedData.salesRep, "豪");
    assert.strictEqual(notifiedData.itemNo, "WOW-1222");
    assert.strictEqual(notifiedData.quantity, 300);
    assert.strictEqual(notifiedData.remainingQuota, 1200);

    passed++;
    console.log("  [PASS] TC-43-06: ProjectionEngine integration with notifier hook on SUCCEEDED events");
  }

  // -------------------------------------------------------------
  // TC-43-07: ProjectionEngine fail-safe isolation when notifier throws
  // -------------------------------------------------------------
  {
    const explodingNotifier = {
      dispatchSalesNotification: async () => {
        throw new Error("LINE_API_FATAL_NETWORK_CRASH");
      }
    };

    const fakeDb = {
      collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) })
    };

    const engine = new ProjectionEngine({
      firestoreDb: fakeDb,
      notifier: explodingNotifier
    });

    // Should not throw
    let didThrow = false;
    try {
      await engine._dispatchNotification({ eventType: "RESERVATION_CREATED" }, {}, "OP-CRASH-01");
    } catch (e) {
      didThrow = true;
    }

    assert.strictEqual(didThrow, false, "_dispatchNotification must never throw outward");

    passed++;
    console.log("  [PASS] TC-43-07: ProjectionEngine fail-safe isolation when notifier throws");
  }

  // -------------------------------------------------------------
  // TC-43-08: ProjectionEngine skips notifier on duplicate / SKIP_ACK events
  // -------------------------------------------------------------
  {
    let notifiedCount = 0;
    const trackingNotifier = {
      dispatchSalesNotification: async () => {
        notifiedCount++;
      }
    };

    const duplicateEnvelope = buildApplicationEnvelope({
      operationId: "RES-20261030-001",
      reservationNumber: "RES-20261030-001",
      eventType: "HOLD_CREATED",
      operatorId: "豪",
      allocationData: {
        storeId: "A0001",
        productCode: "WOW-1222",
        quantity: 100
      }
    });

    const fakeDocData = {
      status: "SUCCEEDED",
      eventId: duplicateEnvelope.eventId,
      payloadHash: duplicateEnvelope.payloadHash
    };

    const fakeDb = {
      collection: () => ({
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => fakeDocData
          })
        })
      }),
      runTransaction: async (updateFunction) => {
        const fakeTx = {
          get: async () => ({
            exists: true,
            data: () => fakeDocData
          }),
          set: () => {},
          update: () => {}
        };
        return await updateFunction(fakeTx);
      }
    };

    const fakeSheets = {
      appendRows: async () => {},
      readRows: async () => []
    };

    const engine = new ProjectionEngine({
      firestoreDb: fakeDb,
      sheetsClient: fakeSheets,
      notifier: trackingNotifier
    });

    const result = await engine.processProjectionEvent(duplicateEnvelope);
    assert.strictEqual(result.status, "ACK");
    assert.strictEqual(result.outcome, "ALREADY_COMPLETED");
    assert.strictEqual(notifiedCount, 0, "Duplicate event must not trigger notification");

    passed++;
    console.log("  [PASS] TC-43-08: ProjectionEngine skips notifier on duplicate / SKIP_ACK events");
  }

  console.log(`\n=== Stage 43 Simulation Complete: ${passed} / 8 Tests PASS ===\n`);
}

if (require.main === module) {
  runStage43Simulation().catch((err) => {
    console.error("Stage 43 Simulation Failed:", err);
    process.exit(1);
  });
}

module.exports = {
  runStage43Simulation
};
