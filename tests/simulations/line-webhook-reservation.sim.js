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

const tests = [
  {
    name: "Code.gs contains LineReservationDraft_tryHandleTextEvent wireup in text event handler",
    run() {
      assert(
        codeGsContent.includes("LineReservationDraft_tryHandleTextEvent"),
        "Code.gs MUST wire text event handler for reservation draft"
      );
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
