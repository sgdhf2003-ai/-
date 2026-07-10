# LINE Bot Repositories

更新日期：2026-07-01

## 目的

本目錄集中放置 LINE Bot Apps Script 專案的資料存取層。Repository 只負責 Google Sheet 讀寫 helper，不負責 LINE Webhook routing、回覆文字、查詢排序、促銷流程或 Trigger 建立。

## Repository Index

| Repository | Sheet / Source | Responsibility | Status |
| --- | --- | --- | --- |
| `LogRepository.gs` | `LINE紀錄` | log read / append / trim | Complete |
| `InventoryRepository.gs` | `庫存查詢表` | inventory rows read helper | Complete |
| `ReservationRepository.gs` | `客戶預留紀錄` | reservation append / trim | Complete |
| `ReminderRepository.gs` | `假日警示排程` | weekend alert append / read / status update | Complete |

## No-change Rules

- 不修改 Spreadsheet ID。
- 不修改 Sheet Name。
- 不修改欄位 index。
- 不搬 `doPost`。
- 不搬 `doGet`。
- 不搬 trigger function。
- 不改 LINE 回覆文字與格式。
- 不改庫存查詢排序與搜尋規則。
- 不處理 `convertChipsToUrls`、`refreshQuantityRanking` 或外部 `writeSpreadsheet` API。
