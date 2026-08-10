# fair-events-shared

## 0.6.0

### Minor Changes

-   49f2e0a: Link the event name to its page in the confirmation-family emails — signup confirmation, payment-failed, activities-added, event-interest, and mailing-list-welcome — instead of just bolding it. Falls back to the previous bold-only text when no event URL is available.
-   aeda159: Send a payment-failed email (event name, plain link back to the event page) from the standalone Event Signup block when a payment fails, is rejected, cancelled, or expires — mirroring fair-audience's own failed-payment email so buyers on fair-audience-free sites get the same notice. The shared `SignupConfirmationEmail` formatter gains an optional plain action link, reused for this new email.
-   f64745d: Move fair-audience's signup confirmation email formatting into a shared `FairEventsShared\Notifications\SignupConfirmationEmail` formatter, and use it for both plugins' confirmation emails. fair-audience's confirmation email now also shows the event date, a registration reference, and the ticket type. fair-events' standalone confirmation email (sent when fair-audience isn't active) is now built from the same branded HTML template instead of a plain-text message, and includes the ticket type and — on paid signups — the amount paid.

### Patch Changes

-   4b9d893: Add "Date" and "Date & Time" question blocks (mirroring the email/phone/url questions) that render the browser's native date/date-time picker on the frontend. Values are validated server-side as real, well-formed dates and rejected with the same error conventions as other typed fields; datetime answers are stored as site-local time. Stored answers render as localized, human-readable dates in the submission-detail and questionnaire-responses admin views. Also adds the new question types to Event Signup's block inserter (fair-audience and fair-events) and their shared validation (fair-events-shared).
-   4ec1056: Add a URL question block (mirrors the email question) that renders a mobile-friendly text input on the frontend, normalizes bare domains to `https://`, and rejects non-web values server-side. Stored answers render as links in the submission-detail and questionnaire-responses admin views. Also fixes the url and email questions never appearing in the block inserter inside Event Signup (fair-audience and fair-events), and extracts the question-block allow-list into fair-events-shared so fair-form-conditional stays in sync.
-   7932bb2: Add an opt-in "read event details from the linked page" setting to the URL question, off by default. When enabled, the submitted address is looked up as soon as the visitor leaves the field, and any structured event data it publishes (schema.org markup, falling back to social-sharing metadata or the page title) is shown live in an info bubble beneath the field, marked as read from the page. Nothing is stored — an unreachable page, a non-HTML response, or a page with no usable data simply shows no bubble. The fetch/parse logic that powers this also moves into a shared `AbstractUrlLookupController` (fair-events-shared) that fair-events' own admin lookup now extends instead of duplicating.

## 0.5.0

### Minor Changes

-   7281a45: Centralize amount and currency formatting behind a shared `FairEventsShared\Money` helper (PHP) and matching `formatMoney`/`formatMoneyInline` helpers (JS), fixing the Fair Audience and Fair Events signup blocks, which previously hardcoded the € symbol regardless of the site's configured currency. A non-EUR site (e.g. PLN, CZK, HUF) now shows its real currency on ticket labels, add-on prices, and the running total — including after ticking an option, which previously reverted to €. EUR output is unchanged everywhere (signup blocks, emails, Timeline, Mollie payloads).
-   84cfda0: The Conditional Section block, when nested inside a signup form, can now show or hide its contents based on the visitor's selected ticket type (in addition to the existing question and event-option sources) — pick one or more ticket types and an "is selected" / "is not selected" operator, and the section reacts live as the visitor changes their selection. Also fixes the Conditional Section's "Event option" condition source, which failed to appear when nested inside the unified Event Signup block (it only recognized the older, hidden legacy block).
-   9ae94d2: The unified Event Signup form (used when fair-audience is inactive) now shows a rich outcome when a visitor returns from paying: a confirmed card (event, amount, "confirmation email on its way"), a processing card that polls and updates in place, or a resume/retry card for a failed, canceled, expired, or abandoned payment — with buttons to continue the existing checkout, retry with a new one, or cancel and start over. A visitor who navigates directly back to the event page (no return link followed) now also sees their in-progress payment, recognised via a short-lived signed cookie, within the 15-minute hold window. Payment status is reconciled with the payment provider on return so the page never misreports a payment mid-redirect. When online payments are unavailable, ticket sales still show the existing "temporarily unavailable" notice instead of a dead retry button.

### Patch Changes

-   8d196d7: Add a `generateUuid()` helper that falls back to `crypto.getRandomValues()` when `crypto.randomUUID()` is unavailable (plain-HTTP sites are not a secure context), for blocks that need to mint a stable id in the editor.
-   1f9fcc1: Fix long-answer question fields rendering collapsed to a single line instead of sizing to fit their content. A long-text question nested inside a Conditional Section stayed collapsed until the respondent typed in it, because the auto-grow behavior ran on hidden textareas (always 0 height) and never re-ran once the section was revealed. Long-text fields also had no styling at all outside the plain Fair Form block (e.g. in the Event Signup blocks), and could grow without limit; they now cap at roughly 12 lines and scroll internally beyond that.

## 0.4.0

### Minor Changes

-   a7c09e1: Add a shared MiniCalendar primitive (extracted from the occurrences calendar) so the series-modal date picker and the Sale Periods panel render an identical shaded, click-to-pick grid, and add a renderPaymentError helper that shows sanitized payment gateway errors with an admin-only interpreted cause and fix-it links.

## 0.3.0

### Minor Changes

-   612b9b0: Extract the recurrence editor (RRULE parse/build helpers and the Frequency/Ends/Count/Until UI) out of three separately-maintained admin components into a shared `RecurrenceControl` in `fair-events-shared`, following the existing DateTimeControl/EventSourceSelector pattern (issue #977).

### Patch Changes

-   b007d8a: Centralize ticket price resolution in a new `FairEvents\Services\TicketPricing` service and a shared `ticket-pricing.js` module, so the fair-events get-tickets purchase paths and the fair-audience event-signup pricing agree on price. Previously get-tickets used a closed `[sale_start, sale_end]` sale-period interval while fair-audience used a half-open `[sale_start, sale_end)` interval with a `continues_pricing_period` fallback — the two could charge different prices for the same ticket type on a sale period's end day. get-tickets now uses the half-open convention too.
-   612b9b0: Reject empty/whitespace-only event titles in the quick-create button and the create/update REST endpoints (update never validated title at all), and show a shared "(untitled event)" fallback label everywhere a title is rendered so legacy untitled rows stay legible (issue #990).

## 0.2.0

### Minor Changes

-   2cb0fb8: Add a shared payment-integration lifecycle layer in fair-events-shared that standardizes how plugins hook into payment start, completion, and failure. fair-payments-connector's simple-payment block and fair-events' get-tickets block consume the shared layer so payment side-effects are handled consistently across integrations.
