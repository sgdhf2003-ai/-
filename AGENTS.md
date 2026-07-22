# Repository Agent Instructions

This repository is the canonical `jingyang-sales-app` workspace when located at:

`/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`

## Required Preflight

Before implementation, commit, push, or deploy:

1. Confirm `pwd` and `git rev-parse --show-toplevel`.
2. Confirm branch is `main` unless the user explicitly requests otherwise.
3. Confirm `git status --short`.
4. Run `git fetch origin` before comparing local and remote state.
5. Confirm ahead/behind with `git rev-list --left-right --count origin/main...HEAD`.

If multiple `jingyang-sales-app` directories are found, stop and ask the user to confirm the intended repo.

`deploy.py` derives the official project boundary from its own repository root and still requires cwd to be inside that root. Do not reintroduce a hardcoded `/Users/chenhaoan/Documents/jingyang-sales-app` boundary.

## Safety Boundaries

- Do not assume `/Users/chenhaoan/Documents/jingyang-sales-app`.
- Do not modify Script Properties, Google Sheets, triggers, tokens, credentials, or deployment IDs unless explicitly requested.
- Do not call LINE reply/push APIs unless the user explicitly authorizes a live test.
- Keep Backend, LINE Bot, and Frontend deployment scopes separate.
- Prefer dry-run checks before any deploy.

## Stage Handoff

Use `docs/stages/CURRENT_HANDOFF.md` for current stage state and `docs/DECISIONS.md` for durable decisions.
