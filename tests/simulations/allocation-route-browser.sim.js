"use strict";

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const repoRoot = path.join(__dirname, "../..");
const { runSuite } = require("./helpers");

const appJsPath = path.join(repoRoot, "app.js");
const appJsContent = fs.readFileSync(appJsPath, "utf8");
const indexHtmlPath = path.join(repoRoot, "index.html");
const indexHtmlContent = fs.readFileSync(indexHtmlPath, "utf8");

const vm = require("vm");

function createTestEnvironment(customView = null) {
  let toastMsg = null;
  const elements = {};

  const getOrCreateElement = (id) => {
    if (!elements[id]) {
      const classes = new Set();
      elements[id] = {
        id,
        classList: {
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c),
          toggle: (c, val) => { if (val) classes.add(c); else classes.delete(c); },
          contains: (c) => classes.has(c)
        },
        dataset: {},
        style: {},
        addEventListener: () => {},
        querySelector: (sel) => getOrCreateElement(sel.replace("#", "").replace(".", "")),
        querySelectorAll: () => []
      };
    }
    return elements[id];
  };

  const mockDocument = {
    querySelector: (sel) => {
      if (sel === "#view-allocation-sandbox") return getOrCreateElement("view-allocation-sandbox");
      if (sel === "#homeView") return getOrCreateElement("homeView");
      if (sel === "#storesView") return getOrCreateElement("storesView");
      if (sel === "#holdsView") return getOrCreateElement("holdsView");
      if (sel === "#projectsView") return getOrCreateElement("projectsView");
      if (sel === "#samplesView") return getOrCreateElement("samplesView");
      if (sel === "#complaintsView") return getOrCreateElement("complaintsView");
      if (sel === "#calculatorView") return getOrCreateElement("calculatorView");
      if (sel === "#salesReportView") return getOrCreateElement("salesReportView");
      if (sel === "#inventoryView") return getOrCreateElement("inventoryView");
      if (sel === "#adminView") return getOrCreateElement("adminView");
      if (sel === "#tasksView") return getOrCreateElement("tasksView");
      if (sel === "#viewTitle") return getOrCreateElement("viewTitle");
      return getOrCreateElement(sel.replace("#", "").replace(".", ""));
    },
    querySelectorAll: () => [],
    createElement: () => getOrCreateElement("div"),
    body: getOrCreateElement("body"),
    addEventListener: () => {}
  };

  const mockWindow = {
    document: mockDocument,
    navigator: { userAgent: "node", onLine: true },
    location: { href: "https://example.com", search: "" },
    localStorage: { getItem: (key) => key === "pendingInitialView" ? customView : null, setItem: () => {}, removeItem: () => {} },
    history: { pushState: () => {}, replaceState: () => {} },
    toast: (msg) => { toastMsg = msg; },
    scrollTo: () => {},
    setTimeout: (fn) => typeof fn === "function" ? fn() : 0,
    clearTimeout: () => {},
    FormData: class { get() { return ""; } },
    URLSearchParams: class { get() { return null; } },
    Element: class {},
    Event: class {},
    CustomEvent: class {},
    Date,
    Math,
    Number,
    String,
    JSON,
    Array,
    console
  };
  mockWindow.window = mockWindow;
  mockWindow.globalThis = mockWindow;

  const context = vm.createContext(mockWindow);
  vm.runInContext(appJsContent, context);

  return { env: context, mockWindow, getToast: () => toastMsg };
}

runSuite("allocation-route-browser", [
  {
    name: "allocation route exists in frontend route registry views and viewNames",
    run() {
      const { env } = createTestEnvironment();
      const views = env.views;
      const viewNames = env.viewNames;

      assert(views && views.allocation !== undefined, "views.allocation MUST be defined in app.js");
      assert(viewNames && viewNames.allocation === "配貨建議試算", "viewNames.allocation MUST be '配貨建議試算'");
    }
  },
  {
    name: "allocation view mount point exists in index.html DOM template",
    run() {
      assert(indexHtmlContent.includes('id="view-allocation-sandbox"'), "index.html MUST contain id='view-allocation-sandbox'");
      assert(indexHtmlContent.includes('data-view="allocation"'), "index.html MUST contain data-view='allocation'");
      assert(indexHtmlContent.includes('id="sandboxEvalBtn"'), "index.html MUST contain id='sandboxEvalBtn'");
    }
  },
  {
    name: "開啟沙盒 or data-view='allocation' navigates to allocation view without '找不到這個頁面' toast error",
    run() {
      const { env, getToast } = createTestEnvironment();
      if (typeof env.setView !== "function") {
        throw new Error("setView is not defined");
      }

      env.setView("allocation");

      assert(getToast() !== "找不到這個頁面", "setView('allocation') MUST NOT show '找不到這個頁面' toast");
      assert.strictEqual(env.state.activeView, "allocation", "activeView MUST be 'allocation'");
    }
  },
  {
    name: "normalizeInitialView allows allocation view",
    run() {
      const { env } = createTestEnvironment();
      if (typeof env.normalizeInitialView !== "function") {
        throw new Error("normalizeInitialView is not defined");
      }

      const res = env.normalizeInitialView("allocation");
      assert.strictEqual(res, "allocation", "normalizeInitialView('allocation') MUST return 'allocation'");
    }
  },
  {
    name: "sandbox evaluation uses 115 inventory sheet snapshot, separates customerName and productCode, and restricts warehouses to 林口倉/忠義倉",
    run() {
      const { env } = createTestEnvironment();
      if (typeof env.evaluateAllocationSandbox !== "function") {
        throw new Error("evaluateAllocationSandbox is missing");
      }

      // 1. Scenario 1 (APT-5201 * 10)
      const res1 = env.evaluateAllocationSandbox("漢樺企業 APT-5201 * 10");
      assert.strictEqual(res1.ok, true);
      assert.strictEqual(res1.customerName, "漢樺企業", "customerName MUST be '漢樺企業'");
      assert.strictEqual(res1.productCode, "APT-5201", "productCode MUST be 'APT-5201'");
      assert.strictEqual(res1.status, "ALLOCATION_CONFIRMED");
      assert.strictEqual(res1.suggestions.length, 1);
      assert.strictEqual(res1.suggestions[0].warehouseName, "林口倉");
      assert.strictEqual(res1.suggestions[0].allocatedQuantity, 10);

      // 2. Scenario 2 Unchecked (STU-6101 * 3) -> ALLOCATION_REVIEW & BATCH_MIXING_REQUIRED
      const res2a = env.evaluateAllocationSandbox("美麗空間 STU-6101 * 3", { customerApprovedMixedBatch: false });
      assert.strictEqual(res2a.ok, true);
      assert.strictEqual(res2a.customerName, "美麗空間");
      assert.strictEqual(res2a.productCode, "STU-6101");
      assert.strictEqual(res2a.status, "ALLOCATION_REVIEW");
      assert.ok(res2a.warnings.some(w => w.warningCode === "BATCH_MIXING_REQUIRED"));
      assert.strictEqual(res2a.suggestions.length, 0, "Unchecked mixed batch MUST NOT output suggestions");

      // 3. Scenario 2 Checked (STU-6101 * 3) -> ALLOCATION_CONFIRMED with split 林口倉 (2 PCS) + 忠義倉 (1 PCS)
      const res2b = env.evaluateAllocationSandbox("美麗空間 STU-6101 * 3", { customerApprovedMixedBatch: true });
      assert.strictEqual(res2b.ok, true);
      assert.strictEqual(res2b.status, "ALLOCATION_CONFIRMED");
      assert.strictEqual(res2b.suggestions.length, 2, "MUST split across 林口倉 and 忠義倉");
      assert.strictEqual(res2b.suggestions[0].warehouseName, "林口倉");
      assert.strictEqual(res2b.suggestions[0].allocatedQuantity, 2);
      assert.strictEqual(res2b.suggestions[1].warehouseName, "忠義倉");
      assert.strictEqual(res2b.suggestions[1].allocatedQuantity, 1);
      const totalAllocated = res2b.suggestions.reduce((sum, s) => sum + s.allocatedQuantity, 0);
      assert.strictEqual(totalAllocated, 3, "Total allocated MUST equal requested quantity 3");

      // 4. Scenario 3 (SHN-6101F ?? 20) -> OCR_REVIEW
      const res3 = env.evaluateAllocationSandbox("艾美磁磚 SHN-6101F ?? 20");
      assert.strictEqual(res3.ok, true);
      assert.strictEqual(res3.customerName, "艾美磁磚");
      assert.strictEqual(res3.productCode, "SHN-6101F");
      assert.strictEqual(res3.status, "OCR_REVIEW");
      assert.ok(res3.warnings.some(w => w.warningCode === "LOW_OCR_CONFIDENCE"));
      assert.strictEqual(res3.suggestions.length, 0, "OCR_REVIEW MUST NOT output automatic suggestions");

      // 5. Verify warehouse restrictions (No 五股倉 or 汐止倉)
      [res1, res2b].forEach((r) => {
        (r.suggestions || []).forEach((s) => {
          assert(["林口倉", "忠義倉"].includes(s.warehouseName), `Warehouse '${s.warehouseName}' MUST be 林口倉 or 忠義倉`);
        });
      });
    }
  },
  {
    name: "formal write inside sandbox is rejected with SANDBOX_WRITE_FORBIDDEN",
    run() {
      const { env } = createTestEnvironment();
      if (typeof env.executeSandboxFormalWrite !== "function") {
        throw new Error("executeSandboxFormalWrite is missing");
      }

      assert.throws(() => {
        env.executeSandboxFormalWrite({ reservationNumber: "RES-TEST" });
      }, /SANDBOX_WRITE_FORBIDDEN/);
    }
  },
  {
    name: "allocation view is an independent root view in index.html and NOT nested inside adminView",
    run() {
      const adminPos = indexHtmlContent.indexOf('id="adminView"');
      const sandboxPos = indexHtmlContent.indexOf('id="view-allocation-sandbox"');
      assert(adminPos !== -1, "adminView MUST exist in index.html");
      assert(sandboxPos !== -1, "view-allocation-sandbox MUST exist in index.html");

      const substringBetween = indexHtmlContent.substring(adminPos, sandboxPos);
      const openSections = (substringBetween.match(/<section/g) || []).length;
      const closeSections = (substringBetween.match(/<\/section>/g) || []).length;

      assert.strictEqual(closeSections, openSections, "adminView and all inner panels MUST be fully closed before view-allocation-sandbox starts");
      assert(substringBetween.includes("</div>") && substringBetween.includes("</section>"), "adminView MUST be closed with </div></section> before sandbox section");
    }
  }
]);
