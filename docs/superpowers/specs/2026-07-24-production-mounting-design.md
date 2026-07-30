# JYAI Allocation Assistant - Phase 6 Production Mounting & Apps Script Rollout Design Specification

**Document Version**: `v1.0.0`
**Date**: `2026-07-24`
**Status**: `PROPOSED_SPECIFICATION`
**Module**: `JYAI Allocation Assistant (Phase 6 Production Mounting & Apps Script Wireup)`

---

## 1. Business Outcomes & Explicit Non-Goals

### 1.1 Business Outcomes
* Mount the Allocation Assistant Sandbox UI into the production Google Apps Script backend (`google-apps-script/Code.gs` and `google-apps-script/Index.html`).
* Serve the allocation sandbox view directly within the Business Manager Web App, enabling sales clerks to run real-time stock allocation recommendations on live Google Sheet inventory data.
* Enforce 100% read-only isolation where all calculation requests query spreadsheet snapshots but strictly reject formal reservation mutations.
* Verify Apps Script deployment compatibility via `deploy.py backend --check` dry-runs and automated simulation regression suites.

### 1.2 Explicit Non-Goals (Safety Boundaries)
* **NO Official Sheet Writes**: Formal hold rows (`SHEETS.holds`) are never created, updated, or deleted.
* **NO Automated LINE Push Notifications**: No reply or push API requests are issued to LINE endpoints.
* **NO Un-sandboxed Execution**: `SANDBOX_WRITE_FORBIDDEN` fail-closed protection remains active across all sandbox interaction paths.

---

## 2. Apps Script `Code.gs` Mounting Architecture

The Allocation Assistant integrates into `google-apps-script/Code.gs` via standard Apps Script HTML service templates:

```javascript
/**
 * Serves the Business Manager PWA Web App with mounted Allocation Assistant Sandbox view.
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('勁揚業務管家 (配貨試算沙盒)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Apps Script HTML include helper.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Read-only inventory snapshot lookup API for Apps Script Web App clients.
 */
function getReadOnlyInventorySnapshot(productCode) {
  if (!productCode) {
    throw new Error('INVALID_PRODUCT_CODE: productCode is required');
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('現有庫存表');
  const rows = sheet.getDataRange().getValues();
  return mapSheetRowsToInventorySnapshot(productCode, rows);
}
```

---

## 3. Frontend HTML Tab Mounting & Bundle Wireup

The Allocation Assistant Sandbox view template (`google-apps-script/AllocationAssistantView.html`) mounts inside `Index.html`:

```html
<!-- Navigation Bar Integration -->
<nav class="nav-bar">
  <button id="nav-tasks" class="nav-item">任務管理</button>
  <button id="nav-allocation" class="nav-item active">配貨試算 (沙盒)</button>
</nav>

<!-- View Container Integration -->
<main id="app-content">
  <section id="view-allocation-sandbox" class="view-panel active">
    <?!= include('AllocationAssistantView'); ?>
  </section>
</main>
```

---

## 4. Fail-Closed Security & Write Protection

* **Sandbox Write Guard**: Calling any write method in Apps Script context returns error `{ success: false, errorCode: 'SANDBOX_WRITE_FORBIDDEN' }`.
* **Credential Isolation**: Web App endpoints never access or output LINE Bot channel secret or Google API private keys.

---

## 5. Small Packs & Commit Boundaries

Phase 6 implementation is structured into 3 distinct Small Packs:

* **Small Pack 6A**: `feat(allocation-mount): mount sandbox view in google-apps-script Code.gs and html templates`
  - Add `AllocationAssistantView.html` template and update `Code.gs` and `Index.html` mount points.
* **Small Pack 6B**: `feat(allocation-mount): staging clasp push and web app read-only snapshot validation`
  - Wire up `getReadOnlyInventorySnapshot()` helper and validate staging Web App rendering.
* **Small Pack 6C**: `test(allocation-mount): validate production readiness and update handoff`
  - Run full simulation suite (131/131 PASS) and dry-run deployment checks (`deploy.py`).
  - Update `CHANGELOG.md`, `CURRENT_HANDOFF.md`, and `ROADMAP.md`.

---

## 6. Static Security & Audit Rules

* All modified files must pass static security grep scan for forbidden write/push calls before commit.
* Deployment dry-runs via `deploy.py backend --check` must return Exit Code 0.
