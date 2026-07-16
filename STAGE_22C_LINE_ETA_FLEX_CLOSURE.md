# Stage 22-C LINE ETA and Compact Flex Card Closure

## 1. Purpose

Stage 22-C addressed a confirmed gap in the LINE customer product query flow:

- LINE product queries could detect insufficient stock, but did not show ETA arrival information.
- `商品 + 數量` queries were not a parser problem.
- An ETA reader already existed in the web data path, but it was not connected to LINE `searchInventory()`.
- Substitute recommendation was not implemented at the time and was handled as a separate feature track.

The goal for this stage was:

- Show arrival date and quantity when a product is out of stock or requested quantity is greater than available stock.
- Preserve the original inventory reply.
- Ensure ETA lookup failure never interrupts the product query reply.
- Present ETA as a clear but compact Flex card.

## 2. Investigation Findings

- LINE entry: `line-bot-apps-script/src/line程式碼.gs`
- Product query function: `searchInventory()`
- Product + quantity parsing was confirmed to work.
- The original LINE shortage path had no ETA lookup or ETA render block.
- ETA data source: `到港貨物庫存`
- ETA and substitute recommendation are separate features.
- Fuzzy model candidates are not a formal substitute recommendation feature.

## 3. Confirmed Sheet Contract

ETA worksheet: `到港貨物庫存`

Columns:

- A: `規格/系列`
- B: `型號/品名`
- C: `數量1(板/棧)`
- D: `數量2(總片數)`
- E: `日期`

Contract:

- ETA model matching uses column B.
- Matching uses `getModelCodeKey()` normalized exact match.
- Column D is displayed as pieces: `片`.
- Column C is not displayed to customers.
- Column E is treated as date-only.
- Spreadsheet timezone is `America/Los_Angeles`; customer date decisions use `Asia/Taipei`.
- No Google Sheet schema change was made.

## 4. ETA Implementation

Commit:

- `645e1b26630fbb5d61c36e6c29f2e32a3c1925fa`
- `feat: add shortage eta to line inventory replies`

Behavior:

- `IN_STOCK`: does not look up ETA.
- `INSUFFICIENT_STOCK`: looks up ETA.
- `OUT_OF_STOCK`: looks up ETA.
- `UNKNOWN_STOCK`: does not look up ETA.
- Uses normalized exact match only.
- Shows at most two future arrivals.
- Sorts arrivals by date ascending.
- Excludes expired arrivals.
- Invalid quantity displays date-only ETA.
- ETA errors preserve the original inventory reply.
- Uses request-local cache.
- Does not write to Sheets.
- Does not send proactive push notifications.

Deployment:

- Version `178` -> `179`
- Description: `Stage 22-C1 shortage ETA inventory replies`

## 5. Cross-Year Date Handling

The original `M/D` date handling used the current year directly. This caused cross-year mistakes:

- December queries could incorrectly treat next-January ETA as already expired.
- January queries could incorrectly treat previous-December ETA as upcoming.

The fix:

- Builds previous/current/next year candidates.
- Chooses the nearest reasonable date.
- Uses a maximum 183-day distance.
- Prefers the future candidate on ties.
- Conservatively skips far mid-year January/December ambiguity.
- Respects explicit-year dates as written.
- Covers leap-year and invalid leap date cases.
- Uses date-only difference calculations, not spreadsheet timestamps.

Validation:

- 34 ETA/date simulations passed.

## 6. Flex ETA Card

Commit:

- `04eafa9544c7f38b0da9054a18a46f6d02643b26`
- `feat: add flex card for shortage eta`

Implementation:

- First message preserves the original product/inventory text.
- Second message is the ETA Flex card.
- Plain-text ETA is not duplicated.
- Header:
  - Orange-red background.
  - `🚢`
  - `缺貨到港通知`
- Arrival date is the primary visual focus.
- Quantity is the secondary visual focus.
- Yellow reminder area:
  - `⚠️ 實際到貨與可出貨時間請洽業務確認`
- No buttons.
- No reservation promise.
- No arrival guarantee.
- Existing `replyToLine()` array interface supports the message pair.
- Normal ETA reply contains two messages.

Deployment:

- Version `179` -> `180`
- Description: `Stage 22-C3 Flex ETA card`

Validation:

- 20 Flex simulations passed.

## 7. Compact Flex Polish

Commit:

- `4010aa5ae4cbe4959fc8935b1425817f499c89a7`
- `style: compact shortage eta flex card`

Visual changes:

- Header icon: `xxl` -> `xl`
- Header title: `xl` -> `lg`
- Header padding: `16px` -> `10px`
- Body changed to compact horizontal rows.
- Reminder padding: `12px` -> `8px`
- Reminder font: `sm` -> `xs`
- Estimated card height reduction: 25-35%.
- ETA logic, message count, altText, and fallback behavior did not change.

Deployment:

- Version `180` -> `181`
- Description: `Stage 22-C4 compact Flex ETA card`

Validation:

- 20 compact-card simulations passed.

## 8. Production User Validation

Human LINE validation case:

- Input: `KMI-3901 30`
- Product: `KMI-3901 山頂白`
- Requested quantity: `30片`
- Shortage: yes
- ETA: `7/18`
- Quantity: `約 408片`
- First message: original product and inventory text.
- Second message: Compact Flex ETA card.
- Card title: `缺貨到港通知`
- Yellow reminder displayed correctly.
- Plain-text ETA was not duplicated.
- User confirmed:
  - The card is eye-catching.
  - The card size is reasonable.
  - The feature can be finalized.

This validation data is a regression case only. It must not be hardcoded in production logic.

## 9. Fixed Regression Case

Required regression case for future ETA changes:

- Input: `KMI-3901 30`
- Expected parsed model: `KMI-3901`
- Expected shortage: yes
- Expected messages: 2
- Expected ETA card: yes
- Expected date: `7/18`
- Expected quantity: `約 408片`
- Expected original inventory text: preserved
- Expected duplicate text ETA: no
- Expected deployment behavior: LINE customer reply only

General regression cases:

- In stock -> no ETA.
- Shortage without ETA -> no card.
- One ETA arrival.
- Two ETA arrivals.
- Date-only ETA.
- Today ETA.
- Cross-year ETA.
- Reader exception.
- Exact/non-exact matching.
- No-match/multi-match/image flow.

## 10. Preserved Behavior

The following behavior was preserved:

- Normal in-stock product query.
- Product + quantity parser.
- No-match flow.
- Multi-match flow.
- Image query flow.
- Promo behavior.
- Staff router.
- Backend.
- Frontend.
- Task schema.
- Script Properties.
- Webhook.
- Triggers.
- NotificationLogs.
- Google Sheets data.
- Customer data.
- Substitute recommendation remains not implemented.

## 11. Safety

Safety summary:

- LINE API called during automated stages: no.
- Automated message sent: no.
- Sheet modified: no.
- NotificationLogs created: no.
- Trigger changed: no.
- Schema changed: no.
- Script Properties changed: no.
- Backend deployed: no.
- Frontend deployed: no.
- Extra LINE deployment created: no.
- Existing deployment ID retained: yes.

## 12. Known Limits and Warnings

1. ETA Sheet read pattern

- ETA Sheet is read request-locally for shortage requests.
- CacheService is not used yet.
- Sheet size is about 1033 rows and is currently acceptable.
- If query volume increases, performance should be revisited using real data.

2. Yearless `M/D` handling

- `M/D` uses conservative cross-year inference.
- Far year-boundary rows that cannot be reliably interpreted are skipped.
- This avoids showing customers incorrect ETA data.

3. `clasp status` informational items

Existing local non-upload items:

- `src/core/README.md`
- `src/repositories/README.md`
- `src/services/`

Governed deployment uploads only official Apps Script source files. These are informational warnings and do not affect production.

4. ETA meaning

- ETA is arrival reference only.
- ETA does not mean stock has arrived.
- ETA does not guarantee availability or shipment.

## 13. Final Status

- ETA investigation: complete
- Column contract confirmation: complete
- ETA implementation: complete
- Cross-year fix: complete
- Flex card: complete
- Compact visual polish: complete
- Commit/push: complete
- LINE Bot production: Version `181` (Production Deployment ID: `AKfycbxioavjvzENr9duOtomZQRmbycbDtJOzKNAuSgcnE1ptNquTStiWMZwygLEHaYfPxOn`)
- User production validation: passed
- Blockers: none
- Stage 22-C: closed

## 14. Recommended Next Stages

### Stage 23-A Natural Arrival Labels

Goal:

- Today: `今日到港`
- Tomorrow: `明日到港`
- Day after tomorrow: `後天到港`
- Other dates: `M/D 到港`

Constraints:

- Only change display labels.
- Do not change ETA date key, matching, or filtering.
- Do not describe `今日到港` as `已到貨`.
- Keep the business confirmation reminder.

### Stage 23-B Conservative Substitute Recommendation

Goal:

- Run only for shortage/out-of-stock.
- Recommend in-stock products only.
- Do not recommend the queried product itself.
- Exclude pool/company-use items.
- Prefer same series.
- Prefer same size.
- Then consider near size.
- Consider close color/spec.
- Exclude clearly different sizes.
- Show at most two items.
- Do not recommend when confidence is low.
- Place after ETA card and before reminder, or as a separate card.
- Do not modify the ETA reader.

### Future Candidate Features

1. Arrival batch labels

- First batch.
- Second batch.

2. Inventory health

- In stock.
- Low stock.
- Insufficient stock.
- Arrival scheduled.

3. Sales suggestion summary

- When ETA and substitute candidates both exist, provide a conservative suggestion.
- Do not use unsourced AI guesses.

4. Proactive reminder center

- Reservation expiring soon.
- Processing not completed.
- ETA arrival.
- Quote not followed for too long.
- Requires separate governance for permission, notification frequency, and writes.
