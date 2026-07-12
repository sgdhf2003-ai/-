# Stage 12-H Smart Sorting Closure

## 1. Stage 12-H 功能範圍
- 在工作任務排序選單新增「智慧排序」。
- `value="smart"`。
- non-default option。
- 不改預設排序。
- read-only sorting，不改任務資料。

## 2. Smart sort precedence
- blocked / blockedReason
- overdue active task
- today active task
- waiting task
- high priority
- next 7 days
- other active tasks
- completed / cancelled tasks last

## 3. Tie-breakers
- dueDate earlier first
- priority urgent > high > normal > low
- updatedAt newer first
- createdAt newer first
- stable fallback by id/title/original index

## 4. 已新增 helpers
- `getTaskPriorityWeight_`
- `getTaskSmartSortRank_`
- `compareTaskSmartOrder_`

## 5. 安全保護
- default sort unchanged
- smart sort only when `sortKey === "smart"`
- smart sort only reorders filtered subset
- does not add/remove tasks
- no backend call
- no schema change
- no task mutation

## 6. 影響範圍
- modified `app.js` / `index.html` only
- backend untouched
- LINE Bot untouched
- service-worker untouched
- styles.css untouched

## 7. 部署方式
- frontend: Git push `main` -> Vercel
- backend deploy not needed

## 8. AI 模擬驗收
- precedence order passed
- blockedReason-only rank passed
- completed/cancelled last passed
- dueDate tie-breaker passed
- priority tie-breaker passed
- updatedAt tie-breaker passed
- createdAt tie-breaker passed
- stable fallback passed
- default sort unchanged passed
- filter interaction passed
- customer context regression passed
- next action badges regression passed
- create/edit/note/status regression passed
- summary/quick presets/filters regression passed

## 9. 使用者實機驗收
- 「智慧排序」已出現在排序選單
- 使用者已切換並查看工作任務
- 任務詳情正常
- 下一步建議正常
- 已完成任務只顯示完成類建議
- 已完成任務沒有錯誤顯示已逾期 / 今天處理 / 近期處理 / 高優先
- customer context 正常
- summary cards / quick presets / filters 正常

## 10. 後續注意
- blockedReason alone 會提升到最高優先，這是本階段設計
- badges 是提示，smart sorting 是排序，不會改任務狀態
- 若日後要集中 finished/cancelled 判斷 helper，需另開 cleanup stage
- 若日後要改成預設智慧排序，必須重新 user validation

## 11. Performance concern
- 使用者曾回報登入後與進入工作任務變慢。
- 因此 Smart Sorting closure 一度暫停，先改做效能調查與優化確認。

## 12. Stage 12-I Performance Investigation
- root cause likely frontend render cost。
- customer context 存在 repeated matching，接近 `O(tasks * stores)`。
- next action badges 在 compact/detail mode 有 duplicated calculation。
- smart sort comparator 會重複計算 rank / dueDate / priority / timestamps。
- login/init repeated render 也被記錄為風險，但 Pass 1 沒有修改該路徑。

## 13. Stage 12-J Performance Optimization Pass 1
- commit: `e795287 perf: cache task rendering computations`
- store lookup index/cache added。
- customer context card/detail shared resolved result。
- next action badge cache added。
- smart sort metadata precompute added。
- login/init flow unchanged。
- backend untouched。
- LINE Bot untouched。

## 14. User validation after performance optimization
- `e795287` 已 push，frontend Vercel deployment expected / applied。
- 使用者確認效能有改善。
- 使用者確認其他功能正常。

## 15. Follow-up note
- `renderTasks()` 仍是 full-list rerender。
- detail panel eager HTML build 仍可作為 Pass 2 target。
- 目前不需要做 Pass 2，因為使用者已回報改善。
- 若之後 slowdown 再出現，從新的 Stage 12-K small investigation 開始。

