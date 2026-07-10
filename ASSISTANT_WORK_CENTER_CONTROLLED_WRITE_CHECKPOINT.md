# Assistant Work Center Controlled Write Baseline v1

## 1. 文件目的
此文件用於記錄 Assistant Work Center 從只讀任務中心進入第一個受控寫入（Controlled Write）功能的完整開發與驗收過程。
重點說明如下：
- 此文件是繼 `ASSISTANT_WORK_CENTER_READONLY_CHECKPOINT.md` 之後的第二份 Checkpoint 紀錄。
- 本階段為確保狀態流的嚴密安全性與隔離性，**僅開放了 PWA 詳情面板中的「完成工作」按鈕這一個最小寫入入口**。
- 本階段**尚未開放**回報異常、等待補資料、新增任務、編輯任務、刪除任務與自訂備註等任何其他寫入流程。
- 本文件將作為後續開發（如 Stage 5-2、Stage 5-3）的安全防衛與一致性基準。

## 2. 目前穩定版本
- **最新穩定 Commit**: `af3431e` (feat: add PWA task completion action stage 5-1B)
- **後端 Apps Script 部署版本**: `Version 47` (對應 commit `c260717`)
- **PWA 前端託管**: Vercel Git 自動部署流程 (已對應最新 commit 自動部署上線)
- **LINE Bot 生產部署**: 維持既有版本 `v176` (本階段無任何 LINE Bot 原始碼修改，亦無部署變更)
- **Git 狀態 (Git Status)**: Clean
- **Stage 5-1C 全系統回歸測試**: 全數通過 (Passed)

## 3. 與 Read-only Baseline 的關係
- **前一份文件基準**: `ASSISTANT_WORK_CENTER_READONLY_CHECKPOINT.md` (已完成只讀任務卡列表、日期時區與角色中文化、只讀統計摘要面板、URL 安全編碼的詳情只讀展開、底部 140px 安全間距與狀態色彩條標籤整理)。
- **Controlled Write Baseline v1** 在上述唯讀基礎上，**僅新增與擴充了**：
  1. PWA 任務詳情面板底部在符合權限時顯示「完成工作」按鈕。
  2. 後端 `google-apps-script/Code.gs` 對 `updateTaskStatus` 與 `appendTaskNote` 實作嚴格的使用者角色權限驗證防禦。
  3. 後端在變更狀態成功後自動寫入 `auditLogs`（操作紀錄）工作表。

## 4. Stage 5-0：PWA 寫入前架構盤點
在實作任何 PWA 寫入代碼前，團隊對後端 API 與權限模型進行了盤點，發現以下重大安全與資料完整性漏洞：
- **P0 權限缺失**: 後端 `updateTaskStatus` 與 `appendTaskNote` 接口完全缺乏操作者身份校驗，任何人皆可任意修改他人任務。
- **欄位未對齊**: 後端硬編碼僅在 `status === "done"` 時寫入 `completedAt`，而 LINE Bot/PWA 的完成狀態是 `"Finished"`，這會造成 PWA 呼叫時漏寫完成時間。此外漏寫 `updatedBy` 與 `blockedReason`。
- **無日誌連動**: 前端或後端呼叫 `updateTaskStatus` 成功後不會連動觸發 `appendAuditLog_`，造成操作歷史不可考。
- **P2 樂觀鎖缺失**: 缺乏 version / updatedAt 比對，存有覆蓋衝突風險。
- **架構決策**: 嚴禁在 PWA 直接呼叫漏洞 API；必須拆分為兩步，先執行 **Stage 5-1A (後端安全補強與功能對齊)**，再進行 **Stage 5-1B (前端按鈕實作)**。

## 5. Stage 5-1A：Backend 任務狀態寫入安全補強
- **對應 Commit**: `c260717`
- **後端部署**: `Version 47`
- **修改檔案**: `google-apps-script/Code.gs` (PWA 與 LINE Bot 均未修改)
- **實作內容**:
  1. `updateTaskStatus` 支援解析傳入之 `data.userContext`（包含 role, username, displayName, salesOwner, lineUserId）。
  2. 實作 `canUserUpdateTask_(task, userContext)` 權限守衛：
     - `admin` 與 `boss` 角色可更動全部任務。
     - `assistant` 角色僅限修改助理任務 (`assignedRole === "assistant"`) 或指派給自己的任務。
     - `sales`、`retailSales`、`showroomSales` 業務角色僅限修改「由自己建立」或「指派給自己」的任務。
     - 未登入、無 Context、未知角色一律拒絕更新並回傳 `{ ok: false, message: "權限不足" }`。
  3. `updateTaskStatus` 必定填入 `updatedBy` 操作者姓名。
  4. 當狀態為 `"Finished"` 或 `"done"` 時寫入 `completedAt`。
  5. 當狀態為 `"Blocked"` 或 `"Waiting"` 時從 `reason` 或 `note` 提取內容寫入 `blockedReason`。
  6. 狀態變更成功後自動呼叫 `appendAuditLog_` 寫入 action 為 `"pwa_update_status"` 的歷程紀錄。
  7. `appendTaskNote` 補上完全相同之權限守衛，成功後自動呼叫 `appendAuditLog_` 寫入 action 為 `"pwa_append_note"` 的日誌。

## 6. Stage 5-1B：PWA 完成工作按鈕
- **對應 Commit**: `af3431e`
- **修改檔案**: `app.js`、`styles.css` (Code.gs, LINE Bot, index.html 均無修改)
- **實作內容**:
  1. 在任務詳情面版底部新增「完成工作」按鈕。
  2. 當任務狀態為 `Finished`、`done`、`Cancelled`、`cancelled` 時，該按鈕自動隱藏。
  3. 前端呼叫 `canCurrentUserCompleteTask_(task)` 進行角色權限預過濾。
  4. 調用 `sendCloudAction("updateTaskStatus")` 傳送包含 `id`、`status: "Finished"`、`note: "PWA 完成工作"` 與 `userContext`。
  5. 本地宣告 `pwaTaskStatusInFlight` 全域 `Set` 防止雙擊連點。
  6. 成功後本地同步更新任務狀態為 `Finished`、填入完成時間與 `updatedBy`，並對本地 `state.auditLogs` 頂部插入一筆 `"pwa_update_status"` 紀錄以提供即時的歷程更新，最後重新渲染 UI。
- **未開放功能**: 未實作任何 createTask, appendTaskNote, deleteTask, 表單 form, 異常與等待資料按鈕，且 `pushSnapshotToCloud` 仍舊排除 `tasks` 全量寫回。

## 7. Stage 5-1C：LINE Bot / PWA / Backend 回歸測試
- **Git 狀態與 Token 檢測**: 狀態 Clean，無 Token 實值洩漏。
- **入口與商品查詢**: `doPost` / `doGet` / `replyToLine` 維持唯一。商品查詢與庫存查詢運作完好，促銷商品圖卡功能維持 disabled。
- **LINE Bot 助理流程模擬**: 
  - `待處理` 入口權限過濾正常。
  - `assistant_start_flow` 更新任務為 Started 並寫入 `startedAt` 正常。
  - `complete_flow` (問詢) 與 `complete_notify` (Finished 轉移及交辦人 LINE 通知) 正常。
  - `problem_flow` 與 `missing_data_flow` 等異常狀態更新正常。
  - 非授權使用者點擊指令會被 `handleAssistantPostback_` 權限守衛拒絕。
- **前後端一致性**: PWA 完成任務後，LINE Bot 會因狀態過濾不再將其排入「待處理」列表中，狀態保持互通一致。`pwa_update_status` 本地紀錄與雲端紀錄運作正常。

## 8. 實機驗收結果
- **PWA 詳情畫面**: 狀態呈現「已完成 (Finished)」，且「完成時間」已帶入當前 ISO 台灣時區時間，最後更新者欄位顯示「by 豪」。
- **操作歷程區**: 面板底端正確追加顯示了一筆來自 PWA 的操作紀錄：「`pwa_update_status | 蔡 (助理) | 已建立 → 已完成 | PWA 完成工作`」。
- **LINE Bot 商品查詢**: 使用者回報運作正常。
- **LINE Bot 助理流程**: 模擬回歸全數通過。

## 9. 目前安全邊界
- PWA 不可透過 `pushSnapshotToCloud` 寫回 `tasks`，也不可傳送全量 tasks 陣列。
- PWA 現階段僅限送出 `updateTaskStatus` 且 `status` 為 `"Finished"`。
- 後端 `updateTaskStatus` 與 `appendTaskNote` 必校驗 `userContext` 且寫入 `updatedBy` 與連動 `appendAuditLog_`。
- 促銷圖卡維持停用 (Disabled)。
- 保持單一 `doPost` / `doGet` / `replyToLine` 入口。

## 10. 目前已知風險
- **P0 / P1 級風險**: 無。
- **P2 級風險 (競態覆蓋)**: 缺少樂觀鎖 (version / updatedAt) 比對，多人若同秒操作同一 task，後寫者會直接覆蓋前寫者的狀態。但鑑於目前任務低頻協作與分工，暫無實質風險。若後續開放更多 PWA 寫入功能，應予重新評估。

## 11. 下一階段建議
在進入下一階段寫入功能（如回報異常、等待補資料）之前，建議先觀察目前 PWA 完成工作在現埸使用 1-2 天之穩定度。
下一步建議流程：
1. **Stage 5-2A**: PWA 回報異常 / 等待補資料前架構盤點，不修改。
2. **Stage 5-2B**: Backend reason validation 固定選項對齊。
3. **Stage 5-2C**: PWA 回報異常按鈕實作。
4. **Stage 5-2D**: PWA 等待補資料按鈕實作。

## 12. 禁止事項摘要
- 不觸碰 Token / Credentials / Script Properties。
- 不跨專案修改，不新增重複 doPost/doGet/replyToLine 入口。
- 每個新寫入功能必須進行 Stage 5-0 級別的架構與權限盤點。
- 嚴禁 PWA 全量寫回 tasks。
