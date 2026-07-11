# Stage 11 Frontend Routing Cache Closure

## Stage 11 fix scope

Stage 11 stabilized the Task Center frontend experience for the production PWA. The work focused on frontend/static PWA behavior only:

- Work Center quick preset and summary card behavior
- PWA frontend cache and asset versioning
- Direct route support for `?view=tasks`
- Homepage Work Task entry routing into `tasksView`

No backend Apps Script code or LINE Bot source was changed for this closure.

## Root causes

- The production PWA frontend is a Vercel static site.
- Apps Script deploys do not publish `app.js`, `index.html`, `styles.css`, or `service-worker.js`.
- Installed PWA/service worker cache could keep serving older frontend behavior.
- Homepage `data-view` / `data-shortcut-view` routing was not centralized enough for reliable Work Center entry.
- `renderTasks()` previously called `parseToLocalYYYYMMDD(...)`, but the actual helper is `parseToLocalYYYYMMDD_(...)`, which could break task rendering.

## Fixes completed

- Frontend visible version was bumped from `v11` to `v12`.
- Static asset query strings were bumped from `20260628-default-api-v11` to `20260711-task-dashboard-v12`.
- Service worker cache was bumped from `jingyang-manager-pwa-v53-default-api` to `jingyang-manager-pwa-v54-task-dashboard-v12`.
- `normalizeInitialView()` now allows `tasks`.
- `button#tasksCard` is explicitly `type="button"`.
- `data-view` and `data-shortcut-view` routing are handled through one unified click path.
- `setView()` saves `state.activeView`.
- `renderTasks()` is guarded with a visible error state plus console error logging.
- All task date parsing calls use `parseToLocalYYYYMMDD_()`.

## Deployment model

- Frontend: Git push to `main` triggers Vercel deployment.
- Backend: deploy only when `google-apps-script/Code.gs` changes.
- LINE Bot: untouched in this stage.

## User validation

- Production UI showed `v12`, confirming the frontend cache/version bump reached production.
- User validation confirmed the app could proceed from the homepage/function selection flow into the Work Center route after the routing fix.

## Follow-up notes

- For frontend UI bugs, do not rely only on `python3 deploy.py backend`; that deploys Apps Script backend files, not the Vercel static PWA.
- Frontend changes require Git push and Vercel deployment.
- Installed PWA clients may need one reload or a tap on `更新系統` to pick up the newest service worker and cached assets.
