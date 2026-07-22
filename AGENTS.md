# Repository Agent Instructions

This repository is the canonical `jingyang-sales-app` workspace when located at:

`/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app`

## Required Preflight

Before implementation, commit, push, or deploy:

1. Confirm `pwd`, `pwd -P`, and `git rev-parse --show-toplevel` match `/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app`.
2. Confirm branch is `main` unless the user explicitly requests otherwise.
3. Confirm `git status --short`.
4. Run `git fetch origin` before comparing local and remote state.
5. Confirm ahead/behind with `git rev-list --left-right --count origin/main...HEAD`.

If multiple `jingyang-sales-app` directories are found, stop and reject non-canonical locations.

`deploy.py` enforces `/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app` as the sole official boundary and blocks execution from CloudStorage or Google Drive.

## Safety Boundaries

- Do not use `/Users/chenhaoan/Library/CloudStorage/...` (Google Drive) as official source; it is untrusted/backup only and blocked for deployment.
- Do not assume `/Users/chenhaoan/Documents/jingyang-sales-app`.
- Do not modify Script Properties, Google Sheets, triggers, tokens, credentials, or deployment IDs unless explicitly requested.
- Do not call LINE reply/push APIs unless the user explicitly authorizes a live test.
- Keep Backend, LINE Bot, and Frontend deployment scopes separate.
- Prefer dry-run checks before any deploy.

## Stage Handoff

Use `docs/stages/CURRENT_HANDOFF.md` for current stage state and `docs/DECISIONS.md` for durable decisions.
