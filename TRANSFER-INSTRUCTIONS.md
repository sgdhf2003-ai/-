# Canonical Workbench Fix — Transfer Instructions

This workspace cannot access the Mac Google Drive checkout, so the installer
must be run once from the actual canonical repository.

From the Mac workbench, copy `install-workbench-governance.sh` into the
canonical repo root and run:

```bash
cd "/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app"
bash ./install-workbench-governance.sh
scripts/workbench-context-gate.sh --check
git diff --check
git status -sb
```

Review the diff. If correct, commit and push it from the canonical checkout:

```bash
git add AGENTS.md scripts/workbench-context-gate.sh docs/workbench/RECOVERY_WORKFLOW.md .workbench/canonical-root
git commit -m "chore: add cross-workbench context gate"
git push origin main
```

The installer is idempotent: rerunning it does not duplicate the marked
`AGENTS.md` section. It does not deploy, write Google Sheets, call LINE, read
secrets, or alter production configuration.

After the push, a new workbench can clone the private `origin` into a temporary
recovery directory and run the gate. It will report `RECOVERY_OR_UNKNOWN`
instead of silently treating scratch as canonical.
