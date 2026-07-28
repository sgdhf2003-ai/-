# JYAI Allocation Assistant - CURRENT HANDOFF

## 1. 專案基線狀態 (Project Baseline)
* **交接日期**: 2026-07-26
* **執行目錄**: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
* **目前分支**: `stage-24-b3-production-contract-spec`
* **HEAD Hash**: `cf16edd712216790693d32e2ac2a5f287bbe8c58`
* **origin/stage-24-b3-production-contract-spec Hash**: `cf16edd712216790693d32e2ac2a5f287bbe8c58`
* **origin/main Base Hash**: `b32fad100afb3b0c926d9edc466fea2833e8ac45`
* **Ahead / Behind vs origin/main**: `2 / 0`
* **Working Tree 狀態**: Dirty by Stage 24-B3-A documentation/spec draft changes only
* **Backend Web App Deployment Version**: Version 78 (`AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw`)
* **LINE Bot Deployment Version**: Version 191 (`AKfycbxioavjvzENr9duOtomZQRmbycbDtJOzKNAuSgcnE1ptNquTStiWMZwygLEHaYfPxOn`)
* **Simulation Baseline**: `npm run simulate:all` PASS in latest Stage 24-DOCS-A local verification

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

## 4.1 Stage 24-DOCS-A AI Project Docs Structure
* 補齊根目錄 `ARCHITECTURE.md` 與 `DESIGN.md`，整理系統架構、產品設計原則與文件地圖。
* 補齊 `docs/MEMORY.md`、`docs/ai/README.md`、`docs/ai/SKILL.md`，讓 Codex、Gemini、Antigravity 與未來 agent 有一致的專案導航與操作流程。
* 對齊 `docs/DECISIONS.md` 與 `scripts/preflight-check.sh` 的 canonical cloud-drive checkout 規則。
* 已 commit/push 到 `origin/stage-24-b3-production-contract-spec`，commit `cf16edd712216790693d32e2ac2a5f287bbe8c58`。

## 4.2 Stage 24-B3-A Production Contract Spec Draft
* 僅限文件/spec 草案，不進 Stage 24-B4、不部署、不寫 Sheet、不呼叫 LINE API、不碰 token/secret、不 commit/push。
* `docs/stages/stage-24-b3-production-contract-spec.md` 定義 production persistence success 條件、fail-closed failure modes、canonical `holds` schema、mock boundary、fulfillment ledger semantics、side-effect classification 與測試證據。
* Formal hold writeback 的 production success 不得只看 `success: true`，必須確認 adapter capability、header-name mapping、persisted receipt/readback、id equality 與 idempotent replay。
* Fulfillment persistence 必須同時證明 hold status update 與 inventory ledger/snapshot boundary。
* Stage 24-B3-B Owner decision 已記錄：`CANCEL_RELEASE.quantity` 等於 released quantity，`CANCEL_RELEASE.remainingQuantity` 在 release/cancel 後保留為 audit context。
* Stage 24-B3-C Owner decision 已記錄：fulfillment ledger action naming 使用 explicit semantic mapper：`FULL_SHIP -> FULFILL_DEDUCT`、`PARTIAL_SHIP -> PARTIAL_FULFILL_DEDUCT`、`CANCEL_RELEASE -> CANCEL_RELEASE`。

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
> Stage 24-B3-A 僅允許 production contract 文件/spec 修正。未經 Owner 明確批准，不得修改 production code、部署、寫入 Google Sheet、呼叫 LINE API、commit 或 push。

## 9. 下一個精確步驟 (Next Recommended Step)
* 完成 Stage 24-B3-A verification 與 commit-readiness review。
* 待 Owner 明確批准 exact scope 後，才可 commit/push B3-A 文件/spec 變更。
* 完成 Stage 24-B3-C verification 與 commit-readiness review；Stage 24-B4 尚未開始，需 Owner 另行明確批准。

## 10. 禁止下一位 Agent 自行執行的事項 (Prohibited Actions)
* 嚴禁在未經 Owner 審查同意前撰寫任何正式庫存寫入代碼。
* 嚴禁繞過 Gateway 直接發送 LINE 提醒。
* 嚴禁未經 Owner 明確批准自行 commit、push 或 deploy。
