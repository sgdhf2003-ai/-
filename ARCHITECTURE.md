# JYAI Sales App Architecture

## Canonical Workspace

The canonical project checkout is:

`/Users/chenhaoan/Library/CloudStorage/GoogleDrive-sgdhf2003@gmail.com/我的雲端硬碟/jingyang-sales-app`

Old Developer, Documents, scratch, and exported checkouts are stale or backup locations unless the Owner explicitly reassigns the project root for a stage.

## Product North Star

- Primary operator: Sales Assistant / Admin.
- Product position: 配貨與出貨資料自動化管理助手.
- Core loop: Inbound 去保留 -> Outbound 待出貨銷扣.
- System goal: keep allocation, reservation, fulfillment, and inventory-deduction records consistent with minimal manual reconciliation.

## Runtime Surfaces

| Surface | Source path | Role | Production side effects |
| --- | --- | --- | --- |
| PWA / Business Manager UI | root `index.html`, `app.js`, `styles.css` | Mobile-first work surface and sandbox UI | None unless connected to approved backend flows |
| Backend Apps Script | `google-apps-script/` | Web App backend, Sheet schema, allocation sandbox mounting | Sheet and backend writes only with Owner-approved deploy/write stages |
| LINE Bot Apps Script | `line-bot-apps-script/src/` | LINE webhook, assistant entrypoint, text/image workflow | LINE API calls only with explicit Owner approval |
| Allocation Assistant core | `allocation-assistant/` | OCR, allocation, writeback contracts, fulfillment adapters | Must fail closed unless persistence adapter is explicitly proven |
| Simulations | `tests/simulations/` | Local contract and workflow evidence | Read-only local validation |

## Source-of-Truth Documents

Read these before audit, implementation, commit, push, or deploy decisions:

1. `AGENTS.md`
2. `PROJECT_BOUNDARIES.md`
3. `docs/DECISIONS.md`
4. `docs/stages/CURRENT_HANDOFF.md`
5. `docs/allocation-assistant/CURRENT_HANDOFF.md`
6. `docs/stages/stage-24-b3-production-contract-spec.md` for persistence contract work
7. `docs/ai/README.md` for AI-facing document navigation

## Allocation Assistant Layers

| Layer | Main files | Responsibility |
| --- | --- | --- |
| Contracts | `allocation-assistant/contracts/` | Tenant, draft, inventory, suggestion, audit, and sync data contracts |
| Gateway | `allocation-assistant/gateway/allocation-gateway.js` | Provider routing and fail-closed entrypoint |
| Providers | `allocation-assistant/providers/` | Simulation and disabled external provider boundaries |
| Read-only inventory | `allocation-assistant/adapters/*inventory*` | Sheet row mapping and mock/read-only inventory snapshots |
| Formal writeback | `allocation-assistant/adapters/formal-hold-writeback-adapter.js` | Reservation number, header-name row mapping, fail-closed writeback contract |
| Fulfillment | `allocation-assistant/fulfillment/fulfillment-adapter.js` | Full, partial, and cancel/release persistence boundary |
| UI/OCR | `allocation-assistant/ui/`, `allocation-assistant/ocr/` | OCR candidate matching, LIFF micro edit, sandbox UI state |

## Safety Boundaries

- `deploy.py --check` is dry-run validation only and must not execute clasp subprocesses.
- `clasp push`, `clasp pull`, `clasp version`, and `clasp deploy` require explicit Owner approval.
- Google Sheet writes, Script Properties changes, LINE API calls, token/secret access, commit, and push each require separate explicit Owner approval.
- Mock adapters are allowed only through explicit test or simulation injection.
- Production persistence must fail closed when the real adapter, headers, permissions, or confirmation readback are missing.

## Open Architecture Decisions

- `CANCEL_RELEASE` ledger semantics remain open: decide whether ledger `quantity` should be `0` with released amount in `remainingQuantity`, or whether `quantity` should equal released quantity.
- Live formal hold writeback and fulfillment persistence wiring must not proceed until Stage 24-B3 contract evidence is accepted and a later stage authorizes production-side work.
