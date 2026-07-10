# Assistant Work Center Controlled Write Baseline v3

## 1. Baseline Summary

- **Baseline name**: Assistant Work Center Controlled Write Baseline v3
- **Latest commit**: ae7e063
- **Backend Apps Script version**: Version 48
- **PWA deployment**: Vercel Git auto deployment (triggered by git push)
- **LINE Bot deployment**: unchanged since v176
- **Git status at verification**: clean
- **backend --check**: PASSED
- **line-bot --check**: PASSED
- **Regression**: Stage 5-2D-R passed
- **P0 / P1 / P2**: none found

## 2. Source of Truth

- **Official repo**: `/Users/chenhaoan/Documents/jingyang-sales-app`
- **PWA Backend Apps Script ID**: `1vRepq_HNkjbs8vRQvbkkDE8unGPHfksfhOTrkrNZthFZHs2GSHO8Gasc`
- **LINE Bot Apps Script ID**: `19rYFpT-RE77oT52QfFIpIBqjcXSWemKRs0ClExMXo0lImf_OFb_DJ_AD`
- **LINE Bot Web App URL**: `https://script.google.com/macros/s/AKfycbxioavjvzENr9duOtomZQRmbycbDtJOzKNAuSgcnE1ptNquTStiWMZwygLEHaYfPxOn/exec`
- **PWA URL**: `https://brown-phi.vercel.app`

## 3. Completed Stages

- **Stage 5-1A: Backend task status write security**
  - **Commit**: c260717
  - **Summary**: Introduced `canUserUpdateTask_` role-based permission guard and `userContext` verification in update endpoints. Enabled structured logging of operator role details into the audit logs table on status updates.
- **Stage 5-1B: PWA complete task action**
  - **Commit**: af3431e
  - **Summary**: Implemented PWA "完成工作" action button. Integrates role permission checking on the client side, sends status "Finished" to the backend with appropriate `userContext`, and appends to local `state.auditLogs` to immediately render user actions.
- **Stage 5-1C: Controlled Write Baseline v1 regression**
  - **Commit**: 6f20eb1
  - **Summary**: Drafted the v1 checkpoint document (`ASSISTANT_WORK_CENTER_CONTROLLED_WRITE_CHECKPOINT.md`) and verified LINE Bot features remain regression-free.
- **Stage 5-2B: Backend reason validation**
  - **Commit**: 6480762
  - **Summary**: Built backend validation whitelist checking in `Code.gs` for status update requests going to `Blocked` or `Waiting` status. Invalid reasons cause a transaction failure, protecting sheet database from malformed strings.
- **Stage 5-2C: PWA issue reporting**
  - **Commit**: 4777fb0
  - **Summary**: Added PWA "回報異常" action button displaying 5 quick action buttons for whitelisted reason strings. Submits `Blocked` status to GAS backend.
- **Stage 5-2D: PWA waiting status**
  - **Commit**: ae7e063
  - **Summary**: Added PWA "等待資料" action button displaying 5 quick action buttons for whitelisted missing info strings. Submits `Waiting` status to GAS backend.

## 4. Current PWA Controlled Write Entrypoints

Currently, PWA supports exactly three controlled status-writing entrypoints:

1. **Finished / 完成工作**
   - **Trigger Function**: `completeTaskFromPwa_`
   - **GAS Action**: `updateTaskStatus`
   - **Sent Status**: `Finished`
   - **Sent Note**: `PWA 完成工作`
   - **Reason**: Not required / omitted
2. **Blocked / 回報異常**
   - **Trigger Function**: `reportTaskIssueFromPwa_`
   - **GAS Action**: `updateTaskStatus`
   - **Sent Status**: `Blocked`
   - **Sent Note**: equals the selected reason text
   - **Whitelisted Reasons**:
     - `庫存不足`
     - `保留衝突`
     - `商品型號疑似錯誤`
     - `交期無法確認`
     - `客戶資料不完整`
3. **Waiting / 等待補資料**
   - **Trigger Function**: `requestTaskInfoFromPwa_`
   - **GAS Action**: `updateTaskStatus`
   - **Sent Status**: `Waiting`
   - **Sent Note**: equals the selected reason text
   - **Whitelisted Reasons**:
     - `缺客戶資料`
     - `缺商品型號`
     - `缺數量`
     - `缺送貨資訊`
     - `缺價格確認`

## 5. Explicitly Not Implemented

The PWA codebase is strictly read-only for all other mutations. The following are explicitly NOT implemented:

- `createTask` (no task creation allowed in PWA)
- `appendTaskNote` (no custom notes allowed in PWA)
- `deleteTask` / `removeTask` (no task deletion allowed in PWA)
- `taskForm` (no form for adding/editing tasks)
- Custom/Arbitrary status reason input
- `textarea`, `input`, or `window.prompt` dialogs for status reasons
- Batch task status updates
- Full task collection writebacks (no `pushSnapshotToCloud` tasks writing)

## 6. Backend Security

- `updateTaskStatus` mandates verification of `userContext` and calls `canUserUpdateTask_` helper.
- Missing or malformed user metadata returns `權限不足`.
- **Role Permission Matrix**:
  - `admin` / `boss`: Authorized to update all tasks.
  - `assistant`: Authorized to update assignedRole = "assistant" tasks, or tasks assigned to them directly.
  - `sales` / `retailSales` / `showroomSales`: Authorized to update tasks assigned to them directly, or tasks created by them.
  - Unknown/unsupported roles: Denied.
- Success updates `updatedBy` and `completedAt` (only for Finished status) or `blockedReason` (for Blocked and Waiting statuses).
- Triggers audit logging (`pwa_update_status`) into the audit logs table on success.

## 7. Backend Reason Validation

Status updates to `Blocked` or `Waiting` must strictly use whitelisted values.
- **Blocked Whitelist**: `庫存不足`, `保留衝突`, `商品型號疑似錯誤`, `交期無法確認`, `客戶資料不完整`.
- **Waiting Whitelist**: `缺客戶資料`, `缺商品型號`, `缺數量`, `缺送貨資訊`, `缺價格確認`.
- **Rules**:
  - Updates to `Blocked` check the `Blocked` whitelist; mismatch returns `異常原因不合法`.
  - Updates to `Waiting` check the `Waiting` whitelist; mismatch returns `補資料原因不合法`.
  - Finished or other statuses bypass reason checks.
  - Cross-pollution is blocked (e.g. Blocked reason string sent for Waiting status is rejected).

## 8. PWA Permission and UI Rules

- Action buttons are hidden if the task is in `Finished`, `done`, `Cancelled`, or `cancelled` status.
- Blocked task detail panel hides "回報異常" button, but displays "等待資料" button if permissions are satisfied.
- Waiting task detail panel hides "等待資料" button, but displays "回報異常" button if permissions are satisfied.
- Unregistered/guest PWA users are blocked from seeing any status toggle buttons.
- `pwaTaskStatusInFlight` Set tracking disables buttons and guards against double-submission.
- Failures trigger user notifications via `toast()` without mutating the local task state or appending local audit log rows.
- Success response updates the task cache (with optional server-task merge) and appends a mock `pwa_update_status` audit row to state to avoid visual latency.

## 9. pushSnapshotToCloud Boundary

- The `pushSnapshotToCloud` PWA function strictly excludes `tasks` in its payload.
- Task status changes must be routed solely through the `updateTaskStatus` action.
- Direct overwrite or full task cache upload from PWA client is forbidden.

## 10. LINE Bot Stability

- LINE Bot source code in `line-bot-apps-script/` remains unchanged and regression-free (version v176).
- Webhook endpoints (`doPost`) correctly process postback intents for `assistant_start_flow`, `complete_flow`, `complete_notify`, `problem_flow`, `missing_data_flow`, and `change_status`.
- Quick Reply button options for problem flow and missing data flow align exactly with the PWA whitelists.
- Product search flow operates normally and the promotional catalog card remains disabled (`isPromoCardEnabled_()` returns false).

## 11. Regression Results

Full regression testing suite (Stage 5-2D-R) confirms:
- PWA Finished, Blocked, and Waiting status updates work flawlessly.
- Whitelist reasons are fully guarded on the client and validated on the backend.
- Local state rollbacks and double-click protections function as expected.
- LINE Bot assistant flows, status changes, and product search features are completely unaffected.
- Static clasp syntax dry-runs (`backend --check`, `line-bot --check`) are fully VALID.
- Active issue count: **0** (No P0 / P1 / P2 issues).

## 12. Future Development Rules

Any future task status writing features or system extensions must adhere to these policies:
1. **Security Verification First**: Ensure all operations are secured on the backend database level before implementing frontend features.
2. **Strict Whitelist Rule**: Avoid dynamic free-text fields (`input`, `textarea`, `prompt`) unless explicitly authorized. Favor pre-defined options.
3. **Identity Verification**: Pass complete `userContext` with every status-writing action. Do not trust client-only roles.
4. **Boundary Isolation**: Do not restore `tasks` synchronization in `pushSnapshotToCloud`. Maintain `updateTaskStatus` as the single point of entry for PWA mutations.
5. **Mandatory Verification**: Every feature release must undergo static validation checks, AI simulation, and regression tests for both PWA and LINE Bot before final deployment.
