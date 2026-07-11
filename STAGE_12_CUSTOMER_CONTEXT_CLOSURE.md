# Stage 12 Customer Context Closure

## 1. 功能範圍

- 在 Work Center 任務卡與任務詳情顯示 read-only 客戶 context。
- 顯示既有 store data，例如電話、地址、聯絡人、區域、負責人與店家狀態。

## 2. 安全匹配規則

- exact normalized match 優先。
- 只有唯一的 high-confidence name/code/shortName match 才顯示 contact fields。
- ambiguous match 不顯示電話或地址。
- no match 不顯示 contact fields。

## 3. 新增 Helpers

- `normalizeCustomerLookupText_`
- `resolveTaskCustomerStore_`
- `renderTaskCustomerContext_`

## 4. 安全保護

- 所有輸出都使用 `escapeHtml`。
- 不新增 backend call。
- 不修改 Google Sheets schema。
- 不修改 task 或 store data。
- ambiguous/no match 不暴露電話或地址。

## 5. 影響範圍

- 只修改 `app.js` 與 `styles.css`。
- backend untouched。
- LINE Bot untouched。

## 6. 部署方式

- frontend: Git push `main` -> Vercel deployment。
- backend deploy not needed。

## 7. 使用者驗收

- Vercel frontend deployed。
- 使用者實測回報「沒問題」。

## 8. AI 模擬驗收

- exact match: passed，安全顯示 contact fields。
- no match: passed，contact fields hidden。
- ambiguous match: passed，contact fields hidden。
- unique code/shortName match: passed。
- HTML escaping: passed。
- create/edit/note/status regression: unchanged。
- summary/quick presets/filters regression: unchanged。

## 9. 後續注意

- matching intentionally conservative。
- legitimate store 若 name/code/shortName 不清楚，可能顯示「未連結店家資料」。
- ambiguous match 永遠不可暴露電話或地址。
- AI simulation 未另外自動化 browser DOM rendering；使用者 manual validation 已通過。

