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
    name: "sandbox evaluation runs read-only calculation using DEMO_PRESETS without errors",
    run() {
      const { env } = createTestEnvironment();
      if (typeof env.evaluateAllocationSandbox !== "function") {
        throw new Error("evaluateAllocationSandbox is missing");
      }

      const result = env.evaluateAllocationSandbox("EQA-6522 * 10");
      assert(result && result.ok === true, "evaluateAllocationSandbox MUST return ok: true");
      assert(result.suggestions && result.suggestions.length > 0, "MUST return at least one suggestion for EQA-6522");
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
  }
]);
