# Stage 22-B Work Center Alignment Closure

## 1. Purpose

Stage 22-B addressed two source-confirmed issues:

1. LINE staff deep links used PWA views that were not appropriate for Work Center entry:
   - `holds`
   - `dashboard`
2. Work Center "今天到期" summary count and clicked task list used inconsistent predicates.

This stage did not handle:

- ETA
- substitute product recommendations
- LINE customer product query behavior
- Backend changes
- schema changes
- proactive push notifications

## 2. Implemented Changes

### 2.1 LINE staff deep links

Updated `line-bot-apps-script/src/core/line_intent_router.gs`.

Assistant staff links:

- `holds` -> `tasks`
- `holds&filter=urgent` -> `tasks`

Boss overview link:

- `dashboard` -> `tasks`

The unsupported `filter=urgent` query was removed.

No URL query parser was added.

The LINE customer product query flow was not changed.

### 2.2 Today Due Predicate Alignment

Updated `app.js`.

The `renderTasks()` `dueToday` branch now excludes archived tasks by checking:

```js
isTaskFinishedOrCancelled_(task)
```

Completed and cancelled tasks no longer appear in the "今天到期" list.

The summary count and list predicate are now aligned.

The following predicates were not changed:

- overdue
- next7
- highPriority

## 3. Commit and Push

- Commit hash: `189639f2490ae7843a94749b5cb4ee46f124a746`
- Commit message: `fix: align work center links and due today filter`
- Pushed to: `origin/main`
- After push local and `origin/main`: `0 behind / 0 ahead`
- Working tree: clean

## 4. Deployment

### 4.1 Frontend

`app.js` belongs to the frontend/static hosting target.

The public Vercel asset was checked and confirmed to contain the Stage 22-B `dueToday` guard:

`https://brown-phi.vercel.app/app.js?v=20260711-task-dashboard-v12`

The repository configuration alone could not prove Git integration.

Production frontend activation was verified by public asset content, not inferred from push alone.

No additional frontend deploy command was executed.

### 4.2 LINE Bot

- Deployment ID: `AKfycbxioavjvzENr9duOtomZQRmbycbDtJOzKNAuSgcnE1ptNquTStiWMZwygLEHaYfPxOn`
- Previous version: `177`
- New version: `178`
- Description: `Stage 22-B align staff work center links`

The existing production deployment was updated.

No extra production deployment was created.

Backend was not deployed.

## 5. Validation

### Checks

- `npm run check`: PASS
- `python3 deploy.py backend --check`: PASS, dry-run only
- `python3 deploy.py line-bot --check`: PASS, dry-run only

### Today Due Simulation

- active + due today: count/list included
- completed + due today: count/list excluded
- cancelled + due today: count/list excluded
- overdue: unchanged
- next7: unchanged
- highPriority: unchanged

### LINE Staff URL Simulation

- assistant URL: `?view=tasks`
- boss URL: `?view=tasks`
- no `view=holds`
- no `view=dashboard`
- no `filter=urgent`

### Production Validation

- Frontend public asset contains the `dueToday` exclusion.
- LINE Bot deployment metadata confirms Version 178.
- Mock URL simulation passed.
- No real LINE API was called.

## 6. Preserved Behavior

The following were not changed:

- LINE customer product query
- product inventory query
- ETA flow
- substitute product recommendations
- retailSales / showroomSales existing valid staff links
- Backend API
- task schema
- task write payload
- Script Properties
- webhook
- triggers
- NotificationLogs
- Google Sheets data

## 7. Safety

- LINE API called: no
- Customer message sent: no
- NotificationLogs created: no
- Trigger changed: no
- Schema changed: no
- Script Properties changed: no
- Backend deployed: no
- Extra deployment created: no

## 8. Known Limits and Warnings

1. Apps Script deployed Version 178 source snapshot could not be directly downloaded for content verification.
   - Deployment content was verified through governed deploy output, local source, deployment metadata, and mock simulation.
   - This is a non-blocking limitation.
2. `clasp status` showed non-uploaded local items:
   - `src/core/README.md`
   - `src/repositories/README.md`
   - `src/services/`
   These items are not in the Apps Script uploaded source list.
   They were not included in the Stage 22-B production deployment.
   This is currently an informational warning and does not require modification.
3. Frontend repository config alone cannot prove Git auto-deploy.
   - Stage 22-B frontend activation was confirmed by public asset content.

## 9. Final Status

- Stage 22-B implementation: complete
- Review: passed
- Commit: complete
- Push: complete
- Frontend production validation: passed
- LINE Bot deployment: Version 178 complete
- Post-deploy validation: PASS WITH WARNING
- Blockers: none
- Stage 22-B: closed

## 10. Recommended Next Stage

Next stage:

`Stage 22-C LINE ETA and Substitute Product Read-only Investigation`

Goals:

- Read-only investigation of ETA data source, fields, and trigger flow.
- Investigate the root cause for ETA not showing after quantity is added.
- Investigate current substitute product recommendation implementation and matching rules.
- Do not modify the LINE customer query main flow.
- Do not deploy.
- Do not write to Google Sheets.
- Do not call LINE API.
