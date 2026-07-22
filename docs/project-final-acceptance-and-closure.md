# Jingyang Sales App — Final Acceptance and Closure

## 1. Project Status

- **Final Classification**: **PROJECT CLOSED WITH NON-BLOCKING MAINTENANCE ITEMS**
- **Canonical Repository**: `/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app`
- **Git State**: `main` @ `d2df2d580c0acce62fe8ce5912fcb50a396bfca6`, Ahead 0 / Behind 0, working tree clean.
- **Production Deployment State**:
  - Backend Apps Script: Version 74 (Deployment ID: `AKfycbw...bmUKKw`)
  - LINE Bot Apps Script: Version 188 (Deployment ID: `AKfycbx...fPxOn`)
- **Operational Flags State**:
  - Backend `LINE_PUSH_ENABLED`: `disabled`
  - LINE Bot `LINE_PUSH_ENABLED`: `disabled`

---

## 2. Delivered Capabilities

1. **Sales Task Management**: Core task creation, status updates, editing, quick presets, and summary filters.
2. **Notification Log System**: 23-column durable `TaskNotificationLogs` schema with strict row validation, UUID v4 tracking, and forbidden sensitive column checks.
3. **Reservation & Deduplication**: Reservation-first concurrency architecture using `ScriptLock`, dedupe key indexing, and task-day guard (`buildTaskNotificationTaskDayGuardKey_`).
4. **HMAC v2 Secure Tunnel**: Secure Backend ↔ LINE Bot messaging tunnel utilizing HMAC SHA-256 (`jy-line-push-v2`), 12-field signed payload envelope, redirect handling, and replay prevention.
5. **Controlled LINE Reminders**: Reverse lookup binding (`resolveControlledTaskReminderRecipient_`), exact allowlist membership check, safe binding validation wrapper (`validateControlledTaskReminderRecipientBindingSafe`), 1 verified live push (`SENT`), and transport-before duplicate blocking (`DUPLICATE_RESERVATION_BLOCKED`).
6. **Login & Identity Security**: Secure login binding, noncanonical username normalization, and fail-closed authentication guards.
7. **Repository Governance**: Automated repository boundary enforcement in `deploy.py` and `scripts/preflight-check.sh` ensuring all operations execute strictly within `/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app` and blocking CloudStorage / Google Drive execution.

---

## 3. Acceptance Evidence

- **Regression Test Suites**: 100% PASS across all 14 simulation test suites (914 assertions total).
- **Repository Build & Boundary Checks**: `npm run check`, `npm run simulate:all`, `python3 deploy.py backend --check`, `python3 deploy.py line-bot --check`, and `git diff --check` all passed 100%.
- **Safe Binding Validation**: `validateControlledTaskReminderRecipientBindingSafe()` verified `ok: true`, `bindingMatchCount: 1`, `accountActive: true`, `usernameValid: true`.
- **Controlled Live Execution**: 1 live reminder successfully sent (`status: SENT`, `attemptCount: 1`).
- **Duplicate Prevention**: Second execution on same candidate blocked before network transport (`duplicateBlocked: true`, `transportCalled: false`, 0 second rows added).
- **Git Integrity**: Pure linear commit history, all Stage 21 commits preserved (`d076670`, `349a6d5`, `8feafb5`, `4f53bf0`, `d2df2d5`).

---

## 4. Production Operating State

- **Backend Version**: Version 74
- **LINE Bot Version**: Version 188
- **Operational Flags**: Both Backend and LINE Bot `LINE_PUSH_ENABLED = disabled`.
- **Scheduler & Triggers**: 0 active triggers, 0 recurring schedulers, 0 background queues.
- **Notification Record**: Exactly 1 controlled notification sent in production history.

---

## 5. Repository Governance

- **Canonical Root**: `/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app`
- **CloudStorage / Google Drive**: Untrusted / backup copy only. Directly blocked by `deploy.py` (`GOOGLE_DRIVE_PATH_BLOCKED` & `CROSS_PROJECT_SOURCE_BLOCKED`).
- **Documents Directory**: Forbidden and blocked.
- **Preflight & Boundary Scripts**: Enforce `pwd`, `pwd -P`, and `git rev-parse --show-toplevel` on every invocation.

---

## 6. Known Maintenance Backlog (Non-blocking)

1. **Logger Diagnostic Label**: `Code.gs` safe summary logger reuses string label `"Task Reminder E2E Signed Dry Run Safe Summary:"`. Minor diagnostic gap; does not affect data privacy or execution safety.
2. **Stage 20 Generic Allowlist Hardening**: Stage 21-F task-specific push enforces exact allowlist membership check (`allowlist.indexOf(validPayload.recipientLineId) !== -1`). Stage 20 generic webhook path was untouched in this stage. Non-blocking.
3. **API Executable / `clasp run` Access**: `clasp run` requires an API Executable deployment. Production functionality has been verified via Web App endpoint. Non-blocking.
4. **Deployment Traceability**: Apps Script deployment metadata does not embed Git commit hashes natively (`SOURCE_COMMIT_NOT_EMBEDDED_IN_DEPLOYMENT_METADATA`). Non-blocking.
5. **Repair Branch Cleanup**: `repair/canonical-boundary` is fully merged to `main` (`d2df2d5`). Branch cleanup is optional. Non-blocking.

---

## 7. Future Change Rules

1. Any future scheduled reminders or recurring automated notifications require a separate approval stage and dedicated scheduling engine.
2. Enabling live push flags (`LINE_PUSH_ENABLED = enabled`) requires explicit approval and a controlled gate window.
3. Deployments MUST NOT be executed from CloudStorage or Google Drive directories.
4. `UNKNOWN_OUTCOME` must never be automatically retried without explicit manual verification.
5. Do NOT re-use Stage 21-F live wrapper for routine operations.

---

## 8. Final Classification

**PROJECT CLOSED WITH NON-BLOCKING MAINTENANCE ITEMS**
