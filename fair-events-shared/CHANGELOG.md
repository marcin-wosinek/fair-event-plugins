# fair-events-shared

## 0.7.1

### Patch Changes

- 5bc7dde: The Simple Payment block no longer puts the payment's access token in the return URL. The token proves that a visitor started the payment, and a URL can leak it to other sites through the `Referer` header, browser history and server logs. The block now keeps the token in the browser tab's session storage before sending the buyer to Mollie, and sends it in a request header when it checks the payment status.

    - After returning from Mollie, the block shows "processing" first, then the checked result. Reloading the page in the same tab still works.
    - If the status can't be checked (for example, the return link was opened in another browser), the block says so and asks the buyer to check their email or contact the organizer before paying again. It no longer suggests the payment failed.
    - If the browser blocks site data, the block won't start a payment. It asks the visitor to allow site data first, so nobody pays without seeing the result.
    - Signed-in buyers and administrators can still check a payment without the token.

    For flows that still put the token in their return URL, the status check keeps accepting it there for now.

## 0.7.0

### Minor Changes

- 21cf6c7: The Mollie access and refresh tokens are now stored encrypted (Sodium authenticated encryption, with a key derived from the site's WordPress security keys). Existing tokens are converted automatically on upgrade; no reconnection is needed, and checkout, automatic token refresh and test payments work as before. The shared package gains `FairEventsShared\Security\ProtectedOptions`, an opt-in way for any plugin to store a string option encrypted.

    - **Without Sodium support:** a site whose tokens are still stored as plaintext keeps working and keeps storing plaintext; the conversion runs once support is available.
    - **Losing Sodium support after conversion:** the encrypted tokens are kept unchanged, payments pause with a notice on the connection settings (visitors see "Online payment is temporarily unavailable"), and the connection resumes without reconnecting once support is restored.
    - **Changing the security keys or moving the database to another site:** the stored tokens can no longer be decrypted. The connection is shown as needing a reconnect instead of failing during checkout, and the unreadable values are left in place until you reconnect. If you rotate your WordPress keys routinely, reconnect Mollie afterwards.
    - **Limits:** this protects against partial leaks such as a table export, a settings export or a value copied into a log. When the WordPress security keys are not defined in `wp-config.php`, WordPress keeps them in the database, so a full database dump still contains what is needed to decrypt the tokens.

- f95eda6: Event dates are now stored and exchanged only as dates with optional start and end times. The `start_datetime` and `end_datetime` fields are gone from the `fair-events/v1/event-dates` API: requests that send them are rejected, and responses no longer include them. List sorting uses `orderby=start_date`. The public events feed sends `start` and `end` only for a time that is set (or the day boundaries of an all-day event), and `null` instead of an invented midnight. Events imported from another Fair Events site without a start time are no longer skipped. On upgrade, the old datetime columns are removed once every event date has been converted. Admin screens, emails and date labels across the plugins show a time only when one is set.
- 157e1ea: The event feed preview now uses the same month calendar as Fair Events →
  Calendar. On phones its agenda lists every event of a crowded day instead
  of the first three, untitled events show "(untitled event)" instead of a
  blank bar, a month without events says so, and a failed request shows an
  error instead of an empty month. A slow response for a previous month can
  no longer replace the month on screen, and opening a feed preview no
  longer adds an extra browser history entry. On the Fair Events calendar,
  a failed request no longer shows "No events this month." on phones.

### Patch Changes

- f32a184: Moving a registration, changing its ticket type, editing a ticket and importing transactions now keep their popup open until the request finishes. While it runs, the popup cannot be dismissed or submitted twice and its fields are locked. A failure keeps your choices, reason or imported file in the popup, with the error shown inline, so you can retry. A failed transaction import offers **Retry import** without choosing the file again. A successful move, type change or ticket edit is now confirmed above the List.
- 79f6ea4: Fair Form's blocks are now translated on sites running in German, Spanish, French or Polish: the block editor controls, block titles and descriptions, the public form's messages (including the required, email, phone, web address, date and file size checks) and the "Yes"/"No" answers in copied submissions. Their text still belonged to Fair Audience's translations, so it stayed in English. It now uses Fair Form's own translations, with the existing ones carried over. Wording is unchanged, and saved forms keep working as before.

    With **Bundled translations** on (**Settings → Fair Event Plugins**), the blocks' JavaScript now uses the translation files shipped with the plugin too; before, only the PHP text did.

- d6adc05: Events can be created and edited with known dates and no times yet. In the
  calendar's Add Event popup, Manage Event, the event details box and Copy
  Event, each time is optional and can be added or cleared on its own; all day
  stays an explicit choice. Invalid ranges are explained before saving, and a
  missing time is never compared as midnight.

    Every view shows only the times an event has: the admin calendar now places
    date-only and partly timed events on their days (also when the browser is in
    another timezone), the week view no longer shows "00:00" for a missing start,
    and an end-only time reads as the end ("Ends 21:30, 15 October"). A date of a
    series shows whether its times follow the series and can get them back. The
    Add to calendar button explains, next to it, that both times are needed when
    an event can't be exported.

- b05c7e3: Event lists, session status and metadata now read event dates with optional times. A date without an end time stays current and upcoming through its end date and is past from the next day, in every events list view. A timed date missing its start time stays upcoming until it ends. JSON-LD and Open Graph show a bare date where a time is missing, and for all-day events, instead of a midnight timestamp. A whole-series pass bought on the start date of a date without a start time covers it. Scheduled mailings anchored to a time that is not set wait without a send time and are rescheduled when the time is set. Signup emails and the mailing event picker show only the date when there is no start time. Events imported from another Fair Events site keep their dates and optional times.

## 0.6.2

### Patch Changes

- 19d0333: Add an audit log for Fair Payments Connector settings and Mollie connection changes. Every successful manual change — saving the mode, currency, or bank-transfer settings, or connecting, reconnecting, or disconnecting Mollie — is recorded with a server-generated description; automated changes (token refresh, connection loss) are attributed to the system. A new Audit Log tab on the settings page shows the paginated history, redacting protected values such as OAuth tokens. The shared Settings → Fair Event Plugins screen gained an optional per-field `requires_reason` flag and a `fair_event_plugins_setting_changed` action so a plugin can record its own audit entry when its field changes there — both are additive and don't affect plugins that don't use them; this plugin's own bundled-translations row does not use the flag.

## 0.6.1

### Patch Changes

- a96d4f1: Keep payment recovery actions available while event signup confirmation is delayed or cannot be checked.

## 0.6.0

### Minor Changes

- 49f2e0a: Link the event name to its page in the confirmation-family emails — signup confirmation, payment-failed, activities-added, event-interest, and mailing-list-welcome — instead of just bolding it. Falls back to the previous bold-only text when no event URL is available.
- aeda159: Send a payment-failed email (event name, plain link back to the event page) from the standalone Event Signup block when a payment fails, is rejected, cancelled, or expires — mirroring fair-audience's own failed-payment email so buyers on fair-audience-free sites get the same notice. The shared `SignupConfirmationEmail` formatter gains an optional plain action link, reused for this new email.
- f64745d: Move fair-audience's signup confirmation email formatting into a shared `FairEventsShared\Notifications\SignupConfirmationEmail` formatter, and use it for both plugins' confirmation emails. fair-audience's confirmation email now also shows the event date, a registration reference, and the ticket type. fair-events' standalone confirmation email (sent when fair-audience isn't active) is now built from the same branded HTML template instead of a plain-text message, and includes the ticket type and — on paid signups — the amount paid.

### Patch Changes

- 4b9d893: Add "Date" and "Date & Time" question blocks (mirroring the email/phone/url questions) that render the browser's native date/date-time picker on the frontend. Values are validated server-side as real, well-formed dates and rejected with the same error conventions as other typed fields; datetime answers are stored as site-local time. Stored answers render as localized, human-readable dates in the submission-detail and questionnaire-responses admin views. Also adds the new question types to Event Signup's block inserter (fair-audience and fair-events) and their shared validation (fair-events-shared).
- 4ec1056: Add a URL question block (mirrors the email question) that renders a mobile-friendly text input on the frontend, normalizes bare domains to `https://`, and rejects non-web values server-side. Stored answers render as links in the submission-detail and questionnaire-responses admin views. Also fixes the url and email questions never appearing in the block inserter inside Event Signup (fair-audience and fair-events), and extracts the question-block allow-list into fair-events-shared so fair-form-conditional stays in sync.
- 7932bb2: Add an opt-in "read event details from the linked page" setting to the URL question, off by default. When enabled, the submitted address is looked up as soon as the visitor leaves the field, and any structured event data it publishes (schema.org markup, falling back to social-sharing metadata or the page title) is shown live in an info bubble beneath the field, marked as read from the page. Nothing is stored — an unreachable page, a non-HTML response, or a page with no usable data simply shows no bubble. The fetch/parse logic that powers this also moves into a shared `AbstractUrlLookupController` (fair-events-shared) that fair-events' own admin lookup now extends instead of duplicating.

## 0.5.0

### Minor Changes

- 7281a45: Centralize amount and currency formatting behind a shared `FairEventsShared\Money` helper (PHP) and matching `formatMoney`/`formatMoneyInline` helpers (JS), fixing the Fair Audience and Fair Events signup blocks, which previously hardcoded the € symbol regardless of the site's configured currency. A non-EUR site (e.g. PLN, CZK, HUF) now shows its real currency on ticket labels, add-on prices, and the running total — including after ticking an option, which previously reverted to €. EUR output is unchanged everywhere (signup blocks, emails, Timeline, Mollie payloads).
- 84cfda0: The Conditional Section block, when nested inside a signup form, can now show or hide its contents based on the visitor's selected ticket type (in addition to the existing question and event-option sources) — pick one or more ticket types and an "is selected" / "is not selected" operator, and the section reacts live as the visitor changes their selection. Also fixes the Conditional Section's "Event option" condition source, which failed to appear when nested inside the unified Event Signup block (it only recognized the older, hidden legacy block).
- 9ae94d2: The unified Event Signup form (used when fair-audience is inactive) now shows a rich outcome when a visitor returns from paying: a confirmed card (event, amount, "confirmation email on its way"), a processing card that polls and updates in place, or a resume/retry card for a failed, canceled, expired, or abandoned payment — with buttons to continue the existing checkout, retry with a new one, or cancel and start over. A visitor who navigates directly back to the event page (no return link followed) now also sees their in-progress payment, recognised via a short-lived signed cookie, within the 15-minute hold window. Payment status is reconciled with the payment provider on return so the page never misreports a payment mid-redirect. When online payments are unavailable, ticket sales still show the existing "temporarily unavailable" notice instead of a dead retry button.

### Patch Changes

- 8d196d7: Add a `generateUuid()` helper that falls back to `crypto.getRandomValues()` when `crypto.randomUUID()` is unavailable (plain-HTTP sites are not a secure context), for blocks that need to mint a stable id in the editor.
- 1f9fcc1: Fix long-answer question fields rendering collapsed to a single line instead of sizing to fit their content. A long-text question nested inside a Conditional Section stayed collapsed until the respondent typed in it, because the auto-grow behavior ran on hidden textareas (always 0 height) and never re-ran once the section was revealed. Long-text fields also had no styling at all outside the plain Fair Form block (e.g. in the Event Signup blocks), and could grow without limit; they now cap at roughly 12 lines and scroll internally beyond that.

## 0.4.0

### Minor Changes

- a7c09e1: Add a shared MiniCalendar primitive (extracted from the occurrences calendar) so the series-modal date picker and the Sale Periods panel render an identical shaded, click-to-pick grid, and add a renderPaymentError helper that shows sanitized payment gateway errors with an admin-only interpreted cause and fix-it links.

## 0.3.0

### Minor Changes

- 612b9b0: Extract the recurrence editor (RRULE parse/build helpers and the Frequency/Ends/Count/Until UI) out of three separately-maintained admin components into a shared `RecurrenceControl` in `fair-events-shared`, following the existing DateTimeControl/EventSourceSelector pattern (issue #977).

### Patch Changes

- b007d8a: Centralize ticket price resolution in a new `FairEvents\Services\TicketPricing` service and a shared `ticket-pricing.js` module, so the fair-events get-tickets purchase paths and the fair-audience event-signup pricing agree on price. Previously get-tickets used a closed `[sale_start, sale_end]` sale-period interval while fair-audience used a half-open `[sale_start, sale_end)` interval with a `continues_pricing_period` fallback — the two could charge different prices for the same ticket type on a sale period's end day. get-tickets now uses the half-open convention too.
- 612b9b0: Reject empty/whitespace-only event titles in the quick-create button and the create/update REST endpoints (update never validated title at all), and show a shared "(untitled event)" fallback label everywhere a title is rendered so legacy untitled rows stay legible (issue #990).

## 0.2.0

### Minor Changes

- 2cb0fb8: Add a shared payment-integration lifecycle layer in fair-events-shared that standardizes how plugins hook into payment start, completion, and failure. fair-payments-connector's simple-payment block and fair-events' get-tickets block consume the shared layer so payment side-effects are handled consistently across integrations.
