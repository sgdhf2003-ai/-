# JYAI Allocation Assistant - CURRENT HANDOFF

## 1. 專案基線狀態 (Project Baseline)
* **交接日期**: 2026-08-02
* **執行目錄**: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
* **目前分支**: `main`
* **HEAD Hash**: `30ea9cc345f2a03c5e2ffdcc80dbf9659efff063`
* **origin/main Hash**: `30ea9cc345f2a03c5e2ffdcc80dbf9659efff063`
* **分支關係**: `0 ahead / 0 behind` (完全同步)
* **Working Tree 狀態**: Clean

## 2. 本次完成內容 (Completed Work)
* 完成 Stage 30 & 31 生產環境 Google Sheet 劃扣與出貨生命週期驗證 (`RES-20260801-001`, `RES-20260801-002`)。
* 完成 Stage 32 建立生產環境 Standard Operating Procedure (`docs/allocation-assistant/OPERATING_SOP.md`)。
* 完成 Stage 33-A UI 入口唯讀審查與 Stage 33-B 權限合約規格制定。
* 完成 Stage 33-C 伺服端角色權限防護層與測試 (`30ea9cc`)：
  - 實作 `evaluateUserPermission` 純函數規則評估器。
  - 實作 `google-apps-script/Code.gs` 之 `upsertHolds` 角色防護 (`UNAUTHORIZED_ROLE`, `ADMIN_ROLE_REQUIRED`, `INVALID_SESSION_USER`)。
  - 新增 7 項模擬測試，測試總數提升至 **188 / 188 PASS**。
* 本機檢查、模擬測試與部署 Dry Run 全數通過 (`npm run check`, `npm run simulate:all`, `deploy.py --check` PASS)。

## 3. 未完成內容與未啟用功能 (Deactivated Features)
* LINE API 主動 Push/Send 維持關閉 (`notificationBypassed: true`)。
* 尚未在 PWA 前端開放實體使用者按鈕入口。

## 4. 已知風險 (Known Risks)
* **系統帳差**: Google Sheets 中的庫存水位與現場實體庫存可能存在延遲，需加強人工覆核宣導。
* **混批限制**: 現場操作人員如未經確認即混合批號出貨，可能導致客戶退貨。

## 5. 安全聲明 (Safety Declaration)
> [!IMPORTANT]
> 本次交接確無未授權之 LINE 機器人發送通知、無 OneSignal 警報、無真實庫存銷扣損壞。所有安全性防護邊界與 Server-Side Role Guard 機制均完好。

## 6. 下一個精確步驟 (Next Recommended Step)
* 啟動 **Stage 33-E: Readback Redaction Contract & Tests** (審查並實作讀回遮蔽與敏感欄位保護機制)。

## 7. 禁止下一位 Agent 自行執行的事項 (Prohibited Actions)
* 嚴禁在未經 Owner 審查同意前進行未授權之 Google Sheet 寫入。
* 嚴禁自行部署 backend 或 line-bot 至生產環境。
* 嚴禁繞過 Gateway 直接發送 LINE 提醒。
