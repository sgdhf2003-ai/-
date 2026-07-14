# Stage 16 – Work Center MVP Stability Closure Note

## 1. Purpose
- 封存 Work Center / 任務中心 MVP 穩定狀態。
- 依據 Stage 16-A read-only audit 結果，確認所有核心功能、權限、以及安全校驗均運作正常。
- 本 Closure Note 不代表功能完成最終版，而是 MVP baseline stable (最基本可行產品的穩定基準線)。

## 2. Current Baseline
- **Latest Commit**: `a633c6b docs: add stage 15 dashboard closure`
- **Repo Status**: Clean (no uncommitted or untracked changes before note creation).
- **Backend Check**: Passed (Apps Script clasp dry-run successful).
- **LINE Bot Check**: Passed (LINE Bot Apps Script clasp dry-run successful).
- **NPM Check**: Passed (app.js & service-worker.js node syntax check successful).

## 3. Backend Task API Inventory
- **createTask(data)**: Handles task registration, parses attributes, validates formatting, and writes records to Google Sheets.
- **appendTaskNote(data)**: Formats and logs comments with operators, roles, and timestamps. Restricted on completed or archived items.
- **updateTaskStatus(data)**: Modifies state values with audit trail logging.
- **updateTaskFields(data)**: Updates whitelisted parameters while enforcing strict optimistic lock checking.
- **Permission Helpers**:
  - `canUserCreateTask_`: Validates if a user role is authorized to assign a target role or individual.
  - `canUserUpdateTask_`: Verifies status-change authorization relative to assignees and creators.
  - `canUserEditTaskFields_`: Restricts edit permissions to whitelisted fields for respective roles.
- **Validation & Sanitization**: Implements text sanitizers (`sanitizeTaskText_`) to prevent cell-injection or malicious content.
- **Audit Log**: Employs backend `appendAuditLog_` logs to record all creation, modification, status updates, and comments.
- **Optimistic Locking**: Validates matching `updatedAt` timestamps between payload and database to prevent concurrent write overrides.
- **Whitelisted Editable Fields**: Only allows updates to: `title`, `description`, `customerName`, `productName`, `quantity`, `priority`, `dueDate`, `assignedRole`, and `assignedTo`.
- **Strict Status Reason Whitelist**: Enforces pre-approved reasons (`isAllowedTaskStatusReason_`) when placing a task into `Blocked` or `Waiting` status.

## 4. Frontend Work Center Inventory
- **Task List**: Scrollable visual list displaying task items.
- **Search**: Keyword search query matching titles, descriptions, and text.
- **Filters**: Role-based, status-based, assignee-based, and date-based list filters.
- **Quick Presets**: Chip navigation targeting specific views (mine, waiting, blocked, today, overdue, next7Days, completed, assistantActive, highPriority).
- **Summary Cards**: Statistical header cards acting as interactive filters.
- **今日焦點**: High-priority focus area rendering metrics for Blocked, Waiting, Overdue, and Urgent items.
- **Customer Context**: Auto-resolves customer codes and store entities, rendering contact details or showing warning tags for unmatched stores.
- **Next Action Badges**: Contextual recommendations for next tasks (e.g. "備註", "處理異常", "確認型號").
- **Smart Sort**: Priority-based sorting utilizing due date closeness, status priorities, and assigned roles.
- **Lazy Detail Rendering**: Memory-efficient detail panels generated only on expansion to prevent DOM bloat.
- **Edit Modal**: Dedicated popup modal containing fields for whitelisted task properties.
- **Note Append UI**: Simple input fields inside cards allowing rapid note insertion without state transitions.
- **Status Actions**: Direct action buttons to advance, wait, block, or cancel tasks.
- **Blocked / Waiting / Completed Flows**: Tailored dropdown flows capturing whitelisted status reasons.
- **Mobile Layout Fixes**: Zero-margin CSS patches and flex layouts preventing scroll breaks.

## 5. Routing / Cache / UX
- **setView / activeView**: Standard SPA routing framework saving current active tabs.
- **Tasks Route Entry**: Stable view navigation and validation.
- **Service Worker Cache**: Explicitly tracks and registers `index.html`, `styles.css?v=...`, `app.js?v=...`, and asset versions.
- **Mobile Viewport/Topbar Overflow**: Removed negative side offsets and added global `overflow-x: hidden` protections.
- **Bottom Nav**: Fixed footer layout.
- **Work Center Dashboard**: Unified dashboard view displaying cards and focus metrics.

## 6. Preserved Systems
- **Backend**: Untouched during Stage 16-A audit.
- **LINE Bot**: Untouched during Stage 16-A audit.
- **Schema**: Google Sheet fields and data structures are fully preserved.
- **Payload**: No API contract, endpoint payload format, or parameters altered.
- **Permission**: No access controls, roles, or rules altered.
- **Routing**: Client-side application routes and view elements remain unchanged.
- **Deployment Config**: Google App Script clasp settings (`.clasp.json`) and scripts preserved.
- **Secrets/Token/API Key**: Tokens, channel secret codes, and IDs remain unchanged.

## 7. Known Risks
- **Concurrency Overwrites**: Large teams editing the same task simultaneously may trigger version conflicts (optimistic lock rejection).
- **Browser Automation Absence**: Visual flow testing depends on manual user validation due to lack of local selenium/puppeteer integration.
- **Real-User Validation**: Requires field testing under varied mobile network conditions to verify sync performance.
- **Rule-Based Focus**: Dashboard stats are rule-based and query-driven, not AI-predicted.
- **Activity Feed Lack**: No global activity feed stream is currently integrated.
- **Notification Workflows**: Auto-reminders or push-notification schedules are not fully integrated for due-date changes.
- **Daily Briefing**: No daily sales agenda summary exists yet.

## 8. Recommended Next Directions
- **Operations & Real-User Feedback**: Deploy PWA to a small focus group of sales personnel and assistants to gather UX and stability logs.
- **Subsequent Stages**:
  - *Recent Activity Feed*: Implement global log views.
  - *Notification / Reminder*: Enable background push triggers.
  - *Daily Sales Brief*: Weekly/daily scheduler emails or LINE digests.
  - *Task Assignment Quality*: Advanced assignment flow metrics.
- *Note*: High-risk changes touching LINE Bot code, backend schema, or custom Google Apps Script triggers should be compartmentalized into isolated stages.

## 9. Final Conclusion
- **Work Center MVP Stable**: **Yes**
- **Stage 16-A Audit**: Passed
- **Stage 16-B Baseline**: Properly documented and closed.
