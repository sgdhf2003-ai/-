# Assistant Work Center Create / Note Checkpoint

## 1. Summary
- **latest commit**: `621f590`
- **backend version**: 49
- **scope**: PWA createTask and appendTaskNote
- **backend action**: createTask
- **backend action**: appendTaskNote
- **PWA UI**: create task modal and append note section
- **LINE Bot**: unchanged (v176)
- **backend --check**: PASSED
- **line-bot --check**: PASSED
- **E2E**: PASSED
- **P0/P1/P2**: none

## 2. Backend Implementation
- **createTask backend action**: Accepts task parameters and initializes key fields.
- **appendTaskNote backend action**: Appends sanitized comments with a prefix formatting.
- **pwa_create_task audit**: Logs task creation events inside SHEETS.auditLogs.
- **pwa_append_note audit**: Logs comment addition events inside SHEETS.auditLogs.
- **id/status/source/createdBy/createdAt/updatedAt/updatedBy/sourceUser/sourceRole 由 backend 產生**: Front-end metadata attributes are completely ignored.
- **note append-only**: Comments are appended in new lines chronologically.
- **Google Sheets formula injection protection**: Strips or prefixes `=, +, -, @` characters.
- **type / priority / assignedRole / dueDate validation**: Enforces type, priority, and date whitelist ranges.
- **role-based permission checks**: Limits target assignees based on creator role permissions.
- **unknown/no user rejected**: Rejects requests missing username or role identifiers.

## 3. PWA Implementation
- **任務中心新增「＋ 新增任務」**: Placed in header view-toolbar.
- **createTask modal 欄位**:
  - `title`
  - `type`
  - `priority`
  - `assignedRole`
  - `assignedTo`
  - `dueDate`
  - `description`
  - `customerName`
  - `productName`
  - `quantity`
- **createTask payload excludes backend-only fields**: Only passes title, type, priority, and description.
- **detail panel append note section**: Renders input form directly at the bottom of the details drawer.
- **appendTaskNote payload only sends action/userContext/id/note**: Drops old task parameters.
- **send button disabled during submit**: Prevents duplicate submissions.
- **inline error / toast feedback**: Presents clear, visible alert messaging.
- **mobile UI protected**: Responsive form grids adapt cleanly to narrow screens.

## 4. E2E Verification
- **test task id**: `task-1783740020387-374`
- **test title**: `[TEST_STAGE9E_CREATE_NOTE] PWA 建立任務與追加備註測試`
- **initial status**: `Created`
- **final status**: `Finished`
- **source**: `pwa`
- **createdBy/updatedBy/sourceUser**: `管理員`
- **sourceRole**: `admin`
- **createTask response**: `ok: true`
- **appendTaskNote response**: `ok: true`
- **Finished updateTaskStatus response**: `ok: true`
- **pwa_create_task audit**: verified stored successfully.
- **pwa_append_note audit**: verified stored successfully.
- **no production data accidentally changed**: confirmed.

## 5. Safety Boundaries
- **no pushSnapshotToCloud tasks write**: Sync continues to exclude tasks array.
- **no frontend-created id/status/createdBy/updatedBy**: Auto-filled by backend.
- **no full task object sent in appendTaskNote**: Payload is lightweight.
- **no old note overwrite**: Historical comments are preserved.
- **no delete task API**: Unimplemented to avoid malicious deletions.
- **no LINE Bot changes**: Rested in v176.
- **no token/credential changes**: Handled securely.
- **no duplicate doPost/doGet/replyToLine**: Only one single post router exists.
- **Finished/Blocked/Waiting controlled write preserved**: Legacy status triggers continue working.

## 6. Regression Verified
- **search**: Fully functional.
- **due filter**: Fully functional.
- **sort**: Fully functional.
- **clear filters**: Fully functional.
- **detail toggle**: Toggles chevron arrows correctly.
- **createTask**: Fully functional.
- **appendTaskNote**: Fully functional.
- **updateTaskStatus Finished**: Fully functional.
- **backend --check**: PASSED.
- **line-bot --check**: PASSED.

## 7. Remaining Work / Future Stage
- Stage 9 create/note is stable.
- **Next recommended stage**: Stage 10-A `updateTaskFields` / `assignTask` backend architecture audit.
- Future edit/assignment work must include:
  - optimistic lock using `updatedAt` comparison.
  - field whitelist.
  - role permission matrix.
  - audit before/after details log.
  - Finished/Cancelled edit restrictions.
  - no broad snapshot writes.
