# Repository Agent Instructions

This repository is the canonical `jingyang-sales-app` workspace when located at:

`/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app`

## 1. Canonical Workspace

- **Canonical Path**: `/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app`
- **Canonical Branch**: `main`
- **Canonical Remote**: `https://github.com/sgdhf2003-ai/-.git`
- **Stale Clone Paths**: `/Users/chenhaoan/Documents/JYAI-Independent-Repos/jingyang-sales-app` (and `/Users/chenhaoan/Documents/jingyang-sales-app`).
- **Prohibitions**:
  - Never pull, commit, push, or deploy from any stale clone path.
  - Never assume a directory is the canonical repository based solely on directory name.
  - Always verify repository identity using `PROJECT_BOUNDARIES.md`, `deploy.py` check rules, Git history, remote URL, and HEAD ref.
  - If the canonical path cannot be found or accessed, stop immediately. Never fallback to a stale clone or alternative folder.

## 2. Required Reading Order

Whenever an AI model or session starts work, the agent must read the following files in this exact order:

1. `AGENTS.md` (This file, read fully)
2. `README.md` (Read fully)
3. `PROJECT_BOUNDARIES.md` (Read fully)
4. `BUILD.md` (Read fully, if it exists)
5. `docs/stages/CURRENT_HANDOFF.md` (Read fully)
6. Stage/closure files directly relevant to the current task
7. Directly relevant source code files under development

**Rules**:
- Do not rely solely on chat context or conversation transcripts for project state.
- Do not read truncated file segments; view files in their entirety.
- If instructions or details across documents contradict, stop work immediately and report the conflict.
- If chat path/HEAD and Git mismatch, the local Git repository status is the source of truth. Re-verify instead of blindly following chat info.

## 3. Source-of-Truth Boundaries

- **LINE Bot Source**: Located in `line-bot-apps-script/src/`. Deployments use Script ID: `19rYFpT-RE77oT52QfFIpIBqjcXSWemKRs0ClExMXo0lImf_OFb_DJ_AD`.
- **Backend Source**: Located in `google-apps-script/`. Deployments use Script ID: `1vRepq_HNkjbs8vRQvbkkDE8unGPHfksfhOTrkrNZthFZHs2GSHO8Gasc`.
- **PWA Source**: Front-end website files located at repository root (`index.html`, `app.js`, etc.).
- **Legacy Exclusion**: `line-bot-apps-script/legacy/` contains deprecated code and must never be uploaded or read as a source of truth.
- **Rules**:
  - Do not cross-contaminate or mix files between backend and bot scopes.
  - Keep deployment boundaries separated. Do not deploy backend changes from the LINE Bot directory and vice-versa.
  - These boundaries align with `PROJECT_BOUNDARIES.md`. Do not modify files in legacy folders.

## 4. Stage Continuation Rules

- Always read `docs/stages/CURRENT_HANDOFF.md` first to understand the current stage.
- Re-run preflight checks and inspect `git log` to see what has actually been committed. Do not assume the HEAD mentioned in the chat is the actual current HEAD.
- If a feature has already been completed in subsequent commits, do not re-integrate or revert it. Only perform audit and validation.
- Obsolete tokens or configurations from older stages must be rewritten/updated to match current repository structures.
- Unfinished stages must document:
  - Baseline commit
  - Allowed files for modification
  - Forbidden operations
  - Current validation state
  - Next safe actions

## 5. Required Preflight

Before any implementation, commit, push, or deployment, the agent must execute and verify:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git fetch origin
git status -sb
git status --short
git rev-parse HEAD
git rev-parse origin/main
git diff --cached
```

- **Requirements**:
  - Confirm `pwd` and Git toplevel matches the canonical path.
  - Confirm active branch is `main`.
  - Confirm working tree is clean.
  - Confirm staged area (`git diff --cached`) is empty.
  - Confirm local/remote commits are synced.
  - Do not begin feature modifications in a dirty working tree.
  - Do not run `git reset`, `git checkout`, `git clean`, or `git rebase` unless explicitly authorized.

## 6. Modification Discipline

- Only modify files explicitly permitted by the current Stage guidelines.
- Do not perform unsolicited code refactoring or style formatting.
- Do not write or leave temporary debug scripts/files in tracked repository paths.
- Keep concerns isolated: do not mix repository changes, API helper changes, or UI template modifications into a single commit unless they are part of the allowed files.
- If the implementation requires expanding the modification scope to other files, stop work immediately and request permission.

## 7. Sheet Safety

- All database sheet reads must be read-only by default.
- Write testing to Google Sheets must be explicitly authorized. Do not execute exploratory writes on production spreadsheets.
- Do not modify sheet schemas, add new structural triggers, or overwrite manual data cells.
- Prioritize dry-runs and memory-based simulation harnesses.
- Before executing a permitted write, record the spreadsheet ID, tab name, range, and expected result in your log.
- Never write hardcoded spreadsheet IDs or credentials to files.

## 8. LINE API Safety

- Never send messages to the LINE API unless explicitly authorized.
- Do not reuse production reply tokens for testing.
- Do not make push API calls unless explicitly requested.
- If the access token or configuration is missing, the LINE helper must fail closed (log safe error codes like `LINE_TOKEN_MISSING` and return).
- Webhook payloads, userIds, and Authorization headers must never be written to general logs.

## 9. Credential Safety

- AI models and operators must NOT read, print, output, copy, or record credential/secret values by default.
- Never read a credential value just to "verify its existence".
- Runtime production code may retrieve credentials from the official Script Properties storage.
- Manual credential access or validation operations are permitted only under explicit owner approval and stage authorization.
- Even if authorized, credentials/secrets must never be written to terminal outputs, Markdown documents, logs, or commit histories.
- If any credential is missing or access fails, the execution must fail closed immediately.
- The `deploy.py --check` validation must never request or output plaintext secrets.
- Legacy directory credentials must remain completely excluded.
- If any credential leak is detected in the workspace, stop immediately.

## 10. Verification Commands

Before concluding a stage, run these verification commands:

```bash
npm run check
python3 deploy.py backend --check
python3 deploy.py line-bot --check
git diff --check
git status --short
git diff --name-only
git diff --stat
git diff --cached
```

- Also execute memory-level simulations and Apps Script validation checks as mandated by the Stage specification.
- Never report `--check` dry-runs as production deployments.

## 11. Commit Sequencing

The commit workflow must follow this sequence:
1. Run preflight checks (ensure clean working tree).
2. Perform required context reads.
3. Perform the implementation changes.
4. Review modifications via `git diff`.
5. Run linting/syntax checks (`npm run check` etc.).
6. Run local simulations to validate results.
7. Stage the allowed files only using `git add`.
8. Review staged changes using `git diff --cached`.
9. Commit staged changes with a descriptive message.
10. Run a post-commit status check to verify clean staging.

- Do not commit without a successful diff review.
- Do not stage unrelated files.
- Do not merge feature changes, governance updates, and deployment closures into a single commit.

## 12. Push Sequencing

- Commit completion does not grant permission to push to remote.
- Pushing to remote must be explicitly allowed by the Stage.
- Before pushing, fetch remote state (`git fetch origin`) and check ahead/behind counts.
- Ensure the working tree is clean and local commits match remote baseline.
- Verify push success by checking `git status -sb`.

## 13. Deploy Sequencing

- Push completion does not grant permission to deploy.
- Deployments must be authorized separately.
- Always run dry-run validation checks before deploying: `deploy.py backend --check` and `deploy.py line-bot --check`.
- Deploy only the designated target module (Backend or LINE Bot). Do not deploy both concurrently unless allowed.
- Record the deployed version number and deployment ID returned by `clasp`.
- Run post-deploy validation checks. If validation credentials are missing, mark the validation status as `BLOCKED`.

## 14. Stop Conditions

Stop immediately if:
- Canonical repository path or workspace identity is uncertain.
- HEAD commit or origin/main ref deviates from expectations.
- Working tree contains uncommitted/untracked changes before start.
- Contradictory instructions exist in documents.
- The Stage baseline is obsolete or superseded by newer commits.
- Modification is required on files outside the allowed list.
- Unplanned Google Sheet writes or LINE API calls are needed.
- Credential leak or token exposure is detected.
- Dry-run checks or test simulation fails.
- Rebase, reset, or force push is required.

## 15. AI and Session Handover

Every time an AI model or session takes over the project:
1. Do not trust paths or commits mentioned in the conversation transcript.
2. Run the repository identity verification commands.
3. Read the required files in order (beginning with `AGENTS.md`).
4. Read `docs/stages/CURRENT_HANDOFF.md` and check the latest Git log commits.
5. Identify if the current codebase has already progressed beyond the requested task.
6. Record any unfinished work in the handoff files.
7. Output the Context verification report at the start of your turn.

## 16. Current Known Technical Limits

- **Same-Series Substitutes Size Unit Heuristics**: The dimension parser uses heuristics to align sizes. When comparing dimensions, input sizes where the maximum edge is greater than or equal to 150 (e.g. `119x244 cm`) might be parsed and mapped to `11.9x24.4 cm`.
- **Exact matching behavior**: Currently, exact size matches and near matches do not cause recommendation leakage because they convert consistently, but unit normalization must be carefully verified.
- Do not claim this limit is resolved or risk-free.
- Do not attempt to fix or modify this unit parsing logic unless explicitly requested by a specific stage.

## 17. Handoff Report Template

```text
【Project Context Gate】
- canonical root: [path]
- branch: [branch-name]
- HEAD / origin: [commit-hash]
- AGENTS read: [yes/no]
- README read: [yes/no]
- PROJECT_BOUNDARIES read: [yes/no]
- CURRENT_HANDOFF read: [yes/no]
- relevant Stage docs read: [yes/no]
- conflicts: [none/details]
- current stage: [stage-name]
- safe to continue: [yes/no]

【Execution Safety】
- files modified: [list]
- Sheet modified: [yes/no]
- LINE API called: [yes/no]
- Token accessed: [yes/no]
- staged: [yes/no]
- committed: [yes/no]
- pushed: [yes/no]
- deployed: [yes/no]
- blockers: [details]
- warnings: [details]
```
