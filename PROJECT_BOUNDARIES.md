# Project Boundaries and Source of Truth Guidelines

This document establishes the official boundaries for the Jingyang Sales Assistant system files and deployments.

## 1. Directory Roles

* **Official Workspace & Source of Truth**:
  * **Path**: `/Users/chenhaoan/Documents/jingyang-sales-app`
  * **Role**: This is the **only** official repository for all source code. All modifications, testing, and deployments must be executed from this directory.
  * **Subdirectories**:
    * `google-apps-script/`: Source code for the PWA Backend Apps Script project (Script ID: `1vRepq_HNkjbs8vRQvbkkDE8unGPHfksfhOTrkrNZthFZHs2GSHO8Gasc`).
    * `line-bot-apps-script/`: Source code for the LINE Bot Apps Script project (Script ID: `19rYFpT-RE77oT52QfFIpIBqjcXSWemKRs0ClExMXo0lImf_OFb_DJ_AD`).
    * `line-bot-apps-script/legacy/`: Archive directory for previous implementations (excluded from deployments).

* **Product Planning & Documentation**:
  * **Path**: `/Users/chenhaoan/Documents/JYAI-Platform`
  * **Role**: strictly for Product Bibles, workflows, QA logs, SOPs, and project roadmaps. **No source code changes or deployments should be made here.**

* **Legacy Archive**:
  * **Path**: `/Users/chenhaoan/Desktop/ＡＩ/line機器人`
  * **Role**: Deprecated/archive directory. **Do not modify or deploy from this folder.**

---

## 2. Deployment Governance Rules

1. **No Cross-Project Pushing**:
   Deployments must only be performed from `/Users/chenhaoan/Documents/jingyang-sales-app` using the `deploy.py` script.
2. **Configuration Validation**:
   Every deployment reads and validates settings from `deployment.config.json`. Pushes to incorrect Script IDs or Deployment IDs are blocked automatically.
3. **Preserve URL**:
   Web App deployments must update the existing Deployment IDs (`AKfycb...`) to maintain the active webhook URLs (`/exec`). Never create new deployment IDs for existing channels.
4. **Collision Prevention**:
   The `line-bot-apps-script/legacy` folder is physically kept out of the source `src/` folder to prevent global namespace function collisions on Google Apps Script.

## 3. Credential Governance Rules

1. **LINE Credential Storage**:
   LINE channel credentials must only live in Apps Script Script Properties. Do not hardcode tokens in source, legacy archives, backups, docs, or test fixtures.
2. **Legacy Upload Block**:
   `line-bot-apps-script/legacy/` must never enter any clasp, deploy, or upload scope. `deploy.py --check` must stop if legacy files appear in the upload candidate list.
3. **Secret Guard**:
   `deploy.py --check` must stop on high-confidence secret literals and report only masked metadata. Public deployment IDs and web app URLs are not credentials.
4. **Tooling Boundaries**:
   Codex, Godex, Antigravity, and other automation must not request, read, print, or verify production LINE tokens.
5. **Fail Closed**:
   LINE API helpers must not call LINE APIs when the channel token is missing. They should log a safe error code such as `LINE_TOKEN_MISSING` without exposing token content.
6. **Rotation Scope**:
   Secret rotation is an incident response action. Security hardening changes do not imply that a LINE token has been rotated.
