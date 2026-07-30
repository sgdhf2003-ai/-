# JYAI Allocation Assistant - Phase 5 (Option A+) UI Sandbox Integration & Demo Design Specification

**Document Version**: `v1.0.0`
**Date**: `2026-07-24`
**Status**: `PROPOSED_SPECIFICATION`
**Module**: `JYAI Allocation Assistant (Phase 5 UI Sandbox & Interactive Demo)`

---

## 1. Phase 5 Business Outcomes & Explicit Non-Goals

### 1.1 Business Outcomes
* Integrate a dedicated Allocation Assistant workspace view tab (`#view-allocation-sandbox`) into the Business Manager PWA navigation layout.
* Mount a high-visibility amber warning banner (`配貨建議試算 (唯讀沙盒模式)`) to eliminate any risk of sales clerks misinterpreting simulation outcomes as formal reservations.
* Wire up 3 built-in real-world demonstration preset cards (`EQA-6522`, `顧佳 575`, `艾美 336`) allowing one-click order text auto-fill and instant rule evaluation.
* Connect `AllocationUIState`, `AllocationGatewayClient`, and `MockSheetInventoryAdapter` inside the PWA client runtime environment.
* Validate zero side-effect sandboxing via comprehensive automated simulation test suites.

### 1.2 Explicit Non-Goals (Safety Boundaries)
* **NO Official Sheet Writes**: Confirming an allocation in the sandbox updates only local UI draft state (`ALLOCATION_CONFIRMED`). It does NOT write to Google Sheets (`SHEETS.holds`).
* **NO Automated LINE Notifications**: No LINE push or reply messages are dispatched.
* **NO Production Deployment**: Absolutely no `clasp push` or `clasp deploy` operations.

---

## 2. PWA Tab Mount Point & DOM Isolation Architecture

The Allocation Assistant Sandbox tab mounts inside the main Business Manager layout container (`#app-content`):

```html
<nav class="nav-bar">
  <button id="nav-tasks" class="nav-item">任務管理</button>
  <button id="nav-allocation" class="nav-item active">配貨助手 (沙盒)</button>
</nav>

<main id="app-content">
  <section id="view-allocation-sandbox" class="view-panel active">
    <!-- Amber Sandbox Banner -->
    <div class="sandbox-banner">
      <span class="sandbox-badge">試算沙盒</span>
      <span class="sandbox-title">配貨建議試算 (唯讀沙盒模式 - 零正式寫入)</span>
    </div>

    <!-- Demo Preset Cards Bar -->
    <div class="demo-presets-bar">
      <button class="btn-demo-preset" data-preset="1">範例一：單倉足量 (EQA-6522)</button>
      <button class="btn-demo-preset" data-preset="2">範例二：跨倉優先 (顧佳 575)</button>
      <button class="btn-demo-preset" data-preset="3">範例三：混批授權 (艾美 336)</button>
    </div>

    <!-- Input & Output Workspace -->
    <div class="allocation-workspace-container">
      ...
    </div>
  </section>
</main>
```

---

## 3. Yellow Sandbox Watermark & Warning Banner Specification

* **Visual Style**: Distinctive amber background (`background: #FFFBEB; border: 1px solid #FCD34D; color: #92400E;`).
* **Banner Header**:
  - Main Heading: `配貨建議試算 (唯讀沙盒模式)`
  - Subtext: `本功能處於影子試算沙盒環境，所有配貨建議與確認操作均不會寫入正式試算表或發送 LINE 通知。`
* **Card Watermarks**: Rendered suggestion detail cards display a watermark badge `SANDBOX_SIMULATION_ONLY`.

---

## 4. Built-in Real Demonstration Preset Cards

1. **Preset 1 (Single Warehouse Single Batch)**:
   - Input Text: `EQA-6522 * 10`
   - Expected Output: Single warehouse (`林口倉`), single batch (`7J25`), 10 PCS allocated, zero warnings.
2. **Preset 2 (Multi-warehouse Priority)**:
   - Input Text: `顧佳 575 * 15`
   - Expected Output: Prefers single warehouse with largest stock over multi-warehouse split when sufficient single batch is present.
3. **Preset 3 (Batch Mixing Consent Required)**:
   - Input Text: `艾美 336 * 20`
   - Expected Output: Emits `BATCH_MIXING_REQUIRED` warning alert block, renders un-checked consent toggle switch. Toggling switch immediately re-evaluates rules and renders multi-lot allocation suggestion cards.

---

## 5. Client Runtime Module Loading & Isolation

`AllocationAssistant` modules are exposed to PWA runtime scripts via isolated namespace scope:

```javascript
window.AllocationAssistantSDK = {
  AllocationUIState,
  AllocationGatewayClient,
  AllocationViewRenderer,
  MockSheetInventoryAdapter,
  SimulationProvider,
  AllocationGateway
};
```

* **Zero Global Mutation**: No modifications to global `Object.prototype` or existing PWA state variables (`window.state`).

---

## 6. Small Packs & Commit Boundaries

Phase 5 implementation follows 4 distinct TDD packs:

* **Small Pack 5A**: `feat(allocation-sandbox): add sandbox tab mount and warning banner architecture`
  - Mount `#view-allocation-sandbox` view container and amber warning banner in PWA layout.
* **Small Pack 5B**: `feat(allocation-sandbox): wireup readonly sheet inventory snapshot adapter`
  - Connect `MockSheetInventoryAdapter` and `AllocationGatewayClient` inside client runtime initializer.
* **Small Pack 5C**: `feat(allocation-sandbox): add interactive demo preset cards and feedback controls`
  - Implement 3 built-in demo preset auto-fill buttons and interactive feedback controls.
* **Small Pack 5D**: `test(allocation-sandbox): validate sandbox e2e regression and update handoff`
  - Add end-to-end sandbox simulation test `tests/simulations/allocation-sandbox-e2e.sim.js`.
  - Update `CHANGELOG.md`, `CURRENT_HANDOFF.md`, and `ROADMAP.md`.

---

## 7. Security & Permission Control Rules

* **Fail-Closed Isolation**: Attempting to invoke external network or backend write functions inside the sandbox view throws `FEATURE_DISABLED_IN_SANDBOX`.
* **Static Asset Boundaries**: All sandbox styles and markup reside exclusively within designated view templates.
