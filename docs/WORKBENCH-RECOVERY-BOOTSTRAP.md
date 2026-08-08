# JYAI Workbench Recovery Bootstrap

This workbench cannot see the Mac Google Drive path directly. Use the local
recovery checkout only for cross-workbench reading, audit, simulation, and
transfer-ready drafts.

## Source of truth

- GitHub repository: `https://github.com/sgdhf2003-ai/-.git`
- Branch: `main`
- Mac canonical repo: `/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`
- Local recovery checkout: `./recovery-jingyang-sales-app`

## Safety boundary

The recovery checkout is not the canonical cloud-drive repo. Do not commit,
push, deploy, write Google Sheets, call LINE APIs, or access secrets from it
without explicit owner approval and a verified project handoff.

## Verified on 2026-08-08

- GitHub identity: `sgdhf2003-ai`
- Repository permissions: `admin`, `maintain`, `pull`, `push`, `triage`
- Recovery checkout HEAD and `origin/main`: `0074777d1beb17a47d29f684480a0ad33354c762`
- Context gate: `PASS`
- Checkout kind: `RECOVERY_OR_UNKNOWN`
- Recovery working tree: clean

At the start of a new workbench session, run:

```bash
./bootstrap-recovery.sh
```

Then read `recovery-jingyang-sales-app/AGENTS.md` and the required handoff
files before any project analysis. Any durable project change must be copied
to the Mac canonical checkout and verified there before it becomes official.
