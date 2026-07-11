# Assistant Work Center Readonly Task List Checkpoint

## 1. Checkpoint Summary

- **Checkpoint name**: Assistant Work Center Readonly Task List Checkpoint
- **Latest commit**: eef3afc
- **Baseline dependency**: Assistant Work Center Controlled Write Baseline v3
- **Baseline v3 checkpoint commit**: 68978b2
- **Backend Apps Script version**: Version 48
- **PWA deployment**: Vercel Git auto deployment (triggered by git push)
- **LINE Bot deployment**: unchanged since v176
- **Git status at verification**: clean
- **backend --check**: PASSED
- **line-bot --check**: PASSED
- **Regression status**: stable (Stage 7-1-R, Stage 7-2A-R, Stage 7-2B-R all passed)
- **P0 / P1 / P2**: none found

## 2. Implemented Readonly Task List Features

The following readonly search, filter, and sorting features have been implemented on the PWA frontend task list:
1. `taskSearchKeyword`: Input-based free-text search filtering on visible tasks.
2. `filterTaskDueDate`: Select-based dropdown to filter tasks by their due dates.
3. `sortTaskOrder`: Select-based dropdown to change the display sort order of tasks.

## 3. Search Rules

- **Frontend isolation**: The keyword `taskSearchKeyword` is captured on input change and stored strictly in a local JavaScript variable.
- **API Boundary**: Not included in any `sendCloudAction` payload, `pushSnapshotToCloud` serialized JSON, or task objects.
- **State Boundary**: Never writes back or alters `state.tasks`.
- **Persistence**: Not persisted to `localStorage` or session variables.

## 4. Due Filter Rules

The `filterTaskDueDate` select element operates strictly in memory with the following options:
- `all`: Does not filter.
- `dueToday`: Matches `parseToLocalYYYYMMDD(task.dueDate) === todayStr`.
- `overdue`: Matches `parsed dueDate < todayStr` and excludes `Finished`, `done`, `Cancelled`, and `cancelled` tasks.
- `next7Days`: Matches `todayStr <= parsed dueDate <= today + 7 days`. Includes `Finished`, `done`, `Cancelled`, and `cancelled` tasks to support date-range review.
- `noDueDate`: Matches empty, `null`, `undefined`, or malformed due date strings.

**Date Parsing**:
- All date evaluations use local parsing helpers `parseToLocalYYYYMMDD` and today's representation `getTodayDateString_` to align with the client-side timezone.

## 5. Sort Rules

The `sortTaskOrder` select element supports the following options:
- `default`: Preserves the original `state.tasks` array sequence.
- `updatedAtDesc`: Sorts tasks by `updatedAt` time stamp (newest first). Malformed or empty values are sorted at the bottom.
- `createdAtDesc`: Sorts tasks by `createdAt` time stamp (newest first). Malformed or empty values are sorted at the bottom.
- `dueDateAsc`: Sorts tasks by `dueDate` string (closest first). Malformed or empty values are sorted at the bottom. Uses `parseToLocalYYYYMMDD` for YYYY-MM-DD comparisons instead of `Date.parse(dueDate)`.

**Stability and Immutability**:
- Implemented in `applyTaskSort_(tasks, sortKey)`.
- Never mutates the input array or `state.tasks` directly.
- Uses the decorator pattern to wrap items with their original index: `const decorated = tasks.map((task, index) => ({ task, index }))`.
- If sort values are identical or `sortKey === "default"`, the comparator falls back to `left.index - right.index` to maintain a stable default sequence.
- The `index` property exists only in the temporary wrapper and is never written to the `task` objects.

## 6. Safe Render Order

To ensure correct permission gatekeeping, the sequence of operations inside `renderTasks()` is strictly defined as follows:
1. Retrieve all tasks from `state.tasks`.
2. Apply user visibility/permission checks (e.g. boss/sales/assistant access rights) to obtain the `visibleTasks` base array.
3. Apply status filter dropdown.
4. Apply role filter dropdown.
5. Apply assignee filter dropdown.
6. Apply `taskSearchKeyword` text match.
7. Apply `filterTaskDueDate` select match.
8. Apply `applyTaskSort_(filtered, sortTaskOrder)` to create a sorted copy of the filtered array.
9. Render the summary cards grid and the task cards.

*The sorting and filtering steps never alter the summary stats calculations or bypass visibility limits.*

## 7. Write Boundaries

The PWA remains strictly locked to exactly three controlled status-writing entrypoints:
1. **Finished / 完成工作**: Calls `completeTaskFromPwa_` sending status `Finished` (no reason).
2. **Blocked / 回報異常**: Calls `reportTaskIssueFromPwa_` sending status `Blocked` with a whitelisted Blocked reason.
3. **Waiting / 等待補資料**: Calls `requestTaskInfoFromPwa_` sending status `Waiting` with a whitelisted Waiting reason.

- **No Write Expansion**: No `createTask`, `appendTaskNote`, `deleteTask`, or `taskForm` interfaces are exposed.
- **No Inputs Added**: No free-text `textarea`, `prompt`, or custom text fields are introduced.
- **Snapshot Integrity**: `pushSnapshotToCloud` remains isolated and never serializes `state.tasks` back to the backend.

## 8. Regression Results

Full regression testing suites confirm:
- Keyword search matches all text fields properly.
- Due date filters categorize tasks accurately across timezone boundaries.
- Stable sorting executes without mutating the backend cache.
- The `clearTaskFilters` button successfully resets search keyword, due date filter, and sorting order to default values without requesting backend APIs.
- Backend Apps Script Version 48 reason validation, LINE Bot assistant postbacks, and product lookup flows operate correctly.
- Dry runs of backend and LINE Bot deploy check commands: **PASSED**.

## 9. Future Rules

- Frontend readonly features (filtering, search options, visualization) can be grouped and implemented iteratively.
- Any backend change, LINE bot modification, or new write path must be split and reviewed separately.
- Do not introduce write capabilities to the PWA (such as adding task comments or deleting items) without an official architecture audit of the sheet database schemas.
- Under no circumstances should `state.tasks.sort()` or direct assignment of sorted arrays to `state.tasks` be used.
- All modifications must undergo local regression testing and AI simulated post-deployment checks before commits are made.
