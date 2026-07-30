# JYAI Local Agent Workflow

Use this workflow for Codex, Gemini, Antigravity, or any future coding agent working on `jingyang-sales-app`.

## 1. Read First

Read project-root `AGENTS.md` before code, deploy, Sheet, LINE, token, commit, or push work.

Then read:

1. `PROJECT_BOUNDARIES.md`
2. `docs/DECISIONS.md`
3. `docs/stages/CURRENT_HANDOFF.md`
4. `docs/allocation-assistant/CURRENT_HANDOFF.md`
5. Any active stage token/spec named by the Owner

## 2. Confirm Workspace

Work only in:

`/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`

Run:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status -sb
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count HEAD...origin/main
```

If the path is a Developer, Documents, scratch, or exported checkout, stop unless the Owner explicitly reassigned the project root.

## 3. Apply Contract-First Rule

Before allocation, reservation, fulfillment, Google Sheet persistence, Apps Script, LINE Bot, deploy wrapper, or production-side-effect changes:

- Identify the contract.
- Identify the adapter boundary.
- Define fail-closed behavior.
- Define simulation or dry-run evidence.
- Confirm Owner authorization for every side-effect class.

## 4. Side-Effect Gates

Forbidden unless separately approved by the Owner:

- Backend deploy.
- LINE Bot deploy.
- `clasp push`, `clasp pull`, `clasp version`, `clasp deploy`.
- Google Sheet writes.
- LINE API calls.
- Script Properties changes.
- Token/secret access or rotation.
- Commit or push.

## 5. Close the Stage

For documentation/governance stages, run the safe checks requested by the Owner, usually:

```bash
npm run simulate:all
python3 deploy.py backend --check
python3 deploy.py line-bot --check
git diff --check
git diff --cached --stat
git status -sb
```

Report files changed, verification results, remaining risks, and explicit confirmation of no deploy, Sheet write, LINE API call, token/secret access, commit, or push.
