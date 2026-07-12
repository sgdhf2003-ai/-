Stage 13-B Lazy Detail Panel Rendering

1. Stage summary

- Stage 13-B Lazy Detail Panel Rendering
- Frontend-only performance optimization
- Goal: reduce initial Work Center task list render cost

2. Implementation summary

- Commit: `bddf5e7 perf: lazy render task detail panels`
- Modified file: `app.js`
- Added `renderTaskDetail_(task, renderCache = null)`
- Extracted `TASK_TYPE_LABELS`, `TASK_PRIORITY_LABELS`, `formatTaskDate_()`, and `formatTaskRole_()`
- `renderTasks()` now renders compact task cards plus empty detail panel placeholders
- Detail content is generated only on first `查看詳情`
- Collapsed detail remains cached in DOM until the next full render
- Full render resets lazy detail placeholders

3. Preserved behavior

- Customer context detail preserved
- Next action detail preserved
- Audit/history preserved
- Notes/actions preserved
- Delegated handlers preserved
- Filters/presets/summary unchanged
- Smart sort unchanged
- Default sort unchanged
- Create/edit/note/status payload unchanged
- Login/init flow unchanged

4. Validation

- Stage 13-B1 AI simulation passed
- Stage 13-B2 review safe
- Stage 13-B3 pushed to `main`
- Vercel frontend deployment expected
- User manual validation passed:
  - 工作任務列表速度有變快
  - 查看詳情正常
  - 收合再展開正常
  - 下一步建議、客戶資訊、歷程、備註、按鈕正常

5. Deploy impact

- Frontend deployed by Git push `main` -> Vercel
- Backend deploy not needed
- LINE Bot deploy not needed
- Schema unchanged

6. Known limits / follow-up

- `renderTasks()` still does a full-list DOM rebuild
- First expand still pays one-task detail render cost
- No browser automation was run; manual validation passed
- No further optimization needed now unless slowdown returns
