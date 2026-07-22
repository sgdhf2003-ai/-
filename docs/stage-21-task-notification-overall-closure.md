# Stage 21 Task Notification Overall Closure

## 1. Scope

Stage 21 encompasses the complete single-recipient task reminder notification subsystem architecture, including schema setup, reservation and deduplication logic, cancellation mechanisms, task due candidate classification, dry-run mode, HMAC v2 secure tunnel protocol, recipient identity reverse lookup, controlled live push execution, duplicate transport-before blocking, and operational flag safety shutdown.

---

## 2. Completed Stages

- **Stage 21-B**: TaskNotificationLog 23-column schema, read-only index & lookup helpers, task-day guard (`buildTaskNotificationTaskDayGuardKey_`).
- **Stage 21-C**: Reservation write contract (`reserveTaskNotificationLogEntry_`), `ScriptLock` protection, stable row identity (UUID v4), cancellation helper (`cancelTaskNotificationReservation_`), terminal-state safeguards.
- **Stage 21-D**: Task due candidate classification (`classifyTaskDueNotificationCandidate_`), fixed buckets (`DUE_TODAY`, `OVERDUE`), safe dry-run evaluation (`dryRun: true`).
- **Stage 21-E**: Secure tunnel HMAC v2 signed protocol (`jy-line-push-v2`), signed payload envelope, redirect handling, signature validation.
- **Stage 21-F**: Recipient identity reverse lookup (`resolveControlledTaskReminderRecipient_`), v2 signed envelope with `recipientLineId`, exact LINE Bot allowlist membership check, reservation-first orchestration, network transport outside lock, finalization under reacquired lock, 1 controlled live notification sent (`SENT`), duplicate blocked before transport (`DUPLICATE_RESERVATION_BLOCKED`), safe binding validation wrapper (`validateControlledTaskReminderRecipientBindingSafe`), and operational flag shutdown to `disabled`.

---

## 3. Architecture and Security Model

- **Schema**: 23-column durable log structure with forbidden sensitive column checks (`lineUserId` is strictly prohibited in rows; only `recipientMasked` stored).
- **Orchestration**: Reservation-first concurrency pattern. `reserveTaskNotificationLogEntry_` acquires `ScriptLock` for log append, network transport runs outside the lock, and post-transport finalization reacquires `ScriptLock` for row state update.
- **Authentication**: HMAC SHA-256 v2 protocol (`jy-line-push-v2`) with 12-field canonical string including `recipientLineId`.
- **Identity Binding**: Dual-identity binding checks `Users` sheet rows for matching `lineUserId`, requires exactly one match, active status (`啟用`), and valid normalized username.
- **Allowlist Guard**: LINE Bot enforces exact membership check in `LINE_PUSH_TEST_ALLOWLIST`.
- **Deduplication**: Terminal dedupe key (`task-YYYY-MM-DD-bucket-username`) and task-day guard key (`task-YYYY-MM-DD-username`) block duplicate reservations before network transport.
- **Fail-Closed**: Zero automatic retries; invalid candidates, missing properties, or missing signatures fail closed immediately.

---

## 4. Validation Evidence

- **Simulation Regressions**: All 14 simulation test suites passed 100% (914 assertions total across 14 modules).
- **Official Repo Checks**: `npm run check`, `npm run simulate:all`, `python3 deploy.py backend --check`, `python3 deploy.py line-bot --check`, and `git diff --check` all passed cleanly.
- **Safe Binding Validation**: `validateControlledTaskReminderRecipientBindingSafe()` returned `ok: true`, `bindingMatchCount: 1`, `accountActive: true`, `usernameValid: true`.
- **Controlled Live Execution**: 1 controlled live notification executed successfully with status `SENT`, `lineCalled: true`, `notificationSent: true`, `attemptCount: 1`.
- **Duplicate Verification**: Second execution on same candidate blocked before network transport with `duplicateBlocked: true`, `transportCalled: false`, `secondRow: 0`, `errorCode: DUPLICATE_RESERVATION_BLOCKED`.
- **Operational Shutdown**: Backend and LINE Bot `LINE_PUSH_ENABLED` flags restored to `disabled`.

---

## 5. Git and Deployment State

- **Canonical Repository Root**: `/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app`
- **Branch & HEAD**: `main` @ `d2df2d580c0acce62fe8ce5912fcb50a396bfca6`
- **Backend Deployment**: Version 74 (Script ID: `...SHO8Gasc`, Deployment ID: `AKfycbw...bmUKKw`)
- **LINE Bot Deployment**: Version 188 (Script ID: `..._DJ_AD`, Deployment ID: `AKfycbx...fPxOn`)
- **Deployment Traceability**: `SOURCE_COMMIT_NOT_EMBEDDED_IN_DEPLOYMENT_METADATA` (Apps Script metadata does not embed Git hash natively).
- **Boundary Guards**: `deploy.py` and `scripts/preflight-check.sh` strictly enforce canonical Developer path and block Google Drive / CloudStorage execution.

---

## 6. Production State

- **Controlled Notification Count**: 1 (`SENT`)
- **Duplicate Send Count**: 0 (Blocked before transport)
- **Residual Reservation**: 0
- **Uncertain Outcome Count**: 0 (`UNKNOWN_OUTCOME: 0`)
- **Retry Count**: 0
- **Trigger Count**: 0
- **Operational Flags**: Both Backend and LINE Bot `LINE_PUSH_ENABLED = disabled`.

---

## 7. Known Non-blocking Findings

1. **Logger Diagnostic Gap**: `Code.gs` safe summary logger reuses string label `"Task Reminder E2E Signed Dry Run Safe Summary:"`. Recorded as minor diagnostic gap for future cleanup; does not affect privacy or functional safety.
2. **Stage 20 Generic Allowlist Path**: Stage 21-F task-specific push enforces exact allowlist membership check. Stage 20 generic webhook path was untouched in this stage. Non-blocking.
3. **API Executable / `clasp run` Access**: `clasp run` requires an API Executable deployment. Production functionality has been verified via the Web App endpoint. Non-blocking.
4. **Backend Version 74 Deployment Traceability**: Apps Script deployment metadata does not embed Git commit hashes natively. Non-blocking.
5. **Repair Branch**: `repair/canonical-boundary` is fully merged to `main` (`d2df2d5`). Optional cleanup. Non-blocking.

---

## 8. Operational Rules

1. Do NOT manually re-run Stage 21-F live wrapper.
2. Live flags `LINE_PUSH_ENABLED` must remain `disabled` by default.
3. Future scheduled reminders or recurring notifications require a separate approval stage and dedicated orchestration engine.
4. `UNKNOWN_OUTCOME` must never be automatically retried without explicit manual investigation.
5. Terminal `SENT` and `DUPLICATE_RESERVATION_BLOCKED` log entries are authoritative and must not be deleted or altered.
6. All deployments and checks MUST be executed from `/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app`.

---

## 9. Final Classification

**Stage 21: CLOSED**
