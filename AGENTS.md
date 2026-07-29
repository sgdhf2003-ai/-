# Repository Agent Instructions

This repository is the canonical `jingyang-sales-app` workspace when located at:

`/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`

## Cross-Agent Operating Rules

These rules apply to Codex, Gemini, Antigravity, and any future coding agent working on this repository. `AGENTS.md` is the source of truth for cross-agent project governance. Tool-specific rule files, if present, must point back to this file instead of redefining conflicting rules.

### Canonical Repository

- Canonical repo path: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
- Canonical branch: `main`
- Old Documents paths, Developer checkouts, scratch workspaces, and other exported copies are stale, backup, or non-canonical unless the Owner explicitly states otherwise for a specific stage.
- Scratch workspace is temporary only and must not be treated as official storage.
- All durable JYAI project data, generated docs, stage notes, handoff notes, specs, plans, tasks, reports, memory records, and organized project information must be saved inside the canonical cloud-drive checkout, not scratch workspace or chat memory.
- Default storage policy: all created or updated project data, documents, plans, reports, specs, handoff notes, memory notes, exported artifacts, and organized working materials must be saved in the Owner's local cloud-drive-backed project checkout by default.
- For this Owner, "local cloud-drive-backed project checkout" means the macOS Google Drive for desktop synced folder at the canonical repo path. It does not mean iOS/mobile app storage and does not mean a transient scratch workspace.
- Local-only scratch, temp, cache, build, or dependency paths are allowed only when technically required or fully reproducible.
- Any local-only intermediate that becomes handoff, audit, or future-work material must be copied or summarized back into the canonical cloud-drive checkout before completion.
- If a workbench cannot access the cloud-drive checkout, create only a transfer-ready draft and clearly state that it must be copied into the project-root `AGENTS.md` or the proper docs path before it becomes authoritative.
- Do not modify, test, deploy, commit, or push from stale or backup paths.
- If path identity is unclear, stop and report `BLOCKED`.
- Contract-first workflow applies before allocation, reservation, fulfillment, Google Sheet persistence, Apps Script, LINE Bot, deploy wrapper, or any production-side-effect change.

### Mandatory Preflight

Before any audit, implementation, verification, commit, push, or deployment decision, run and verify:

```bash
cd "/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app"
pwd
git rev-parse --show-toplevel
git branch --show-current
git status -sb
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count HEAD...origin/main
```

For implementation, commit, push, or deploy work, also run `git fetch origin` before final HEAD/origin comparison.

### Required Governance Reads

Before audit or implementation, read these files from the canonical repo:

1. `AGENTS.md`
2. `README.md`
3. `PROJECT_BOUNDARIES.md`
4. `docs/stages/CURRENT_HANDOFF.md`
5. `docs/allocation-assistant/CURRENT_HANDOFF.md`
6. `docs/allocation-assistant/CHANGELOG.md`
7. `docs/allocation-assistant/ROADMAP.md`
8. Any stage-specific spec, design note, or source file named by the Owner.

Do not rely on a chat transcript, tool memory, or a stale handoff as the only source of project state.

### Explicit Owner Approval Required

The following actions are forbidden unless the Owner explicitly approves them in the current stage:

- Backend deploy.
- LINE Bot deploy.
- `clasp push`, `clasp pull`, `clasp version`, or `clasp deploy`.
- Google Sheet writes, schema edits, trigger edits, or Script Properties edits.
- LINE API calls, including reply, push, rich menu mutation, or live webhook tests.
- Token, secret, credential access, credential verification, or rotation.
- Git commit or push.

Approval for one action does not imply approval for another. A dry-run check is not a deployment approval.

### Allowed Dry-Run Checks

These commands are allowed when they match the active stage and remain non-mutating:

```bash
npm run simulate:all
python3 deploy.py backend --check
python3 deploy.py line-bot --check
git diff --check
```

`deploy.py --check` must remain dry-run only: no clasp subprocess, no push, no version creation, and no deploy.

### Product North Star

- Core user: Sales Assistant / Admin, not generic sales reps.
- Product position: 配貨與出貨資料自動化管理助手.
- Core loop: Inbound 去保留 -> Outbound 待出貨銷扣.
- Agent work must simplify the admin-assistant workflow and preserve the allocation, reservation, shipment, and inventory-deduction loop.

### Current Known State

- Stage 24-A documentation/governance cleanup: complete.
- Backend Web App production record: Version 78.
- LINE Bot production record: Version 191.
- Latest verified simulation baseline: `npm run simulate:all` = 149 / 149 PASS.
- Latest verified handoff: `main` synced with `origin/main` at the recorded baseline; re-run preflight before relying on this.

### Remaining Stage 24-B Warnings

- Formal hold writeback persistence contract is not fully proven.
- Canonical `holds` schema mapping must be aligned.
- Fulfillment Sheet status update and inventory snapshot persistence are not fully proven.
- `JingyangAssistant` fallback spreadsheet ID must be confirmed or aligned with the 115 inventory spreadsheet.

## 1. Canonical Workspace

- **Canonical Path**: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
- **Canonical Branch**: `main`
- **Canonical Remote**: `https://github.com/sgdhf2003-ai/-.git`
- **Stale Clone Paths**: `/Users/chenhaoan/Developer/JYAI-Independent-Repos/jingyang-sales-app`, `/Users/chenhaoan/Documents/JYAI-Independent-Repos/jingyang-sales-app`, `/Users/chenhaoan/Documents/jingyang-sales-app`, scratch workspaces, and exported copies unless the Owner explicitly reassigns the project root.
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

## 18. Decision-Making Protocol (決策行為規範)

### Socratic Red/Blue Team Decision Protocol (蘇格拉底紅藍隊決策協定)

凡是遇到技術架構選擇、階段推進方向、功能範疇取捨或策略選擇等重大決策時，AI Planner / Brain 必須自動啟動以下機制：
1. **預設觸發「蘇格拉底提問法 (Socratic Method)」**：透過提問法挖出隱性風險、邊界假設與架構盲點。
2. **自動扮演雙方觀點**：
   - 🔴 **紅隊 (挑戰者 / 風險控管)**：質疑執行階段脆弱性、認知落差、邊界極限、架構碎片化與維護成本。
   - 🔵 **藍隊 (建設者 / 商業價值)**：主張商業效益落地、使用者真實體驗、漸進式轉移價值與開發節奏。
3. **進行多輪詰問辯論**：經由交鋒提煉出兼顧安全與價值的「最佳進化方案 (Option A+ / Optimized Master Plan)」。
4. **輸出決策摘要**：向 Owner 呈報對比總覽、紅藍辯論突破口、優缺點分析與最終建議，待 Owner 確認後方可發送實作 Token。

## 19. Handoff Report Template

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
