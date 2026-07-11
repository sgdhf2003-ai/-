# Stage 12-F Next Action Badges Closure

## 1. Stage 12-F 功能範圍
- 在任務卡顯示 compact next action badges。
- 在任務詳情顯示完整「下一步建議」。
- 只使用既有 task 欄位。
- read-only，不改任務資料。

## 2. Badge rules
- 已完成 / 已取消任務只顯示完成類 badge。
- 已完成 / 已取消不顯示已逾期、今天處理、近期處理、高優先。
- active overdue 顯示已逾期。
- active today 顯示今天處理。
- active next 7 days 顯示近期處理。
- blocked / blockedReason 顯示異常需回報。
- waiting 顯示等資料。
- urgent / high / 高 / 緊急 顯示高優先。

## 3. 已新增 helpers
- `getTaskNextActionBadges_`
- `renderTaskNextActionBadges_`

## 4. 安全保護
- 所有輸出經 `escapeHtml`。
- 不注入 raw note。
- 不注入 raw blockedReason。
- 不注入 raw task field。
- no backend call。
- no schema change。
- no task mutation。

## 5. 影響範圍
- modified `app.js` / `styles.css` only。
- backend untouched。
- LINE Bot untouched。

## 6. 部署方式
- frontend: Git push `main` -> Vercel。
- backend deploy not needed。

## 7. AI 模擬驗收
- completed task: passed。
- cancelled task: passed。
- overdue active task: passed。
- today active task: passed。
- next 7 days task: passed。
- blocked task: passed。
- waiting task: passed。
- high priority task: passed。
- compact density: passed。
- HTML escaping: passed。
- customer context regression: passed。
- create/edit/note/status regression: passed。
- summary/quick presets/filters regression: passed。

## 8. 使用者實機驗收
- 進入工作任務正常。
- 任務卡出現 next action badge。
- 展開任務可看到「下一步建議」。
- 已完成 / 已取消不顯示錯誤 temporal badges。
- 逾期 / 今日 / 近期 / 異常 / 等資料 / 高優先顯示合理。
- 客戶 context 正常。
- summary cards / quick presets / filters 正常。

## 9. 後續注意
- badges 是業務提示，不是任務狀態本身。
- 不自動改排序。
- 不自動改任務資料。
- 若日後要調整排序或規則，需重新跑 AI simulation + manual validation。
