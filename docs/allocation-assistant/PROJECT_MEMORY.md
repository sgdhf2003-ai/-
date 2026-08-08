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

### Phase 6: Multi-Lot Fulfillment, Endpoint Dispatcher & Backend Version 100 Deployment
* **狀態**: 完成並驗證 (`93e8cb4`, 228/228 PASS, Version 100 HTTP 200 OK, 唯讀驗證 100% PASS)
* **交付與部署內容**:
  - `FulfillmentAdapter.reconcileMultiLotArithmetic` 算術核對 (約束 `totalFulfilled <= holdQuantity` 且 `remainingQuantity >= 0`)。
  - `FulfillmentAdapter.prototype.processMultiLotFulfillment` 多批次銷扣處理 (約束 ID 一致性與 7 欄位 Schema)。
  - `AllocationEndpointDispatcher` 動作分發器 (統一處理 `fulfillHoldAction`, `cancelReleaseHoldAction`, `readbackAuditAction` 且強致 Role 與 Session 驗證)。
  - `google-apps-script/Code.gs` 後端處理器 (更新 `fulfillHoldAction`, `cancelReleaseHoldAction` 並新增 `readbackAuditAction` 委派分發)。
  - **Backend Web App 部署記錄**: 成功部署至 Version **100** (Script ID: `1vRepq_HNkjbs8vRQvbkkDE8unGPHfksfhOTrkrNZthFZHs2GSHO8Gasc`, Deployment ID: `AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw`, 尚餘 100 個版本空間)。
  - **Phase 6-G 端點唯讀驗證**:
    - `GET Health Ping`: **HTTP 200 OK**
    - `Unauthenticated Fulfill Action`: `INVALID_SESSION_USER` (Fail-Closed 驗證成功)
    - `Readback Audit Query`: `readbackRedacted: true` (脫敏讀回驗證成功)
### Phase 7: Web App Admin Operations UI Control Panel Suite
* **狀態**: 完成並驗證 (`56a5976`, 233/233 PASS)
* **交付內容**:
  - `app.js` UI 處理器 (`renderHoldItemActions`, `validateFulfillInput`, `buildAllocationActionPayload`, `reconcileHoldStateFromReceipt`)。
  - `index.html` 與 `google-apps-script/Index.html` (`#holdFulfillModal` 銷扣出貨對話框)。
  - `tests/simulations/allocation-ui-control-panel.sim.js` (5 個 TDD 測試案例，全數 PASS)。

### Phase 8: Live Production Controlled Write Pilot (`RES-20260805-PILOT88`)
* **狀態**: 完好完成並驗證 (100% 4-Step PASS)
* **實測內容**:
  - `Step 1`: 正式保留劃扣建立 `RES-20260805-PILOT88` (`status: ACTIVE`, quantity 10, HTTP 200 OK)。
  - `Step 2`: 部分銷扣出貨寫回 (Fulfilled 4, remaining 6, 7 欄位 `ledger` 列追加成功)。
  - `Step 3`: 取消釋放劃扣寫回 (Cancelled remaining 6, remaining 0, 7 欄位 `ledger` 列追加成功)。
  - `Step 4`: 讀回稽核 (`readbackAuditAction` 驗證 `found: true`, `readbackRedacted: true`)，狀態標記為 `TEST_CLEANUP_DELETED`。
  - **副作用統計**: Production Sheet Writes 4 筆, Deploys 0, LINE Calls 0, Secrets 0, Commits 0。

## 4. 自動化驗證基線 (Automated Verification Baseline)
- `npm run check`: **PASS**
- `npm run simulate:allocation-multi-lot-fulfillment`: **8 / 8 PASS**
- `npm run simulate:allocation-endpoint-dispatcher`: **5 / 5 PASS**
- `npm run simulate:allocation-backend-wireup`: **3 / 3 PASS**
- `npm run simulate:allocation-ui-control-panel`: **5 / 5 PASS**
- `npm run simulate:all`: **233 / 233 PASS** (212 舊項目 + 21 新項目)
- `python3 deploy.py backend --check`: **VALID** (Backend Apps Script dry-run safe)
- `python3 deploy.py line-bot --check`: **VALID** (LINE Bot Apps Script dry-run safe)
- `read-only Web App HTTP ping`: **HTTP 200 OK**
- `git diff --check`: **PASS** (0 空白字元錯誤)
- **生產環境部署記錄**: Backend Web App Version 103 (已生效，離 200 版本上限剩餘 97 個空間；Version 102 為未綁定快照), LINE Bot Project Version 1 完好保留。

### Phase 8-D & Stage 35: Business Operations Vertical Slice & Readback Contract Fix
* **狀態**: 完成並記錄 (`a4f5d233917ebe20d3f7fe91c8042f6c26c814ed`)
* **交付與驗證內容**:
  - Phase 8-D 生產環境 controlled write pilot 4/4 步驟完好通過 (`RES-20260805-PILOT88` -> `TEST_CLEANUP_DELETED`)。
  - Stage 35 單一鏈條 A -> B -> C 連貫垂直切片模擬驗證完好通過 (`RES-20260806-CHAIN35`, 234/234 PASS)。
  - 生產環境讀回合約修復: 不存在單號傳回 `found: false` & `record: null`；缺失 Persistence Adapter 傳回 `READBACK_ADAPTER_MISSING` 嚴格 Fail-Closed (`a4f5d23`, 236/236 PASS)。
  - Backend Web App 成功部署至 **Version 103**，線上 Health Audit 測試 (GET HTTP 200 OK, `INVALID_SESSION_USER` Fail-Closed, `found: false` & `record: null` 不存在單號讀回合約) 全數通過。

### Stage 36 & Stage 37: Handoff Synchronization & Routine Production Health Monitoring
* **狀態**: Stage 37 健康監控、UI 控制面板接線與 R7 安全修復完畢 (`c2200e043d2fda6a5df8bd5d2fc0ae06fce3dce2`)
* **交付與驗證內容**:
  - Stage 36 狀態交接文件關卡 complete & synchronized (`e1eddfa`)。
  - Stage 37 生產環境 Version 103 4 大合約常態監控測試 (GET 200 Health Ping, Session Guard, Existing Readback, Nonexistent Readback `found: false` & `record: null`) 100% PASS。
  - Stage 37 PWA 控制面板入口接線與 R7 移除明文密碼 persistence 安全修復完畢並提交 (`c2200e0`, 236/236 PASS)。

### Stage 38 & Stage 39: Canonical Baseline & Allocation Production Contract Closure
* **狀態**: Stage 38 基準結算 & Stage 39 配貨生產合約審查 Completed & Verified (`236 / 236 PASS`)
* **交付與驗證內容**:
  - Stage 38 跨工作台 Context Gate (`CONTEXT_GATE=PASS`, `CHECKOUT_KIND=CANONICAL`) 建立與全量證據分類標註完成 (`6382491`, `6bc7973`)。
  - Stage 39 5 大核心合約唯讀與模擬審查 (ID parity、算術 reconciliation `remainingQuantity = holdQuantity - totalFulfilled`、`notificationBypassed: true` 隔離、IDEMPOTENT Replay、Fail-Closed Guards) 全數通過 (236/236 PASS)。

### Stage 40: Security and Permission Closure Gate
* **狀態**: Stage 40 伺服端角色權限與安全關閉門檻 Completed & Verified (`243 / 243 PASS`)
* **交付與驗證內容**:
  - 建立專用 Stage 40 安全與權限測試套件 (`tests/simulations/security-permission-closure.sim.js`)，新增 7 大核心安全情境測試，全量模擬基線提升至 `243 / 243 PASS`。
  - 驗證並封閉 5 大角色 (`admin`, `boss`, `assistant` 允許寫入；`sales`, `retail` 嚴格唯讀，回傳 `UNAUTHORIZED_ROLE` Fail-Closed)。
  - 驗證未登入與缺少 Session 情境 (回傳 `INVALID_SESSION_USER` Fail-Closed)，過期 Session 拒絕所有讀寫請求。
  - 驗證未知與格式錯誤角色 (回傳 `UNAUTHORIZED_ROLE` Fail-Closed)，拒絕降級與失敗開路 (Fail-Open)。
  - 驗證前端 `localStorage` R7 密碼安全防護 (0% 明文密碼/憑證/Bearer Token 持久化)。
  - 階段完成度與 release readiness 認證通過。

### Stage 41: Security & Permission Final Regression & Release Gate
* **狀態**: Stage 41 最終安全與權限迴歸與發行準備度門檻 Completed & Certified (`243 / 243 PASS`)
* **交付與驗證內容**:
  - 全量自動化模擬測試基線全數通過 (`npm run simulate:all` 243/243 PASS, 0 迴歸, 0 失敗)。
  - 專用安全與權限測試套件 100% 綠燈 (`simulate:security-permission-closure` 7/7 PASS)。
  - 驗證 Web App Version 103 與 LINE Bot Version 1 發行轉接器受控 Dry-Run 部署檢查 (`deploy.py --check` VALID)。
  - 驗證權限拒絕、 Session 過期、未授權請求之 Side-Effect 嚴格隔離 (`0 Sheet writes`, `0 LINE API calls`, `0 deploys`, `0 secrets printed`)。
  - 完成最終 Release Evidence 包與 Handoff 同步。
### Backend Entrypoint Guard & Boundary Hardening
* **狀態**: Backend Service Landing Page 與責任邊界文件收尾 Completed & Certified (`246 / 246 PASS`)
* **交付與驗證內容**:
  - 正式入口責任分工明確化: `APP_ENTRYPOINT = Vercel (https://brown-phi.vercel.app/)` (唯一使用者介面與 PWA 入口), `API_BACKEND = Google Apps Script Web App (/exec)` (資料 API 服務端點)。
  - 無參數直接開啟 `/exec` 顯示獨立自包含 `BackendLandingView.html`，提供明確 Vercel App 連結，且不引用 Apps Script 無法提供的相對 CSS/JS 資產。
  - 保留所有 `?action=...` API 路由、`doPost` API 路由與 `?page=allocation-view` 沙盒視圖相容性。
  - 新增專用測試套件 `simulate:backend-landing-boundary` (3/3 PASS)，測試總基線提升至 `246 / 246 PASS`。
  - 通過 Dry-run 部署檢查 (`deploy.py backend --check`, `deploy.py line-bot --check` VALID)。
  - 後續常態維護定案為 Daily Operations Standing Health Monitoring & Maintenance Gate。
  - 完成 Handoff Metadata 同步 (對齊 HEAD Hash `70f78b931d87e8fc82c8e2951fdbe81869c005d4` 與 Working Tree Clean 狀態)。
















## 5. 安全邊界與禁止行為 (Safety Boundaries & Prohibitions)
未經 Owner 明確獨立授權前，嚴禁執行以下事項：
1. **禁止生產部署**: 嚴禁執行 `clasp push`、`clasp deploy` 或 `deploy.py` 實體部署。
2. **禁止 Google Sheet 寫入**: 嚴禁對生產環境 Google Spreadsheets 執行寫入或結構修改。
3. **禁止 LINE API 發送**: 嚴禁呼叫 LINE Push/Reply API 或變更 Rich Menu。
4. **禁止 Secret/Token 讀取**: 嚴禁在終端機、日誌或文件中輸出、存取或列印任何 Secret/Token。
5. **禁止未授權 Commit/Push**: 任何 Git 變更必須經 Owner 審查 Approved Scope 後方可 commit/push。

## 6. 未來 Agent 接手第一提示語 (Future Agent First Prompt)
> "Read `AGENTS.md` first, then read `docs/stages/CURRENT_HANDOFF.md` and `docs/allocation-assistant/PROJECT_MEMORY.md` before making suggestions or changes."
