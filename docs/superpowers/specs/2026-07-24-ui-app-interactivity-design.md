# JYAI Allocation Assistant - Phase 3 UI & App Interactivity Specification

**Document Version**: `v1.0.0`
**Date**: `2026-07-24`
**Status**: `PROPOSED_SPECIFICATION`
**Module**: `JYAI Allocation Assistant (JYAI 配貨助手 - Phase 3 UI)`

---

## 1. Phase 3 Business Outcomes & Explicit Non-Goals

### 1.1 Business Outcomes
* Design and specify the dedicated Allocation Assistant workspace view (`#view-allocation-assistant`) integrated cleanly into the Business Manager PWA.
* Establish a deterministic frontend UI state machine governing draft progression from raw text OCR input to draft confirmation.
* Define `AllocationAssistantClient`, a client-side wrapper orchestrating interaction between UI components and `AllocationGateway`.
* Specify rich interactive controls (suggestion detail cards, warning banners, batch mixing consent toggle, draft lock controls).
* Validate UI state transitions and user workflows via client-side simulation harnesses.

### 1.2 Explicit Non-Goals (Safety Boundaries)
* **NO Sheet Mutation**: Confirming an allocation in Phase 3 updates only local UI draft state (`ALLOCATION_CONFIRMED`). It does NOT write to Google Sheets (`SHEETS.holds`).
* **NO LINE Communication**: No LINE push or reply messages are sent upon confirmation.
* **NO Production Deployment**: Absolutely no `clasp push` or `clasp deploy` operations.
* **NO Unapproved Core App Refactoring**: PWA navigation and unrelated view modules remain completely untouched.

---

## 2. UI Isolated View Architecture

The Allocation Assistant operates inside an isolated view container (`#view-allocation-assistant`):

```
+-----------------------------------------------------------------------+
|  JYAI Allocation Assistant (配貨助手)               [ Tenant: JY-001 ]  |
+-----------------------------------------------------------------------+
| [ Input Section ]                                                     |
| Raw Order Text / OCR Input:                                           |
| +-------------------------------------------------------------------+ |
| | EQA-6522 * 10                                                     | |
| +-------------------------------------------------------------------+ |
| [Analyze Allocation] Button                                           |
+-----------------------------------------------------------------------+
| [ State Banner: ALLOCATION_REVIEW ]                                   |
| [ Warning Banner: BATCH_MIXING_REQUIRED (if applicable) ]             |
| Toggle: [ ] Customer Approved Mixed Batch                             |
+-----------------------------------------------------------------------+
| [ Suggestion Detail Cards ]                                           |
| Card 1: Product: EQA-6522 | Warehouse: 林口倉 | Batch: 7J25 | Qty: 10   |
+-----------------------------------------------------------------------+
| [ Action Controls ]                                                   |
| [ Confirm Allocation ] (Locks Draft)   [ Cancel Draft ]               |
+-----------------------------------------------------------------------+
```

---

## 3. Frontend State Machine & Lifecycle Transitions

```
 [ Idle / New ]
       │
       ▼ (User enters text & clicks Analyze)
    [ DRAFT ] ──(Confidence < 0.85)──► [ OCR_REVIEW ] (Manual Correction)
       │                                     │
       └──────────────┬──────────────────────┘
                      ▼
            [ ALLOCATION_REVIEW ]
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
[ ALLOCATION_CONFIRMED ]       [ CANCELLED ]
  (Draft Locked Locally)       (Draft Discarded)
```

1. **`IDLE`**: Initial state before user input.
2. **`DRAFT`**: Raw order text entered; draft object instantiated.
3. **`OCR_REVIEW`**: OCR confidence is below 0.85. User must review and confirm parsed product code and quantity manually.
4. **`ALLOCATION_REVIEW`**: Allocation rules evaluated; suggestion detail cards and warnings rendered.
5. **`ALLOCATION_CONFIRMED`**: User clicks "Confirm Allocation". Draft state is locked locally.
6. **`CANCELLED`**: User clicks "Cancel Draft". Draft is reset to IDLE.

---

## 4. Client-to-Gateway Interface Contract (`AllocationAssistantClient`)

The client wrapper mediates UI events and Gateway invocations:

```javascript
class AllocationAssistantClient {
  constructor(gateway) {
    this.gateway = gateway;
    this.currentDraftId = null;
    this.state = 'IDLE';
  }

  async submitRawOrderText(rawText) { /* Calls gateway.createDraft & analyzeAllocation */ }
  async toggleMixedBatchConsent(approved) { /* Re-evaluates rules with consent flag */ }
  async confirmCurrentDraft() { /* Calls gateway.confirmAllocation */ }
  async cancelCurrentDraft() { /* Calls gateway.cancelAllocation */ }
}
```

---

## 5. Interactive Component Specifications

1. **Order Input Component**: Textarea for raw text order entry + "Analyze Allocation" button.
2. **Suggestion Card Component**: Displays allocated warehouse, batch number, allocated quantity, and remaining lot stock.
3. **Warning Banner Component**: Displays color-coded warning chips for `BATCH_MIXING_REQUIRED`, `LOW_OCR_CONFIDENCE`, `INSUFFICIENT_STOCK`, `PHYSICAL_COUNT_UNCONFIRMED`.
4. **Batch Mixing Consent Switch**: Interactive toggle (`customerApprovedMixedBatch`). Toggling immediately re-invokes rule evaluation to update suggestion cards.
5. **Confirmation Action Control**: "Confirm Allocation" button triggers `confirmAllocation()`, locks inputs, and displays a success badge (`ALLOCATION_CONFIRMED`).

---

## 6. Small Packs & Commit Boundaries

Phase 3 implementation follows 4 distinct TDD packs:

* **Small Pack 3A**: `feat(allocation-ui): add frontend state machine and view layout architecture`
  - Implement view layout structure and state machine transitions.
* **Small Pack 3B**: `feat(allocation-ui): add AllocationAssistantClient gateway wrapper`
  - Implement `AllocationAssistantClient` to connect UI actions with `AllocationGateway`.
* **Small Pack 3C**: `feat(allocation-ui): add interactive approval controls and warning banners`
  - Implement suggestion detail cards, warning banners, and batch mixing consent toggle.
* **Small Pack 3D**: `test(allocation-ui): add UI state machine simulation tests and update handoff`
  - Add client-side UI simulation suite `tests/simulations/allocation-ui-client.sim.js`.
  - Update `CHANGELOG.md`, `CURRENT_HANDOFF.md`, and `ROADMAP.md`.

---

## 7. Security & Permission Control Rules

* **Zero Direct External Calls**: UI components interact exclusively through `AllocationAssistantClient` and `AllocationGateway`.
* **No Unsanitized HTML Injections**: All user input text rendered in UI cards must be escaped safely.
* **State Isolation**: UI state mutations must not modify global window properties or breach view container boundaries.
