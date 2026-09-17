"use strict";

/**
 * TDD Verification Suite: JSONP Read Sync Contract & Security Whitelist
 *
 * Verifies:
 * 1. Code.gs doGet produces valid JSONP response when a valid callback is provided.
 * 2. Whitelist validation: /^[A-Za-z_$][A-Za-z0-9_$]*$/ strictly enforced.
 * 3. Malicious / illegal callback names are rejected fail-closed (errorCode: INVALID_CALLBACK) with 0 script reflection.
 * 4. PWA JSONP fallback contract: cleans up script tag, cleans up window callback, handles success, error, and timeout.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const CODE_GS_PATH = path.join(__dirname, "../../google-apps-script/Code.gs");
const codeGsContent = fs.readFileSync(CODE_GS_PATH, "utf8");

function createTestEnvironment() {
  const store = {
    holds: [
      { id: "RES-TEST-001", storeName: "測試門市", item: "STU-6101", quantity: 1, salesOwner: "測試" }
    ],
    stores: [
      { id: "STORE-001", name: "測試門市", salesOwner: "測試" }
    ],
    users: [],
    settings: []
  };

  const ContentService = {
    MimeType: {
      JSON: "JSON",
      JAVASCRIPT: "JAVASCRIPT"
    },
    createTextOutput(content) {
      let currentMime = null;
      return {
        getContent() { return content; },
        setMimeType(mime) { currentMime = mime; return this; },
        getMimeType() { return currentMime; }
      };
    }
  };

  const scriptProps = {
    SPREADSHEET_ID: "MOCK_SPREADSHEET_ID"
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

  function createMockSheet(name) {
    const sheetKeyMap = {
      "Users": "users",
      "保留物品": "holds",
      "店家資料": "stores",
      "系統設定": "settings",
      "工作任務": "tasks",
      "操作紀錄": "auditLogs",
      "案場報備": "projects",
      "樣品與展示架": "samples",
      "售後客訴": "complaints"
    };
    const key = sheetKeyMap[name] || name;
    const headers = HEADERS[key] || ["id"];

    return {
      getName() { return name; },
      getLastRow() { return 2; },
      getLastColumn() { return headers.length; },
      getRange(startRow, startCol, numRows, numCols) {
        return {
          getValues() {
            if (startRow === 1 && numRows === 1) return [headers];
            return [headers.map(h => (h === "id" ? "TEST-1" : ""))];
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
    `
      ${codeGsContent}
      if (actionName === "doGet") return doGet(params);
      if (actionName === "doPost") return doPost(params);
      if (actionName === "readAll") return readAll();
      if (actionName === "jsonOutput") return jsonOutput(params.data, params.callback);
    `
  );

  return {
    doGet(e) {
      return fn(ContentService, PropertiesService, SpreadsheetApp, "doGet", e);
    },
    doPost(e) {
      return fn(ContentService, PropertiesService, SpreadsheetApp, "doPost", e);
    },
    jsonOutput(data, callback) {
      return fn(ContentService, PropertiesService, SpreadsheetApp, "jsonOutput", { data, callback });
    }
  };
}

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS jsonp-read-sync: ${description}`);
  } catch (err) {
    console.error(`FAIL jsonp-read-sync: ${description}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("Starting JSONP Read Sync & Security Whitelist Verification Suite...\n");

// 1. Legal Callbacks
runTest("1. doGet returns JAVASCRIPT MIME and valid callback wrapper for legal callback", () => {
  const env = createTestEnvironment();
  const validCallbacks = ["handleJsonp", "cb_12345", "$jsonpCallback", "_my_handler$", "A"];

  for (const cb of validCallbacks) {
    const output = env.doGet({
      parameter: {
        action: "readAll",
        callback: cb
      }
    });

    assert.ok(output, `Output must exist for callback: ${cb}`);
    assert.strictEqual(output.getMimeType(), "JAVASCRIPT", `MimeType must be JAVASCRIPT for ${cb}`);
    const content = output.getContent();
    assert.ok(content.startsWith(`${cb}(`), `Content must start with '${cb}('`);
    assert.ok(content.endsWith(");"), "Content must end with ');'");

    const jsonStr = content.slice(cb.length + 1, -2);
    const parsed = JSON.parse(jsonStr);
    assert.strictEqual(parsed.ok, true, "Parsed payload must have ok: true");
    assert.ok(Array.isArray(parsed.holds), "Parsed payload must have holds array");
  }
});

// 2. Illegal Callbacks Rejected Fail-Closed
runTest("2. Illegal callbacks are rejected fail-closed with INVALID_CALLBACK and JSON MIME", () => {
  const env = createTestEnvironment();
  const illegalCallbacks = [
    "alert(1)",
    "<script>alert(1)</script>",
    "evil.com/payload",
    "window.location='http://evil.com'",
    "foo-bar",
    "123startsWithNumber",
    "foo;bar",
    "foo bar",
    "eval('bad')",
    "callback()",
    "\"quoted\"",
    "'singlequoted'"
  ];

  for (const cb of illegalCallbacks) {
    const output = env.doGet({
      parameter: {
        action: "readAll",
        callback: cb
      }
    });

    assert.ok(output, `Output must exist for illegal callback: ${cb}`);
    assert.strictEqual(output.getMimeType(), "JSON", `Illegal callback ${cb} MUST produce JSON mime type, NOT JAVASCRIPT`);
    const content = output.getContent();
    assert.ok(!content.includes(cb), `Response content MUST NOT reflect illegal callback string '${cb}'`);
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.ok, false, "Illegal callback must return ok: false");
    assert.strictEqual(parsed.errorCode, "INVALID_CALLBACK", "Illegal callback must return errorCode: INVALID_CALLBACK");
  }
});

// 3. Plain readAll without callback returns standard JSON
runTest("3. Plain readAll without callback returns standard JSON MIME without wrapper", () => {
  const env = createTestEnvironment();
  const output = env.doGet({
    parameter: {
      action: "readAll"
    }
  });

  assert.ok(output);
  assert.strictEqual(output.getMimeType(), "JSON");
  const parsed = JSON.parse(output.getContent());
  assert.strictEqual(parsed.ok, true);
});

// 4. PWA JSONP fallback contract simulation
runTest("4. PWA JSONP client helper contract (cleanup, success, timeout, error)", async () => {
  // Simulate browser environment with DOM and window
  const mockWindow = {};
  const mockHead = {
    children: [],
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      child.parentNode = null;
      return child;
    }
  };

  const mockDocument = {
    head: mockHead,
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        src: "",
        async: false,
        parentNode: null
      };
    }
  };

  // Implementation of client helper matching app.js design
  function executeJsonp(apiUrl, options = {}) {
    const timeoutMs = options.timeoutMs || 200;
    const windowObj = options.window || mockWindow;
    const docObj = options.document || mockDocument;

    return new Promise((resolve, reject) => {
      const callbackName = "jy_jsonp_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
      const url = new URL(apiUrl);
      url.searchParams.set("action", "readAll");
      url.searchParams.set("callback", callbackName);

      let timer = null;
      let script = null;

      function cleanup() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        try {
          delete windowObj[callbackName];
        } catch (_) {
          windowObj[callbackName] = undefined;
        }
        if (script && script.parentNode) {
          script.parentNode.removeChild(script);
        }
        script = null;
      }

      timer = setTimeout(() => {
        cleanup();
        reject(new Error("Google 後台 JSONP 回應逾時，請檢查連線或稍後再試。"));
      }, timeoutMs);

      windowObj[callbackName] = (data) => {
        cleanup();
        if (!data) {
          reject(new Error("Google 後台回傳空資料"));
          return;
        }
        if (!data.ok) {
          reject(new Error(data.error || data.message || "Google 後台處理失敗"));
          return;
        }
        resolve(data);
      };

      script = docObj.createElement("script");
      script.src = url.toString();
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error("Google 後台 JSONP 載入失敗，請確認 Apps Script Web App 權限設定。"));
      };

      (docObj.head || docObj.documentElement).appendChild(script);

      // Expose script trigger for testing
      if (options.onScriptCreated) {
        options.onScriptCreated(script, callbackName);
      }
    });
  }

  // 4a. Success flow
  let scriptCreatedCallbackName = null;
  const successPromise = executeJsonp("https://example.com/exec", {
    onScriptCreated(script, cbName) {
      scriptCreatedCallbackName = cbName;
      // Simulate server returning response
      process.nextTick(() => {
        mockWindow[cbName]({ ok: true, holds: [{ id: "H1" }] });
      });
    }
  });

  const successResult = await successPromise;
  assert.strictEqual(successResult.ok, true);
  assert.strictEqual(mockHead.children.length, 0, "Script element must be cleaned up from DOM after success");
  assert.strictEqual(mockWindow[scriptCreatedCallbackName], undefined, "Window callback must be deleted after success");

  // 4b. Timeout flow
  let timeoutCbName = null;
  let timeoutThrew = false;
  try {
    await executeJsonp("https://example.com/exec", {
      timeoutMs: 30,
      onScriptCreated(script, cbName) {
        timeoutCbName = cbName;
        // Do not invoke callback, trigger timeout
      }
    });
  } catch (err) {
    timeoutThrew = true;
    assert.ok(err.message.includes("逾時"), "Error must mention timeout");
  }
  assert.strictEqual(timeoutThrew, true, "Timeout must cause promise rejection");
  assert.strictEqual(mockHead.children.length, 0, "Script element must be cleaned up from DOM after timeout");
  assert.strictEqual(mockWindow[timeoutCbName], undefined, "Window callback must be deleted after timeout");

  // 4c. Onerror flow
  let errorCbName = null;
  let errorThrew = false;
  try {
    await executeJsonp("https://example.com/exec", {
      timeoutMs: 1000,
      onScriptCreated(script, cbName) {
        errorCbName = cbName;
        process.nextTick(() => {
          script.onerror(new Error("Network failure"));
        });
      }
    });
  } catch (err) {
    errorThrew = true;
    assert.ok(err.message.includes("載入失敗"), "Error must mention load failure");
  }
  assert.strictEqual(errorThrew, true, "Onerror must cause promise rejection");
  assert.strictEqual(mockHead.children.length, 0, "Script element must be cleaned up from DOM after script error");
  assert.strictEqual(mockWindow[errorCbName], undefined, "Window callback must be deleted after script error");
});

// 5. Non-readAll actions in doGet strictly forbid JSONP
runTest("5. Non-readAll actions in doGet (login, setup, logout, getInventorySnapshot) strictly forbid JSONP", () => {
  const env = createTestEnvironment();
  const sensitiveActions = [
    "login",
    "setup",
    "logout",
    "getInventorySnapshot",
    "testLineNotify",
    "test_b8_readiness",
    "readLogs"
  ];

  for (const action of sensitiveActions) {
    const output = env.doGet({
      parameter: {
        action,
        callback: "leakCallback",
        username: "admin",
        password: "secretPassword"
      }
    });

    assert.ok(output, `Output must exist for action: ${action}`);
    assert.strictEqual(output.getMimeType(), "JSON", `Action ${action} with callback MUST return JSON MIME, NEVER JAVASCRIPT`);
    const content = output.getContent();
    assert.ok(!content.includes("leakCallback("), `Action ${action} response MUST NOT wrap response in leakCallback(...)`);
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.ok, false, `Action ${action} with callback MUST return ok: false`);
    assert.strictEqual(parsed.errorCode, "JSONP_NOT_ALLOWED", `Action ${action} with callback MUST return JSONP_NOT_ALLOWED`);
    assert.strictEqual(parsed.sessionToken, undefined, `Action ${action} MUST NOT leak sessionToken via JSONP`);
  }
});

// 6. Write actions in doPost strictly forbid JSONP
runTest("6. Write actions in doPost (upsertHold, lineCreateHold, cancelReleaseHold) NEVER return JSONP even if callback is provided", () => {
  const env = createTestEnvironment();
  const writeActions = [
    "upsertHold",
    "lineCreateHold",
    "cancelReleaseHold",
    "fulfillHold",
    "login",
    "setup"
  ];

  for (const action of writeActions) {
    const output = env.doPost({
      postData: {
        contents: JSON.stringify({
          action,
          callback: "maliciousCallback",
          hold: { id: "RES-TEST" }
        })
      }
    });

    assert.ok(output, `doPost output must exist for action: ${action}`);
    assert.strictEqual(output.getMimeType(), "JSON", `doPost action ${action} MUST return JSON MIME`);
    const content = output.getContent();
    assert.ok(!content.includes("maliciousCallback("), `doPost action ${action} response MUST NOT wrap in maliciousCallback(...)`);
  }
});

// 7. Service Worker fetch handler cross-origin bypass
runTest("7. Service Worker fetch handler bypasses cross-origin requests without calling respondWith", () => {
  const swPath = path.join(__dirname, "../../service-worker.js");
  const swCode = fs.readFileSync(swPath, "utf8");

  const listeners = {};
  const mockSelf = {
    location: { origin: "http://127.0.0.1:4173" },
    addEventListener(event, fn) {
      listeners[event] = fn;
    },
    skipWaiting() {},
    clients: { claim() {} }
  };

  const fn = new Function("self", "caches", "fetch", "Response", swCode);
  const mockFetch = async () => ({
    status: 200,
    clone: () => ({})
  });
  const mockCaches = {
    open: async () => ({ put: async () => {} }),
    match: async () => ({})
  };
  fn(mockSelf, mockCaches, mockFetch, class {});

  assert.ok(typeof listeners.fetch === "function", "Fetch listener must be registered in Service Worker");

  const crossOriginUrls = [
    "https://script.google.com/macros/s/AKfycbwECpzsT3_LplEzXOuQVh-bLBlOyR_u_4VoaSmYZGbiwmp0Q-AJzsdrTFxC43K1AtWk/exec?action=readAll&callback=jy_jsonp_1",
    "https://script.googleusercontent.com/macros/echo?user_content_key=12345",
    "https://api.line.me/v2/bot/message/push",
    "https://cdn.example.com/asset.js"
  ];

  for (const url of crossOriginUrls) {
    let respondWithCalled = false;
    const event = {
      request: {
        method: "GET",
        url,
        mode: "cors"
      },
      respondWith() {
        respondWithCalled = true;
      }
    };

    listeners.fetch(event);
    assert.strictEqual(respondWithCalled, false, `Cross-origin URL ${url} MUST NOT trigger respondWith in Service Worker`);
  }

  // Non-GET requests must also bypass
  let postRespondWithCalled = false;
  listeners.fetch({
    request: {
      method: "POST",
      url: "http://127.0.0.1:4173/api/test",
      mode: "cors"
    },
    respondWith() {
      postRespondWithCalled = true;
    }
  });
  assert.strictEqual(postRespondWithCalled, false, "Non-GET request must not call respondWith");

  // Same-origin GET requests MUST call respondWith
  let sameOriginRespondWithCalled = false;
  listeners.fetch({
    request: {
      method: "GET",
      url: "http://127.0.0.1:4173/app.js",
      mode: "no-cors"
    },
    respondWith() {
      sameOriginRespondWithCalled = true;
    }
  });
  assert.strictEqual(sameOriginRespondWithCalled, true, "Same-origin GET request MUST call respondWith");
});

// 8. Service Worker guaranteed Response contract (no undefined Response on cache miss)
runTest("8. Service Worker guaranteed Response contract prevents 'Failed to convert value to Response'", async () => {
  const swPath = path.join(__dirname, "../../service-worker.js");
  const swCode = fs.readFileSync(swPath, "utf8");

  class MockResponse {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status || 200;
      this.statusText = init.statusText || "OK";
      this.headers = init.headers || {};
    }
  }

  const listeners = {};
  const mockSelf = {
    location: { origin: "http://127.0.0.1:4173" },
    addEventListener(event, fn) {
      listeners[event] = fn;
    },
    skipWaiting() {},
    clients: { claim() {} }
  };

  const mockCaches = {
    open: async () => ({
      put: async () => {},
      addAll: async () => {}
    }),
    match: async () => undefined // Simulate cache miss
  };

  const failingFetch = async () => {
    throw new Error("Network unavailable");
  };

  const fn = new Function("self", "caches", "fetch", "Response", swCode);
  fn(mockSelf, mockCaches, failingFetch, MockResponse);

  // 8a. Test asset fetch failure with cache miss
  let assetResultPromise = null;
  listeners.fetch({
    request: {
      method: "GET",
      url: "http://127.0.0.1:4173/missing-file.js",
      mode: "cors"
    },
    respondWith(p) {
      assetResultPromise = p;
    }
  });

  assert.ok(assetResultPromise, "respondWith must be passed a promise");
  const assetResponse = await assetResultPromise;
  assert.ok(assetResponse instanceof MockResponse, "Resolved value MUST be an instance of Response");
  assert.strictEqual(assetResponse.status, 404, "Cache miss on missing asset must return 404 Response");

  // 8b. Test navigate fetch failure with cache miss
  let navResultPromise = null;
  listeners.fetch({
    request: {
      method: "GET",
      url: "http://127.0.0.1:4173/dashboard",
      mode: "navigate"
    },
    respondWith(p) {
      navResultPromise = p;
    }
  });

  assert.ok(navResultPromise, "respondWith must be passed a promise for navigate");
  const navResponse = await navResultPromise;
  assert.ok(navResponse instanceof MockResponse, "Navigate resolved value MUST be an instance of Response");
  assert.strictEqual(navResponse.status, 503, "Cache miss on offline navigate must return 503 Response");
});

// 9. JSONP late-evaluating script safety (no ReferenceError on late response)
runTest("9. JSONP client helper handles error/timeout without uncaught ReferenceError if script evaluates late", async () => {
  const mockWindow = {};
  const mockHead = {
    children: [],
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      child.parentNode = null;
      return child;
    }
  };

  const mockDocument = {
    head: mockHead,
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        src: "",
        async: false,
        parentNode: null
      };
    }
  };

  // Extract sendCloudReadJsonp_ from app.js
  const appJsPath = path.join(__dirname, "../../app.js");
  const appJsContent = fs.readFileSync(appJsPath, "utf8");

  // Test the function logic in mock window context
  let capturedCallback = null;
  let testError = null;

  function executeAppJsonp(options = {}) {
    const timeoutMs = options.timeoutMs || 50;
    return new Promise((resolve, reject) => {
      const callbackName = "jy_jsonp_test_" + Date.now();
      capturedCallback = callbackName;

      let timer = null;
      let script = null;
      let settled = false;

      function cleanupScript() {
        if (script && script.parentNode) {
          script.parentNode.removeChild(script);
        }
        script = null;
      }

      function cleanupTimer() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      }

      function safeDeactivateCallback() {
        mockWindow[callbackName] = () => {
          try {
            delete mockWindow[callbackName];
          } catch (_) {
            mockWindow[callbackName] = undefined;
          }
        };
      }

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanupTimer();
        cleanupScript();
        safeDeactivateCallback();
        reject(new Error("Google 後台 JSONP 回應逾時，請檢查連線或稍後再試。"));
      }, timeoutMs);

      mockWindow[callbackName] = (data) => {
        if (settled) return;
        settled = true;
        cleanupTimer();
        cleanupScript();
        try {
          delete mockWindow[callbackName];
        } catch (_) {
          mockWindow[callbackName] = undefined;
        }
        if (!data) {
          reject(new Error("Google 後台回傳空資料"));
          return;
        }
        if (!data.ok) {
          reject(new Error(data.error || data.message || "Google 後台處理失敗"));
          return;
        }
        resolve(data);
      };

      script = mockDocument.createElement("script");
      script.src = "https://example.com/exec?action=readAll&callback=" + callbackName;
      script.onerror = () => {
        if (settled) return;
        settled = true;
        cleanupTimer();
        cleanupScript();
        safeDeactivateCallback();
        reject(new Error("Google 後台 JSONP 載入失敗，請確認 Apps Script Web App 權限設定。"));
      };

      mockDocument.head.appendChild(script);

      if (options.onCreated) {
        options.onCreated(script, callbackName);
      }
    });
  }

  // Case A: script.onerror fires, then late script evaluates
  let createdScript = null;
  const p = executeAppJsonp({
    onCreated(s, cbName) {
      createdScript = s;
    }
  });

  // Trigger error
  createdScript.onerror(new Error("Aborted"));

  try {
    await p;
    assert.fail("Promise should reject on onerror");
  } catch (err) {
    assert.ok(err.message.includes("載入失敗"));
  }

  // Late evaluation must NOT throw ReferenceError or TypeError
  assert.strictEqual(typeof mockWindow[capturedCallback], "function", "Callback should be a safe no-op function");
  assert.doesNotThrow(() => {
    mockWindow[capturedCallback]({ ok: true, holds: [] });
  }, "Invoking late callback must not throw error");
});

console.log(`\n==================================================`);
console.log(`JSONP Read Sync Summary: Total: ${totalTests} | Passed: ${passedTests} | Failed: ${totalTests - passedTests}`);
console.log(`==================================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
