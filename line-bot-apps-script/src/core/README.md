# LINE Bot Core

更新日期：2026-07-09

## 定位

`core/` 用於放置 LINE Bot 與 Web App 的高風險入口，例如 `doPost`、`doGet`、LINE Webhook 與 Web UI entrypoint。

`line_intent_router.gs` 負責 Package 2-1 的 Customer Mode / Staff Mode
身分判斷、文字 intent 偵測與權限路由。`doPost` 仍保留於原檔案。

## WP-019 狀態

WP-019 只建立分類邊界，不搬移入口 function。

目前入口 function 仍保留在：

- `../line程式碼.gs`
- `../程式碼.gs`

完整 legacy 副本保留於：

- `../legacy/line程式碼.gs`
- `../legacy/程式碼.gs`

## 禁止事項

- 不搬 `doPost`。
- 不搬 `doGet`。
- 不改 HTML `google.script.run` 呼叫名稱。
- 不改 Deployment。
- 不改 Trigger。
- 不改 LINE 回覆文字與格式。
