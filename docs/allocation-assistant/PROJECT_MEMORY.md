# Allocation Assistant Build History & Project Memory

## 1. 專案基本資訊 (Project Metadata)
* **專案名稱**: 勁揚業務管家 / Jingyang Sales App (配貨與出貨資料自動化管理助手)
* **核心定位**: 配貨與出貨資料自動化管理助手
* **主產品軸線 (Main Axis)**:
  `Create formal hold -> fulfill or partially fulfill -> cancel/release -> readback/audit`
* **權責目錄 (Canonical Repository Path)**:
  `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
  *(屬 macOS Google Drive Desktop 同步之正規目錄，嚴禁在 scratch 或備份目錄操作)*

## 2. 治理規範與單一事實來源 (Governance & Sources of Truth)
次序不可更動：
1. `AGENTS.md` (專案頂層治理規範與 Preflight 流程)
2. `docs/stages/CURRENT_HANDOFF.md` (當前階段交接記錄)
3. `docs/allocation-assistant/CURRENT_HANDOFF.md` (配貨助手交接記錄)
4. `docs/allocation-assistant/PROJECT_MEMORY.md` (本歷史紀錄檔)

## 3. 階段里程碑與 Git Commit 記錄 (Milestones & Baseline Commits)

### Stage 35: Operation Control Handler Integration
* **狀態**: 完成並同步 (`bd1e841b08e6fe9c516dc896841486cf17974409`)
* **交付內容**:
  - 完成 Stage 35-A 合約關卡。
  - 完成 `AllocationGatewayClient` 4 大操作處理器接線 (`createFormalHold`, `fulfillHold`, `cancelReleaseHold`, `queryReadbackAudit`)。
  - 貫徹角色防護 (`admin`/`boss`/`assistant` 允許；`sales`/`retail` 拒絕 `UNAUTHORIZED_ROLE`；未登入拒絕 `INVALID_SESSION_USER`)。
  - 貫徹讀回遮蔽合約 (助理層級 `readbackRedacted === true`，銷售層級 `READBACK_QUERY_DENIED`)。

### Stage 36: Production Operation Readback & Controlled Integration Package
* **狀態**: 完成並同步 (`d697cfb4d15b792f1443c0a86c277d4900a45365`)
* **交付內容**:
  - 實作 `AllocationSandboxView` 之 `renderReadbackAuditCard(readbackResult, userRole)` 審查紀錄卡片渲染器。
  - 貫徹角色去敏感化標籤與 `[敏感除錯記錄與系統屬性已自動遮蔽]` 告示。
  - 新增單元測試，測試總數提升至 **202 / 202 PASS**。

### Stage 37: Controlled Production Deployment & Operation Verification Gate
* **狀態**: 完成並記錄 (`3879b58`)
* **交付與驗證內容**:
  - Backend Web App 成功部署至 **Version 97**。
  - 受控生產寫入證明完好執行並清理 (`RES-20260802-TEST01` -> `TEST_CLEANUP_DELETED`)。

### Stage 38: Admin Operation Flow UI Endpoint Integration Gate
* **狀態**: 完成並記錄 (`0f7ec24`)
* **交付與驗證內容**:
  - 後端 `google-apps-script/Code.gs` 為 `fulfillHold` 與 `cancelReleaseHold` 補強顯式 `doPost` action 派發器。
  - Backend Web App 成功部署至 **Version 98** (`AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw`)。

### Stage 39: Sales Admin Daily Operational Flow Readiness Audit
* **狀態**: 完成並記錄 (Stage 39 Milestone Complete)
* **最新同步 Commit**: `0f7ec24c13dfaf3cb7ca3d4695aa4a9a8a64b231` (`docs: record Stage 38 milestone closure, Version 98 deployment and explicit action dispatcher integration`)
* **準備度審查結果**: **Readiness Classification: PASS**
* **審查內容**:
  - **4 大日常作業流程**: 建立正式劃扣、部分/全額銷扣出貨、取消釋放劃扣、作業讀回與審查全數通過驗證。
  - **權限與去敏感化**: `admin`/`boss`/`assistant` 允許操作；`sales`/`retail` 拒絕寫入與審查 (`READBACK_QUERY_DENIED`)；助理讀回去敏感化 (`readbackRedacted === true`)。
  - **線上 Web App 基線**: 保留 **Backend Web App Version 98** 為當前作業基線。
  - 0 次未授權 Google Sheet 寫入、0 次 LINE API 發送、0 次 Token 讀取。

## 4. 自動化驗證基線 (Automated Verification Baseline)
- `npm run check`: **PASS**
- `npm run simulate:all`: **202 / 202 PASS**
- `python3 deploy.py backend --check`: **VALID** (Backend Apps Script dry-run safe)
- `python3 deploy.py line-bot --check`: **VALID** (LINE Bot Apps Script dry-run safe)
- `git diff --check`: **PASS** (0 空白字元錯誤)
- **生產環境部署記錄**: Backend Web App Version 98, LINE Bot Project Version 1 完好保留。





## 5. 安全邊界與禁止行為 (Safety Boundaries & Prohibitions)
未經 Owner 明確獨立授權前，嚴禁執行以下事項：
1. **禁止生產部署**: 嚴禁執行 `clasp push`、`clasp deploy` 或 `deploy.py` 實體部署。
2. **禁止 Google Sheet 寫入**: 嚴禁對生產環境 Google Spreadsheets 執行寫入或結構修改。
3. **禁止 LINE API 發送**: 嚴禁呼叫 LINE Push/Reply API 或變更 Rich Menu。
4. **禁止 Secret/Token 讀取**: 嚴禁在終端機、日誌或文件中輸出、存取或列印任何 Secret/Token。
5. **禁止未授權 Commit/Push**: 任何 Git 變更必須經 Owner 審查 Approved Scope 後方可 commit/push。

## 6. 未來 Agent 接手第一提示語 (Future Agent First Prompt)
> "Read `AGENTS.md` first, then read `docs/stages/CURRENT_HANDOFF.md` and `docs/allocation-assistant/PROJECT_MEMORY.md` before making suggestions or changes."
