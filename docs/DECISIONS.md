# Decisions

## Repo Location

- Use `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app` as the sole canonical workspace.
- Developer, Documents, scratch workspace, and exported checkout paths are stale or backup copies unless the Owner explicitly reassigns the project root.
- Do not assume the legacy local path `/Users/chenhaoan/Documents/jingyang-sales-app` or the old Developer checkout.
- If multiple matching repos are found, stop and reject non-canonical locations unless the Owner has explicitly reassigned the project root for the current stage.
- `deploy.py` must enforce the canonical cloud-drive repository root and keep `--check` dry-run mode free of clasp subprocesses, pushes, version creation, and deploys.

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
