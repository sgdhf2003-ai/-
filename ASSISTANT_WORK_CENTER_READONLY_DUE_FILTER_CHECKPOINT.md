# Assistant Work Center Readonly Due Filter Checkpoint

## 1. Checkpoint Summary

- **Checkpoint name**: Assistant Work Center Readonly Due Filter Checkpoint
- **Latest commit**: 4e001c6
- **Baseline dependency**: Assistant Work Center Controlled Write Baseline v3
- **Baseline v3 checkpoint commit**: 68978b2
- **Readonly Search checkpoint commit**: e55a05f
- **Backend Apps Script version**: Version 48
- **PWA deployment**: Vercel Git auto deployment (triggered by git push)
- **LINE Bot deployment**: unchanged since v176
- **Git status at verification**: clean
- **backend --check**: PASSED
- **line-bot --check**: PASSED
- **Regression**: Stage 7-2A-R passed
- **P0 / P1 / P2**: none found

## 2. Purpose

- Stage 7-2A introduced a readonly due date filter for the PWA task list page.
- This checkpoint documents the exact filter behavior, date parsing rules, timezone assumptions, and boundary rules of the `filterTaskDueDate` select control.
- This checkpoint serves to prevent any future confusion between the readonly filter variables and task write variables.
- The due date filter must remain entirely frontend-only and must never become a backend write path.

## 3. Source of Truth

- **Official repo**: `/Users/chenhaoan/Documents/jingyang-sales-app`
- **PWA Backend Apps Script ID**: `1vRepq_HNkjbs8vRQvbkkDE8unGPHfksfhOTrkrNZthFZHs2GSHO8Gasc`
- **LINE Bot Apps Script ID**: `19rYFpT-RE77oT52QfFIpIBqjcXSWemKRs0ClExMXo0lImf_OFb_DJ_AD`
- **LINE Bot Web App URL**: `https://script.google.com/macros/s/AKfycbxioavjvzENr9duOtomZQRmbycbDtJOzKNAuSgcnE1ptNquTStiWMZwygLEHaYfPxOn/exec`
- **PWA URL**: `https://brown-phi.vercel.app`

## 4. Implemented Readonly Due Filter

- **Select element ID**: `filterTaskDueDate`
- **Scope**: Frontend-only in-memory filtering.
- **Safety**: No free-text input is added, not wrapped in a form, no write hooks.
- **Persistence**: Not saved to `localStorage`, and never synced back to the backend.
- **Data Isolation**: Never mutates the `state.tasks` array, and does not use `Array.sort` / `.sort()`.

**Options**:
1. `all` / 全部到期日
2. `dueToday` / 今天到期
3. `overdue` / 已逾期
4. `next7Days` / 未來 7 天
5. `noDueDate` / 無到期日

## 5. Date Field and Helper Rules

- **Due date field**: `task.dueDate`
- **Display helper**: `formatTaskDate_`
- **Local date parsing helper**: `parseToLocalYYYYMMDD`
- **Today helper**: `getTodayDateString_`
- **Date comparison**: Done strictly using standard `YYYY-MM-DD` strings returned by the pre-existing local parsing helpers.
- **Timezone**: Follows the client-side system timezone for today's representation, aligning perfectly with standard PWA date representations.
- **Dependencies**: No external date libraries (e.g. moment, dayjs) were introduced.

## 6. Due Filter Semantics

### all
- Does not filter by `dueDate` (all values are accepted).

### dueToday
- Includes tasks where `parseToLocalYYYYMMDD(task.dueDate) === todayStr`.
- Empty or invalid due dates are excluded.

### overdue
- Includes tasks where `parsed dueDate < todayStr`.
- Excludes `Finished`, `done`, `Cancelled`, and `cancelled` tasks.
- Empty or invalid due dates are excluded.
- **Reasoning**: Overdue indicates pending, actionable work that has slipped past the deadline, rather than completed or discarded work.

### next7Days
- Includes tasks where `todayStr <= parsed dueDate <= today + 7 days`.
- **Includes** `Finished`, `done`, `Cancelled`, and `cancelled` tasks.
- Empty or invalid due dates are excluded.
- **Reasoning**: Next 7 Days is a range-based review filter. Users may need to see all scheduled events or deliveries in that window regardless of whether they have already been completed or cancelled.

### noDueDate
- Includes tasks where `dueDate` is empty, `null`, `undefined`, or a malformed non-date string.
- Excludes valid formatted dates.

## 7. Timezone and Invalid Date Rules

- Taiwan local date calculations (UTC+8) match the existing `getTodayDateString_` and `parseToLocalYYYYMMDD` behaviors to prevent timezone off-by-one errors (e.g. morning/night boundary skew).
- ISO datetime values with `Z` or UTC offset are normalized to local `YYYY-MM-DD`.
- Malformed strings (e.g., Chinese dates or text placeholders) do not crash the UI; they gracefully fallback to the `noDueDate` group.
- The filter must not alter the summary cards' `dueToday` active count.

## 8. Search and Filter Order

Within `renderTasks()`, all filters run in sequence:
1. Start from `state.tasks`.
2. Apply user visibility/permission rules first (to get `visibleTasks`).
3. Apply status filter.
4. Apply role filter.
5. Apply assignee filter.
6. Apply `taskSearchKeyword` filter.
7. Apply `filterTaskDueDate` filter.
8. Render summary grid, task cards, or empty state text.

**Inviolable Rules**:
- The due filter must never expose unauthorized tasks.
- Keyword search and due filter must compound together (logical AND).
- Clearing filters resets values without contacting the server.

## 9. Boundaries Against Write Paths

- `filterTaskDueDate` must not enter `sendCloudAction` payload.
- `filterTaskDueDate` must not enter `pushSnapshotToCloud`.
- `filterTaskDueDate` must not be assigned into `state.tasks` or any individual task object.
- `filterTaskDueDate` must not be saved to `localStorage`.
- `filterTaskDueDate` must not trigger `syncFromCloud` or `readAll`.
- `clearTaskFilters` resets `filterTaskDueDate` back to `all` but must never write to `localStorage` or call `sendCloudAction`.

## 10. No Sort Boundary

- Stage 7-2A does **not** implement sorting.
- There is no `sortTasks` state or sort select dropdown.
- There is no `Array.sort` / `.sort()` usage on `state.tasks`.
- Task list sorting is deferred to a separate Stage 7-2B architecture audit.
- Any future sorting must sort a copied array, never mutation of the original `state.tasks` array.

## 11. Controlled Write Entrypoints Remain Unchanged

The PWA remains strictly locked to exactly three status mutation entrypoints:
1. **Finished / 完成工作**: Calls `completeTaskFromPwa_` sending status `Finished` (no reason).
2. **Blocked / 回報異常**: Calls `reportTaskIssueFromPwa_` sending status `Blocked` with a whitelisted Blocked reason.
3. **Waiting / 等待補資料**: Calls `requestTaskInfoFromPwa_` sending status `Waiting` with a whitelisted Waiting reason.

**System Alignment**:
- Stage 7-2A did not modify these status payloads.
- Stage 7-2A did not introduce new write actions.
- Stage 7-2A did not modify Backend Version 48 or the LINE Bot codebase.

## 12. Regression Results

Full regression testing suite (Stage 7-2A-R) confirms:
- Due date filters (`all`, `dueToday`, `overdue`, `next7Days`, `noDueDate`) work correctly.
- Invalid date handling is robust.
- Keyword, status, role, and assignee filter compounding operates correctly.
- Reset button resets all states including the new due filter dropdown.
- Complete task, Blocked task, and Waiting task write actions remain isolated.
- Backend Version 48 reason validation, LINE Bot assistant flows, and inventory searches are intact.
- Clasp check modes are valid.
- Active issue count: **0** (No P0 / P1 / P2 issues).

## 13. Future Development Rules

- Due/search/filter features are readonly by default.
- Do not build server-side search/filter queries.
- Do not persist filter choices across sessions.
- Do not embed filter states into task objects.
- Do not mutate `state.tasks` or call `.sort()` on it.
- Keep the filter select dropdowns visually grouped and separated from action buttons.
- Any new filter or select control requires implementation checks, diff reviews, and isolation verifications.
- AI simulation testing is mandatory for every new behavior.
