# LINE Bot Services

更新日期：2026-07-01

## 定位

`services/` 用於未來放置業務邏輯模組，例如 Inventory、Promo、Reservation、Alert、LineReply 與 JingyangAssistant。

## WP-019 狀態

WP-019 只建立服務層分類邊界，不搬移 business function，不拆檔，不重構。

目前相關業務邏輯仍保留在：

- `../line程式碼.gs`
- `../程式碼.gs`
- `../JingyangAssistant.gs`

完整 legacy 副本保留於：

- `../legacy/line程式碼.gs`
- `../legacy/程式碼.gs`
- `../legacy/JingyangAssistant.gs`

## 後續原則

後續若進入服務層整理，只能在明確 Work Package 與 Review Gate 下進行，且不得改變既有使用者可見行為。
