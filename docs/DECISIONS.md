# Decisions

## Repo Location

- Use `/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app` as the sole canonical workspace.
- CloudStorage / Google Drive paths are strictly backup copies and blocked from deployment.
- Do not assume the legacy local path `/Users/chenhaoan/Documents/jingyang-sales-app`.
- If multiple matching repos are found, stop and reject non-canonical locations.
- `deploy.py` must enforce the canonical repository root `/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app` and block execution from cloud sync folders.

## TaskNotificationLog Safety

- `TaskNotificationLog` remains a durable notification log.
- Read-only lookup and reservation decision logic must not write production rows.
- Reservation write and notification send require separate approval stages.
- Duplicate dedupe keys and conflicting task-day guards fail closed.
- Automatic retry is not allowed without a future manual retry contract.

## Deployment Boundaries

- Backend deploy uses `google-apps-script/`.
- LINE Bot deploy uses `line-bot-apps-script/src/`.
- Frontend deploy is separate from Apps Script deploys.
- Dry-run checks are required before deploy stages.
- Cross-project guards stay enabled: cwd must be inside the repo root and clasp rootDir must remain inside its target directory.
