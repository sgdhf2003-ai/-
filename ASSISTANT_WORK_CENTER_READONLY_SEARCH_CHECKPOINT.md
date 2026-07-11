# Assistant Work Center Readonly Search Checkpoint

## 1. Checkpoint Summary

- **Checkpoint name**: Assistant Work Center Readonly Search Checkpoint
- **Latest commit**: 72b3806
- **Baseline dependency**: Assistant Work Center Controlled Write Baseline v3
- **Baseline v3 checkpoint commit**: 68978b2
- **Backend Apps Script version**: Version 48
- **PWA deployment**: Vercel Git auto deployment (triggered by git push)
- **LINE Bot deployment**: unchanged since v176
- **Git status at verification**: clean
- **backend --check**: PASSED
- **line-bot --check**: PASSED
- **Regression**: Stage 7-1-R passed
- **P0 / P1 / P2**: none found

## 2. Purpose

- Stage 7-1 introduced a readonly keyword search filter and clear filters button for the PWA task list page.
- This checkpoint documents the explicit allowed exception for this new input element.
- This checkpoint serves to prevent any future confusion between the readonly search input and the strictly prohibited task write/free-text inputs.
- The keyword search feature must remain entirely frontend-only and under no circumstances become a backend write path.

## 3. Source of Truth

- **Official repo**: `/Users/chenhaoan/Documents/jingyang-sales-app`
- **PWA Backend Apps Script ID**: `1vRepq_HNkjbs8vRQvbkkDE8unGPHfksfhOTrkrNZthFZHs2GSHO8Gasc`
- **LINE Bot Apps Script ID**: `19rYFpT-RE77oT52QfFIpIBqjcXSWemKRs0ClExMXo0lImf_OFb_DJ_AD`
- **LINE Bot Web App URL**: `https://script.google.com/macros/s/AKfycbxioavjvzENr9duOtomZQRmbycbDtJOzKNAuSgcnE1ptNquTStiWMZwygLEHaYfPxOn/exec`
- **PWA URL**: `https://brown-phi.vercel.app`

## 4. Implemented Readonly Features

1. **Keyword search**
   - **Input element ID**: `taskSearchKeyword`
   - **Type**: `text`
   - **Autocomplete**: `off`
   - **Scope**: Frontend-only in-memory filtering.
   - **Structure**: Not wrapped inside a `<form>` element, no submit event listeners, and pressing Enter must not trigger any form submit or state mutation.
2. **Clear filters**
   - **Button element ID**: `clearTaskFilters`
   - **Scope**: Clears `taskSearchKeyword` variable, empties the search input box text, and resets status, role, and assignee filter dropdown values back to default.
   - **Redraw**: Calls `renderTasks()` to re-render the PWA view locally. No API requests are made.

## 5. Search Fields

The keyword search matches against at least the following fields on each task object:
- `id`
- `title`
- `description`
- `customerName`
- `productName`
- `assignedTo`
- `assignedRole`
- `createdBy`
- `status`
- `blockedReason`

**Search Rules**:
- Trims leading and trailing whitespace from the query.
- English matching is completely case-insensitive.
- Chinese characters match through substring scanning.
- Empty string restores the list (disables keyword filtering).
- Frontend-only; no backend queries, fuzzy matching, query parameters, keyword highlighting, or localStorage persistence.

## 6. Readonly Input Exception

- The system-wide safety rule banning new `<input>` and `<textarea>` elements was built to prevent free-text write paths (such as task creation, custom notes, or custom status reasons) that could bypass backend validations or corrupt database tables.
- Stage 7-1 introduces exactly one readonly search input exception: `taskSearchKeyword`.
- This input is explicitly allowed because:
  - It is not a task note.
  - It is not a custom status reason.
  - It is not part of any task creation, editing, or deletion forms.
  - It is never submitted to the backend.
  - It is not stored in the `state.tasks` array or task objects.
  - It is not serialized in `pushSnapshotToCloud`.
  - It does not trigger background synchronizations or `readAll` queries.
  - It solely filters already-visible tasks in the client memory.

## 7. Explicitly Still Forbidden

The following write actions and UI components remain strictly prohibited:
- Task note inputs
- Custom status reason inputs
- Textarea elements
- Window prompt dialogs
- Form submit actions
- Task creation forms (`createTask`)
- Task note appending forms (`appendTaskNote`)
- Task deletion forms/buttons (`deleteTask`, `removeTask`)
- Task editing forms
- Arbitrary free-text status reasons or "其他" options
- New backend action handlers or new status transition API endpoints
- `pushSnapshotToCloud` task updates
- Storing `taskSearchKeyword` in localStorage or URL parameters
- Backend database search routines

## 8. Search and Filter Order

Within `renderTasks()`, role-based task visibility and permissions are verified before applying filters:
1. Load all tasks from `state.tasks`.
2. Apply the user's role-based visibility filter first (identifying `visibleTasks`).
3. Apply the status filter.
4. Apply the role filter.
5. Apply the assignee filter.
6. Apply the `taskSearchKeyword` filter.
7. Render the summary card metrics, task cards, or empty state text.

**Operational Rules**:
- Frontend search must never reveal tasks that the current user does not have permission to view.
- Search operates exclusively on the pre-filtered `visibleTasks` list.
- Status summary cards and keyword search coexist harmoniously.
- Clearing filters must not fetch backend updates.

## 9. Boundaries Against Write Paths

- `taskSearchKeyword` must not enter `sendCloudAction` payload.
- `taskSearchKeyword` must not enter `pushSnapshotToCloud`.
- `taskSearchKeyword` must not be assigned to `state.tasks` or any individual task object.
- `taskSearchKeyword` must not be saved to `localStorage`.
- `taskSearchKeyword` must not trigger `syncFromCloud` or `readAll`.
- `clearTaskFilters` must not call `sendCloudAction`.
- `clearTaskFilters` must not call `pushSnapshotToCloud`.
- `clearTaskFilters` must not call `syncFromCloud`.
- `clearTaskFilters` must not mutate `state.tasks` or write to `localStorage`.

## 10. Controlled Write Entrypoints Remain Unchanged

The PWA remains strictly locked to exactly three status mutation entrypoints:
1. **Finished / 完成工作**: Calls `completeTaskFromPwa_` sending status `Finished` (no reason).
2. **Blocked / 回報異常**: Calls `reportTaskIssueFromPwa_` sending status `Blocked` with a whitelisted Blocked reason.
3. **Waiting / 等待補資料**: Calls `requestTaskInfoFromPwa_` sending status `Waiting` with a whitelisted Waiting reason.

**System Alignment**:
- Stage 7-1 did not modify these status payloads.
- Stage 7-1 did not introduce new write actions.
- Stage 7-1 did not modify Backend Version 48 or the LINE Bot codebase.

## 11. Regression Results

Full regression testing suite (Stage 7-1-R) confirms:
- Readonly keyword search works correctly.
- Whitespace trimming, case-insensitivity, and Chinese matching function properly.
- Empty result state handles zero matches without errors.
- Status, role, assignee, and summary card filters compound correctly with keyword search.
- Clear filters button resets all parameters.
- Permission-first visible task filter operates securely.
- Complete task, Blocked task, and Waiting task write actions remain isolated and fully functional.
- `pushSnapshotToCloud` task exclusion is preserved.
- Backend Version 48 reason validation, LINE Bot assistant flows, and inventory searches are intact.
- Clasp check modes are valid.
- Active issue count: **0** (No P0 / P1 / P2 issues).

## 12. Future Development Rules

All future query, filter, or UI changes must comply with these directives:
- Search and filter features are readonly by default.
- Do not build server-side search actions unless backed by an architectural audit.
- Do not persist search keywords across sessions unless explicitly approved.
- Do not embed search states into task objects.
- Do not add custom sorting or due date range selectors without a Stage 7-2 architecture audit.
- Keep the search UI visually separated from action buttons.
- Classify any new form field immediately: either it is a readonly filter UI control, or it is a write/free-text input.
- Task write/free-text inputs remain strictly forbidden unless backed by a staged implementation plan.
- AI simulation testing is mandatory for every new behavior.
