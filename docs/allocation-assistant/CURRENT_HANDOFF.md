# JYAI Allocation Assistant - CURRENT HANDOFF

## 1. 專案基線狀態 (Project Baseline)
* **交接日期**: 2026-07-26
* **執行目錄**: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
* **目前分支**: `main`
* **HEAD Hash**: `75aed13274311d1905601c4b2946078f7e102791`
* **origin/main Hash**: `75aed13274311d1905601c4b2946078f7e102791`
* **Ahead / Behind**: `0 / 0`
* **Working Tree 狀態**: Clean
* **Backend Web App Deployment Version**: Version 78 (`AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw`)
* **LINE Bot Deployment Version**: Version 191 (`AKfycbxioavjvzENr9duOtomZQRmbycbDtJOzKNAuSgcnE1ptNquTStiWMZwygLEHaYfPxOn`)
* **Simulation Baseline**: `npm run simulate:all` = 149 / 149 PASS

## 2. 產品定位 (North Star)
* **核心使用者**: 業務助理 / Sales Assistant / Admin，而非一般業務員。
* **核心目標**: 配貨與出貨資料自動化管理助手。
* **核心閉環**: Inbound 去保留 -> Outbound 待出貨銷扣。

## 3. 本次完成內容 (Completed Work)
* 成功完成 Phase 7 **Sales Assistant LINE OCR & Fulfillment Loop** (Small Packs 7A, 7B, 7C).
* 實作 `OcrCandidateMatcher` 與 `ImageOcrAdapter` 支援模糊辨識與 Top 3 候選品項按鈕。
* 實作 `LiffMicroEditPopup` 支援快捷數量標籤 `[10]`, `[50]`, `[500]`, `[1000]`、語音/打字覆蓋解析 (`改 2000`)、大數量/庫存溢出警示與原圖放大核對按鈕。
* 實作 `FormalHoldWritebackAdapter` 支援結構化正式單號 (`RES-YYYYMMDD-XXX`) 與 Google Sheet 正式去保留寫入。
* 實作 `FulfillmentAdapter` 雙軌出貨結案機制（Option 2 待出貨輪播卡片 + Option 3 文字快捷指令 `出貨 #單號` / `結案 #單號`）。
* 成功執行 115 年庫存試算表整合後雙端 Production clasp push 部署（Backend Version 78 / LINE Bot Version 191）。
* 擴充全套模擬測試至 149 / 149 PASS (共 27 大模擬測試套件)。

## 4. Stage 24-A 文件治理修正重點
* 對齊 canonical repo path: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`。
* 修正文檔中舊 `/Users/chenhaoan/Documents/...` 官方路徑描述。
* 對齊 Backend Version 78、LINE Bot Version 191、main 與 origin/main 同步、149 / 149 PASS。

## 5. Phase 7 Integration-Hardening Gaps
* `FormalHoldWritebackAdapter` 的正式 Sheet persistence contract 尚未被 real adapter 完整證明。
* `holds` 分頁欄位 mapping 需要和 canonical schema 對齊。
* `FulfillmentAdapter` 尚未證明會持久化更新 Sheet / inventory snapshot。
* `JingyangAssistant` fallback spreadsheet ID 需要 Owner 確認或對齊 115 年庫存試算表。

## 6. 未完成內容與未啟用功能 (Deactivated Features)
* 外部自訂第三方 Provider（預留對接介面）。

## 7. 已知風險 (Known Risks)
* **單據圖片解析度**: 若單據圖片極度模糊且無文字描述，可能需依賴業務助理透過 LIFF 修正彈窗或打字覆蓋修正。

## 8. 安全聲明 (Safety Declaration)
> [!IMPORTANT]
> Stage 24-A 僅允許文件與治理修正。未經 Owner 明確批准，不得修改 production code、部署、寫入 Google Sheet、呼叫 LINE API、commit 或 push。

## 9. 下一個精確步驟 (Next Recommended Step)
* 完成 Stage 24-A 文件治理修正驗證。
* 待 Owner 批准後，另開 Stage 24-B 處理 Phase 7 integration-hardening。

## 10. 禁止下一位 Agent 自行執行的事項 (Prohibited Actions)
* 嚴禁在未經 Owner 審查同意前撰寫任何正式庫存寫入代碼。
* 嚴禁繞過 Gateway 直接發送 LINE 提醒。
* 嚴禁未經 Owner 明確批准自行 commit、push 或 deploy。
