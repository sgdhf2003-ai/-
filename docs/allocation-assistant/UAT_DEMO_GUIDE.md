# JYAI Allocation Assistant - UAT Demo Guide & Operator Manual

**Document Version**: `v1.0.0`
**Date**: `2026-07-24`
**Scope**: `JYAI Allocation Assistant (Option 2+ UAT Demo Guide)`

---

## 1. Overview & Sandbox Environment

The JYAI Allocation Assistant provides sales personnel with real-time stock allocation recommendations, multi-warehouse lot optimization, and batch-mixing consent management.

During User Acceptance Testing (UAT), the application operates in **Read-Only Sandbox Mode** (`唯讀沙盒模式`). All calculations utilize real inventory snapshots from Google Sheets without performing any formal database writes or dispatching LINE notifications.

### 1.1 Accessing the Sandbox Workspace
1. Open the Business Manager PWA in your mobile or desktop browser.
2. Click the **配貨試算 (沙盒)** navigation tab (`#nav-allocation`).
3. Confirm that the high-visibility amber warning banner is displayed at the top:
   > **配貨建議試算 (唯讀沙盒模式)**
   > 本頁面僅供模擬試算，不寫入正式保留與 LINE 通知。

---

## 2. Interactive Demo Preset Scenarios

The sandbox includes 3 built-in demonstration cards designed for one-click testing:

### 2.1 Scenario 1: Single Warehouse Single Batch (`DEMO_EQA_6522`)
* **Objective**: Demonstrate automatic allocation from a single warehouse and single batch when stock is sufficient.
* **Steps**:
  1. Click **範例一：單倉足量** (`EQA-6522`).
  2. Observe the auto-filled demand text: `EQA-6522 * 10`.
  3. Verify the generated allocation card:
     - Warehouse: `林口倉`
     - Batch Number: `7J25`
     - Allocated Quantity: `10 PCS`
     - Status: `ALLOCATION_REVIEW` (Green Badge)
     - Warnings: None.

### 2.2 Scenario 2: Batch Mixing Consent Required (`DEMO_GUJIA_575`)
* **Objective**: Demonstrate mixed-batch warning alerts and interactive consent toggling.
* **Steps**:
  1. Click **範例二：混批授權** (`顧佳 575`).
  2. Observe the auto-filled demand text: `顧佳 575 * 15`.
  3. Note the amber warning banner: `BATCH_MIXING_REQUIRED` (Stock split across Linkou and Wugu warehouses).
  4. Toggle the **Customer Approved Mixed Batch** (`客戶同意混批`) checkbox.
  5. Observe instant re-evaluation: Allocation updates to split 8 PCS from Linkou and 7 PCS from Wugu.

### 2.3 Scenario 3: Low OCR Confidence Review (`DEMO_LOW_CONFIDENCE`)
* **Objective**: Demonstrate fail-closed security when order text recognition confidence is low.
* **Steps**:
  1. Click **範例三：低可信度審查** (`艾美 336`).
  2. Observe order text: `艾美 336 ?? 20`.
  3. Status transitions to `OCR_REVIEW` (Amber Badge).
  4. Note that confirmation buttons are automatically disabled to enforce manual verification.

---

## 3. Read-Only Protection Verification

In UAT Sandbox Mode, attempting to execute a formal reservation write throws `SANDBOX_WRITE_FORBIDDEN`, ensuring complete isolation from production Google Sheets and LINE API services.
