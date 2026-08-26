/**
 * LINE Workflow Router Simulation Test Suite
 * 
 * Target Scope: line-bot-apps-script pure unit & structural assertions ONLY.
 * Independent of Backend (google-apps-script/Code.gs) or Node.js handlers.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const lineMainPath = path.join(
  __dirname,
  "../../line-bot-apps-script/src/line程式碼.gs"
);

const assistantPath = path.join(
  __dirname,
  "../../line-bot-apps-script/src/JingyangAssistant.gs"
);

const reservationParserGsPath = path.join(
  __dirname,
  "../../line-bot-apps-script/src/core/reservation_parser.gs"
);

const reservationWorkflowHandlerGsPath = path.join(
  __dirname,
  "../../line-bot-apps-script/src/core/reservation_workflow_handler.gs"
);

const lineMainContent = fs.readFileSync(lineMainPath, "utf8");
const assistantContent = fs.readFileSync(assistantPath, "utf8");
const reservationParserGsContent = fs.readFileSync(reservationParserGsPath, "utf8");
const reservationWorkflowHandlerGsContent = fs.readFileSync(reservationWorkflowHandlerGsPath, "utf8");

// Load Apps Script pure parser function for unit tests
const parseReservationText = new Function(
  "text",
  "inventoryCatalog",
  `${reservationParserGsContent}; return parseReservationText(text, inventoryCatalog);`
);

const tests = [
  {
    name: "1. JingyangWorkflow_tryHandleTextEvent implementation exists",
    run() {
      assert(
        assistantContent.includes("function JingyangWorkflow_tryHandleTextEvent"),
        "JingyangAssistant.gs MUST define function JingyangWorkflow_tryHandleTextEvent"
      );
    }
  },
  {
    name: "2. JingyangWorkflow_tryHandlePostback implementation exists",
    run() {
      assert(
        assistantContent.includes("function JingyangWorkflow_tryHandlePostback"),
        "JingyangAssistant.gs MUST define function JingyangWorkflow_tryHandlePostback"
      );
    }
  },
  {
    name: "3. handleLineReservationTextEvent implementation exists in reservation_workflow_handler.gs",
    run() {
      assert(
        reservationWorkflowHandlerGsContent.includes("function handleLineReservationTextEvent"),
        "reservation_workflow_handler.gs MUST define function handleLineReservationTextEvent"
      );
    }
  },
  {
    name: "4. handleLineReservationPostback implementation exists in reservation_workflow_handler.gs",
    run() {
      assert(
        reservationWorkflowHandlerGsContent.includes("function handleLineReservationPostback"),
        "reservation_workflow_handler.gs MUST define function handleLineReservationPostback"
      );
    }
  },
  {
    name: "5. JingyangAssistant_tryHandleLineEvent MUST NOT call JingyangWorkflow_tryHandleTextEvent to prevent duplicate execution",
    run() {
      const idxTryHandle = assistantContent.indexOf("function JingyangAssistant_tryHandleLineEvent");
      assert(idxTryHandle !== -1, "JingyangAssistant_tryHandleLineEvent MUST exist");

      const fnBody = assistantContent.slice(idxTryHandle, idxTryHandle + 500);

      const idxWorkflow = fnBody.indexOf("JingyangWorkflow_tryHandleTextEvent");
      assert(idxWorkflow === -1, "JingyangAssistant_tryHandleLineEvent MUST NOT call JingyangWorkflow_tryHandleTextEvent");
    }
  },
  {
    name: "6. line程式碼.gs doPost postback handler calls JingyangWorkflow_tryHandlePostback",
    run() {
      assert(
        lineMainContent.includes("JingyangWorkflow_tryHandlePostback"),
        "line程式碼.gs MUST wire JingyangWorkflow_tryHandlePostback inside postback event handler"
      );
    }
  },
  {
    name: "7. reservation_parser.gs supports Hash Map inventory catalog format",
    run() {
      const okRes = parseReservationText("美麗空間 STU-6101 2個 豪", { "STU-6101": 50 });
      assert.strictEqual(okRes.ok, true, "Hash Map catalog MUST validate valid stock");

      const failRes = parseReservationText("美麗空間 STU-6101 100個 豪", { "STU-6101": 50 });
      assert.strictEqual(failRes.ok, false, "Hash Map catalog MUST reject stock shortage");
      assert.strictEqual(failRes.errorCode, "INSUFFICIENT_STOCK");
    }
  },
  {
    name: "8. reservation_parser.gs fails closed with INVENTORY_CATALOG_UNAVAILABLE when inventoryCatalog is null or undefined",
    run() {
      const resNull = parseReservationText("美麗空間 STU-6101 2個 豪", null);
      assert.strictEqual(resNull.ok, false, "null catalog MUST return ok: false");
      assert.strictEqual(resNull.errorCode, "INVENTORY_CATALOG_UNAVAILABLE");

      const resUndef = parseReservationText("美麗空間 STU-6101 2個 豪", undefined);
      assert.strictEqual(resUndef.ok, false, "undefined catalog MUST return ok: false");
      assert.strictEqual(resUndef.errorCode, "INVENTORY_CATALOG_UNAVAILABLE");
    }
  },
  {
    name: "9. Does NOT alter legacy product search or customer reply logic",
    run() {
      assert(
        lineMainContent.includes("handleAssistantPostback_"),
        "Legacy handleAssistantPostback_ MUST be preserved"
      );
      assert(
        lineMainContent.includes("getLiveStockMap"),
        "Legacy getLiveStockMap MUST be preserved"
      );
      assert(
        assistantContent.includes("JingyangAssistant_parseCommand_"),
        "Legacy JingyangAssistant_parseCommand_ MUST be preserved"
      );
    }
  }
];

let passCount = 0;
let failCount = 0;

tests.forEach((t) => {
  try {
    t.run();
    console.log(`PASS line-workflow-router: ${t.name}`);
    passCount++;
  } catch (err) {
    console.error(`FAIL line-workflow-router: ${t.name}: ${err.message}`);
    failCount++;
  }
});

console.log(`\nLINE Workflow Router Simulation Summary: ${passCount} PASS / ${failCount} FAIL`);

if (failCount > 0) {
  process.exit(1);
}
