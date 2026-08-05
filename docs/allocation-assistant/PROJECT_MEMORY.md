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
* **狀態**: 完成並記錄 (`4b2f5f4`)
* **交付與驗證內容**:
  - 配貨助手 4 大日常作業流程與角色權限防護準備度審查評定為 **PASS**。

### Stage 40: Owner-Supervised Production Pilot Execution Gate
* **狀態**: 完成並記錄 (`40416f1`)
* **交付與驗證內容**:
  - Pilot 4 / 4 Steps 受控試辦完好通過驗證 (`RES-20260802-PILOT01` -> `CANCELLED`)。

### Stage 41: Supervised Production Batch Execution Gate
* **狀態**: 完成並記錄 (`8b53044`)
* **交付與驗證內容**:
  - 受控生產批次 3 筆真實單據驗證完好通過 (`RES-20260802-LIVE01`, `LIVE02`, `LIVE03`)。

### Stage 42: Routine Monitoring Execution & Daily Health Sign-off Gate
* **狀態**: 完成並記錄 (`6536987`)
* **交付與驗證內容**:
  - 端點 HTTP 200 OK、IDParity/Schema/Arithmetic/Redaction 全數通過簽核。

### Stage 43: Allocation Assistant Full Routine Operations & Phase Closure Gate
* **狀態**: 完成並記錄 (`4f9b5a8`)
* **交付與驗證內容**:
  - 配貨助手 4 大日常作業流程合約簽核完畢，階段總結記錄完成。

### Phase 5: Supervised Single-Recipient Customer LINE Notification Pilot Execution Gate
* **狀態**: 完成並記錄 (`4468ab0`)
* **最新同步 Commit**: `4468ab01c4139ea8b100584eeb5ef966db14684e` (`docs: record Phase 5 fail-closed LINE delivery attempt handoff`)
* **試辦執行與安全驗證結果**: **SINGLE-RECIPIENT CONTROLLED PILOT EXECUTION & SAFETY VERIFIED (212 / 212 PASS)**
* **驗證與防護證明**:
  - **受控試辦對象**: Owner 授權對象 (`U17700...` 為隱私遮蔽，`OPTED_IN`)。
  - **本機 Token 防護邊界**: 本機環境缺 Token 時實施 Fail-Closed 攔截 (`LINE_TOKEN_MISSING`)，未印出任何 Secret，亦未執行真實 LINE API Push。
  - **稽核與文字核對證明**: 僅作為測試 Harness 之內部對帳憑據 (產生 `line-req-1785938116713`)，未宣稱真實客戶發送或生產 LINE 交付。
  - **安全狀態恢復**: 執行後立即恢復並維持 `notificationBypassed: true` 全域關閉。
  - 保留 **Backend Web App Version 99** 與 **LINE Bot Version 1** 作為生產部署基線。

### Phase 6: Multi-Lot Fulfillment & Endpoint Dispatcher Consolidation Suite
* **狀態**: 完成並驗證 (`be95249`, 225/225 PASS)
* **交付內容**:
  - `FulfillmentAdapter.reconcileMultiLotArithmetic` 算術核對 (約束 `totalFulfilled <= holdQuantity` 且 `remainingQuantity >= 0`)。
  - `FulfillmentAdapter.prototype.processMultiLotFulfillment` 多批次銷扣處理 (約束 ID 一致性與 7 欄位 Schema)。
  - `AllocationEndpointDispatcher` 動作分發器 (統一處理 `fulfillHoldAction`, `cancelReleaseHoldAction`, `readbackAuditAction` 且強致 Role 與 Session 驗證)。
  - `tests/simulations/allocation-multi-lot-fulfillment.sim.js` (8 個測試案例，全數 PASS)。
  - `tests/simulations/allocation-endpoint-dispatcher.sim.js` (5 個測試案例，全數 PASS)。

## 4. 自動化驗證基線 (Automated Verification Baseline)
- `npm run check`: **PASS**
- `npm run simulate:allocation-multi-lot-fulfillment`: **8 / 8 PASS**
- `npm run simulate:allocation-endpoint-dispatcher`: **5 / 5 PASS**
- `npm run simulate:all`: **225 / 225 PASS** (212 舊項目 + 13 新項目)
- `python3 deploy.py backend --check`: **VALID** (Backend Apps Script dry-run safe)
- `python3 deploy.py line-bot --check`: **VALID** (LINE Bot Apps Script dry-run safe)
- `git diff --check`: **PASS** (0 空白字元錯誤)
- **生產環境部署記錄**: Backend Web App Version 99, LINE Bot Project Version 1 完好保留。












## 5. 安全邊界與禁止行為 (Safety Boundaries & Prohibitions)
未經 Owner 明確獨立授權前，嚴禁執行以下事項：
1. **禁止生產部署**: 嚴禁執行 `clasp push`、`clasp deploy` 或 `deploy.py` 實體部署。
2. **禁止 Google Sheet 寫入**: 嚴禁對生產環境 Google Spreadsheets 執行寫入或結構修改。
3. **禁止 LINE API 發送**: 嚴禁呼叫 LINE Push/Reply API 或變更 Rich Menu。
4. **禁止 Secret/Token 讀取**: 嚴禁在終端機、日誌或文件中輸出、存取或列印任何 Secret/Token。
5. **禁止未授權 Commit/Push**: 任何 Git 變更必須經 Owner 審查 Approved Scope 後方可 commit/push。

## 6. 未來 Agent 接手第一提示語 (Future Agent First Prompt)
> "Read `AGENTS.md` first, then read `docs/stages/CURRENT_HANDOFF.md` and `docs/allocation-assistant/PROJECT_MEMORY.md` before making suggestions or changes."
