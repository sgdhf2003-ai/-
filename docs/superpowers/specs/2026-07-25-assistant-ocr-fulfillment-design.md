# JYAI Allocation Assistant - Phase 7 Sales Assistant LINE OCR & Fulfillment Loop Design Specification

**Document Version**: `v1.0.0`
**Date**: `2026-07-25`
**Status**: `PROPOSED_SPECIFICATION`
**Module**: `JYAI Allocation Assistant (Phase 7 Sales Assistant LINE OCR & Fulfillment Loop)`

---

## 1. Project North Star & User Role Alignment

### 1.1 Core Target User
* **Primary Target User**: Sales Assistant (業務助理 / Admin).
* **System Purpose**: Automated management of order allocation, formal hold deductions (`正式扣留`), and outbound fulfillment (`出貨結案`).

### 1.2 Core Closed-Loop Workflow
```
[ 📸 拍照 / 上傳單據圖片 ] ➔ [ 🤖 LINE Bot OCR 辨識與庫存劃扣試算 ] ➔ [ 💳 LINE Flex Message 選項卡片與 LIFF 微型修正彈窗 ] ➔ [ ⚡ 一鍵確認 / 背景自動寫入 Sheet 去保留 ] ➔ [ 🚚 出貨與結案雙軌收尾 ]
```

---

## 2. LINE Image Ingestion & OCR Recognition Flow

1. **LINE Webhook Receiver**:
   - Listens for `image` content messages from LINE Webhook (`handleLineWebhook`).
   - Downloads binary blob using `LINE_CHANNEL_ACCESS_TOKEN` via `getLineContentBlob(messageId)`.
2. **OCR Parsing Adapter**:
   - Converts binary blob to base64 data URL and passes to OCR parser.
   - Extracts `productCode`, `requestedQuantity`, and `confidenceScore`.
3. **Allocation Engine Evaluation**:
   - Passes parsed payload to `evaluateAllocationRules()`.
   - Generates `AllocationDraft` and `AllocationSuggestion`.

---

## 3. LIFF Micro Edit Popup (LIFF 微型修正彈窗) Specifications

When an Assistant clicks **[✏️ 修正品項/數量]** on the LINE Flex Message card, the LIFF Micro Edit Popup opens.

### 3.1 Quick Quantity Tags
* Quick increment/preset buttons: `[ 10 ]`, `[ 50 ]`, `[ 500 ]`, `[ 1,000 ]`.

### 3.2 Four Core Features
1. **Feature 1: Voice & Chatroom Override**:
   - Assistants can speak or type in LINE chatroom (e.g., "改 2000" or "數量改 500") to update quantity without opening full form.
2. **Feature 2: Quick Tag Tap-to-Adjust**:
   - Tapping quantity tags instantly increments or sets `requestedQuantity`.
3. **Feature 3: Anomaly & Overflow Alert**:
   - Displays amber warning banner when entered quantity exceeds snapshot stock (`INSUFFICIENT_STOCK`) or exceeds 5,000 PCS (`LARGE_QUANTITY_ANOMALY`).
4. **Feature 4: Original Document Inspection**:
   - Includes **[ 🔍 查看原始單據照片核對 ]** button to view high-resolution uploaded order photo.

---

## 4. LINE Flex Message Decision Cards Design

The LINE Bot responds with an interactive Flex Message containing 4 primary action buttons:

1. **[✅ 一鍵確認去保留]** (`action=confirm_hold&draftId=...&key=...`):
   - Confirms allocation and executes background write to `SHEETS.holds` Sheet with `SyncIdempotencyGuard` deduplication.
2. **[✏️ 修正品項/數量]** (`action=liff_edit&draftId=...`):
   - Launches the LIFF Micro Edit Popup for instant adjustment.
3. **[🔀 同意混批再計算]** (`action=recalculate_mixed&draftId=...`):
   - Sets `customerApprovedMixedBatch = true` and re-evaluates allocation rules across warehouses.
4. **[❌ 取消/重新拍照]** (`action=cancel_draft&draftId=...`):
   - Cancels the draft and clears transient state.

---

## 5. Formal Hold Writeback (Google Sheet 去保留寫入規格)

Upon confirmation, `AllocationSyncEngine` writes to `SHEETS.holds`:

| Sheet Column Header | Data Value Source |
| :--- | :--- |
| `id` | `hold_${Date.now()}_${rand}` |
| `storeId` | `storeId` from draft context |
| `storeName` | `storeName` from draft context |
| `salesOwner` | `salesOwner` from assistant login context |
| `item` | `productCode` (e.g. `EQA-6522`) |
| `quantity` | `allocatedQuantity` (e.g. `10 PCS`) |
| `reservationStatus` | `已收訂 (劃扣)` |
| `holdAddress` | `warehouseName` & `batchNumber` (e.g. `林口倉 - 批號 7J25`) |
| `holdDate` | `ISO Date YYYY-MM-DD` |
| `expiresAt` | `ISO Date (holdDate + 60 days)` |
| `status` | `CONFIRMED_HOLD` |

---

## 6. Outbound Fulfillment Loop (出貨收尾結案雙軌機制)

### 6.1 Option 2 (Primary): Automated "Pending Outbound" Flex Card
- Upon hold expiration or shipment trigger, system pushes a Flex Card:
  - **[🚚 全額出貨]**: Updates hold status to `FULFILLED` and updates inventory sheet.
  - **[✏️ 部分出貨]**: Opens LIFF window to adjust delivered quantity and keeps remaining stock reserved.
  - **[❌ 取消保留]**: Releases hold and returns stock to available pool.

### 6.2 Option 3 (Secondary): Text Command Shortcuts
- Assistants can type direct commands in LINE chatroom:
  - `出貨 #H12345` -> Triggers full outbound fulfillment.
  - `結案 #H12345` -> Closes hold record.

---

## 7. Small Packs Breakdown & Commit Boundaries

Phase 7 implementation is structured into 3 Small Packs:

* **Small Pack 7A**: `feat(assistant-ocr): implement line image webhook, ocr adapter, and liff micro edit popup`
  - Implement image blob fetching, OCR parser adapter, and LIFF popup with quick quantity tags `[10]`, `[50]`, `[500]`, `[1000]`.
* **Small Pack 7B**: `feat(formal-writeback): implement formal hold writeback to google sheet holds tab`
  - Connect `AllocationSyncEngine` to `SHEETS.holds` with `SyncIdempotencyGuard` deduplication.
* **Small Pack 7C**: `feat(fulfillment-loop): implement dual-track outbound fulfillment flex card and text commands`
  - Implement Option 2 Flex Card (`[🚚 全額出貨]`, `[✏️ 部分出貨]`, `[❌ 取消保留]`) and Option 3 text commands (`出貨 #單號`, `結案 #單號`).

---

## 8. Static Security & Compliance Rules

* Zero placeholders permitted in specification document.
* Full regression test suite (`npm run simulate:all`) and dry-run deployment checks (`deploy.py`) must pass with 0 errors.
