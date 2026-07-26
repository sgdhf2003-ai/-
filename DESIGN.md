# JYAI Sales App Design

## Product Design Principle

The app is for Sales Assistant / Admin operators managing allocation and fulfillment records, not generic sales reps. The interface and workflow should reduce manual reconciliation across photos, holds, outbound shipment actions, and inventory snapshots.

## Primary Workflow

1. Inbound evidence arrives through text, LINE image, or assistant-entered order details.
2. OCR and product matching normalize the item and quantity.
3. The assistant reviews low-confidence OCR with candidate buttons and LIFF micro edits.
4. Confirmed allocation creates a formal hold contract.
5. Outbound fulfillment closes the loop through full shipment, partial shipment, or cancel/release.
6. Sheet rows, internal records, returned objects, and logs must agree before any success claim.

## Interaction Standards

- Keep the assistant's primary action path short and explicit.
- Require confirmation for ambiguous OCR, large quantity, stock overflow, and partial shipment quantity.
- Do not silently turn partial shipment into full close.
- Show failure as actionable admin state, not as successful persistence.
- Prefer structured buttons and known commands over free-form-only flows for critical operations.

## Documentation Map

| Document | Purpose |
| --- | --- |
| `ARCHITECTURE.md` | System architecture, source boundaries, and persistence safety model |
| `PROJECT_BOUNDARIES.md` | Canonical checkout and deployment boundaries |
| `docs/DECISIONS.md` | Durable project decisions |
| `docs/MEMORY.md` | Project-local memory and handoff index |
| `docs/ai/README.md` | AI agent navigation map |
| `docs/ai/SKILL.md` | Repeatable local agent workflow |
| `docs/allocation-assistant/README.md` | Allocation Assistant module overview |
| `docs/stages/stage-24-b3-production-contract-spec.md` | Production persistence contract spec |

## Stage 24-DOCS-A Boundary

This stage is documentation and governance structure only.

Allowed:

- Add architecture, design, memory, and AI navigation docs.
- Align active governance files away from stale Developer/Documents paths.
- Update current handoff to record the docs stage.
- Run read-only simulations and deploy dry-run checks.

Forbidden without separate Owner approval:

- Stage 24-B4 implementation.
- Production deploy.
- Google Sheet writes.
- LINE API calls.
- Token or secret access.
- Commit or push.

## Open Product Decision

Before live fulfillment persistence wiring, the Owner must decide `CANCEL_RELEASE` ledger semantics:

- Option A: `quantity` is `0`, released amount is in `remainingQuantity`.
- Option B: `quantity` equals released quantity, with `remainingQuantity` retained for audit clarity.
