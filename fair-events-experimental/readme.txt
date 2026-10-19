=== Fair Events Experimental ===
Contributors: marcinwosinek
Tags: events, experimental
Requires at least: 7.0
Tested up to: 7.1
Stable tag: 1.12.0
Requires PHP: 8.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Sources, group rules, schedules, comparisons and optional Meta conversions. Requires Fair Events.

== Description ==

Fair Events Experimental is a companion requiring Fair Events. Core Fair Events already supplies ticket configuration, public signup, calendars, venues and basic event copying. This companion adds:

* **Event feeds:** Configure event feeds combining local categories, external iCal feeds and Fair Events JSON feeds, preview them, and share feed-specific ICS subscriptions. Parsing and aggregation are provided by Fair Events.
* **Group pricing and permissions:** Apply group discount and signup visibility rules using Fair Audience group and participant data.
* **Workshop/activity schedules:** Edit schedule rows and booking state on Manage Event. Storage, API and booking enforcement are provided by core Fair Events ticketing.
* **Event comparisons:** Compare ticket-sales and revenue timelines for two occurrences and download chart images. Requires Fair Audience statistics.
* **Optional Meta conversions:** Report consented checkout and purchase measurements, and clicks on event-page calendar and ticket buttons. Disabled by default; requires Fair Payments Connector and configured Meta credentials.

Sources and group rules have feature toggles enabled by default. Meta conversions are opt-in. Visitor proposal submission has an API, but the public form is currently unavailable. Scheduled event mailings are supplied by Fair Audience Experimental.

When the optional Meta Conversions feature is enabled, the plugin processes consented Meta browser identifiers (`_fbp` and `_fbc`), the checkout source URL, purchase value, currency, transaction identifier, and the purchased event's title, identifier, occurrence and start date to report checkout and completed-purchase measurements to Meta Platforms, Inc. Delivery is asynchronous. Identifiers are cleared after delivery reaches a terminal result, and all delivery rows are deleted after 90 days. The feature requires marketing consent and administrator-supplied Meta credentials; its external service terms and privacy policy apply.

= Event details in checkout and purchase events =

`InitiateCheckout` and `Purchase` keep Meta's standard event names and their value, currency, order ID and `payment_mode`. They also identify the event that was bought:

* `content_name` — the event's title, as plain text.
* `content_ids` — a one-item list with the event's stable identifier: the WordPress post ID of the event page (for example `["123"]`), or `event-date:<id>` for an event without a page, where `<id>` is the event date ID of the single date or of the series' first date.
* `event_date_id` — the event date ID of the purchased occurrence, so sessions of the same event can be told apart.
* `event_start_date` — that occurrence's start date as `YYYY-MM-DD`, in the site's own timezone.

The event comes from the purchase's registrations, never from the page address. When one checkout pays for several occurrences of a series, only the earliest-starting registered occurrence is reported; the other occurrences are not sent and there is still one event per checkout. No attendee details are added.

The details are recorded when each event is queued, so later edits to the event do not change an event waiting to be sent. Any detail that cannot be found (a deleted event, a missing title or date) is left out on its own, and the event is still sent. Events queued before this version are sent without event details.

To inspect the parameters, save the Test Events code and use the "Send InitiateCheckout test" or "Send Purchase test" button in Fair Events → Settings → Experimental, then open the event in Events Manager → Test events. These samples use fixed, clearly fake details (`content_name` "Fair Events test event", `content_ids` `["fair-events-test-event"]`, `event_date_id` `0`, `event_start_date` `2000-01-01`), never a real event or order. Routine checkouts and purchases are sent without the Test Events code, so they do not appear there.

Meta receiving these parameters does not by itself create a breakdown by event in its reports. To group results by event or occurrence, set up custom conversions or reporting rules on these parameters in Meta.

= Meta button-click events =

With Meta conversions enabled and configured, event pages also report two custom engagement events, separate from `InitiateCheckout` and `Purchase`:

* `FairEventCalendarClick` — a visitor activated the "Add to calendar" button. It measures interest; it does not confirm the event was saved to a calendar, and choosing a calendar provider is not counted again.
* `FairEventTicketClick` — a visitor activated a ticket button. Mark a button or link as a ticket button by adding the CSS class `fair-events-ticket-button` under the block's Advanced → Additional CSS class(es). The class works on a Button block (its wrapper) or on a link itself. The button's text is never inspected, and the link can jump to a ticket section on the same page or lead to another purchase page.

Each activation, by mouse, touch or keyboard, sends one event; clicking again sends another. Events are only sent when the visitor has given marketing consent and has a valid Meta browser identifier at the moment of the click. Tracking never delays or blocks the button: if it is unavailable or fails, the calendar menu still opens and ticket links still navigate.

Each event carries the event's post ID, the event-date ID of the occurrence shown on the page, the action (`calendar` or `ticket`), the event page's address without query parameters, and the visitor's `_fbp`/`_fbc` identifiers. Destination links, query strings, button text and personal details are never sent. The capture endpoint accepts only public event pages, ignores replayed clicks, and limits requests from one address to 60 per hour.

Button clicks are sent to Meta immediately: WordPress forwards each click to Meta while it handles the browser's tracking request, without WP-Cron or the delivery queue. The browser does not wait for the answer, so the button never waits for Meta. Each click is sent once, as a production event without the Test Events code, with a three-second limit on Meta's answer. There is no retry: if Meta is slow, unreachable or answers with an error, that click is not measured. In exchange, click tracking does not depend on background scheduling. While it waits for Meta, the request occupies one web server worker, for up to three seconds. The visitor's `_fbp`/`_fbc` identifiers are used for the send only and are never stored. Checkout and purchase events still use the delivery queue and its retries, and clicks queued before this version are still delivered by it, once.

To verify reporting, open Meta Events Manager for the configured dataset and check the Overview for `FairEventCalendarClick` and `FairEventTicketClick` after clicking the buttons on a public event page with marketing consent granted. In WordPress, Fair Events → Settings → Experimental lists recent deliveries and their outcomes, with Meta's HTTP status, received count, messages and trace ID. A click's outcome reads "Received by Meta (sent immediately)", "Not confirmed (sent immediately, not retried)", "Rejected by Meta (sent immediately)", "Meta error (sent immediately, not retried)", "Could not reach Meta (sent immediately, not retried)" or "Configuration error (sent immediately)". "Sent immediately — no result recorded" means the request ended before Meta answered; it is not retried either.

= Setting up Meta conversions =

1. Turn on Meta conversions in Fair Events → Settings → Experimental. Fair Payments Connector must be active for delivery.
2. In Meta Events Manager, generate a Conversions API access token for the dataset.
3. In WordPress, open Settings → Connectors, choose "Set up" on the Meta Conversions API connector, paste the token as the API key and save. To change it later, choose "Edit", then "Remove and replace". A value that cannot be a token, such as one with spaces, is refused and the saved token stays in place. Connectors does not contact Meta; a test event is what confirms that Meta accepts the token.
4. In Fair Events → Settings → Experimental, enter the dataset ID and, for testing, the Test Events code, then save. This tab shows whether a token is configured and links to Connectors; it does not show or edit the token.

Removing the token in Connectors stops conversion delivery until another token is saved. An access token saved in an earlier version keeps working and appears in Connectors as connected; nothing needs to be entered again.

The token can also be supplied outside the database, as an environment variable or a PHP constant, both named `FAIR_EVENTS_EXPERIMENTAL_META_ACCESS_TOKEN`. The environment variable is used first, then the constant, then the token saved in Connectors. The Experimental tab says which one is in use. While an environment variable or constant supplies the token, removing the token saved in Connectors does not stop delivery.

= Checking that Meta receives calendar clicks =

The Experimental settings tab can send one `FairEventCalendarClick` straight to Meta's Test Events, built exactly like a real "Add to calendar" click:

1. Save the access token in Settings → Connectors, then save the dataset ID and the Test Events code shown in Events Manager → Test events in the Experimental tab.
2. In the same browser, open a public event page with the Meta Pixel active and accept marketing cookies, so the browser has an `_fbp` (or `_fbc`) cookie and marketing consent. The WP Consent API plugin must be active; the settings page reads consent through it, as event pages do.
3. Open Fair Events → Settings → Experimental. Under "Calendar click test", open the Event list, which shows the latest events whose page is published and publicly accessible, or type to search by title. Draft, private, scheduled, trashed and password-protected pages, pages of post types without events, and cancelled dates are not listed. Choose the event (and a date, for a series), and select "Send FairEventCalendarClick test". If consent or the Meta cookie was missing, fix it in the same browser and select "Check this browser again"; the chosen event is kept.
4. In Events Manager → Test events, the event should appear as Processed, received from Server.

The event is checked again when the test is sent. If its page was unpublished or its dates changed after it was chosen, the result says "Test not sent", nothing reaches Meta, and the Event list starts over with the events that can still be tested.

A disabled test button always has its reason next to it. The PageView, InitiateCheckout and Purchase tests only need the saved configuration: choosing an event or this browser's consent never disables them. Unsaved edits do, because a test would use the saved values; select "Discard changes" to restore them. Without an access token in Connectors, every test is disabled.

The test uses the Test Events code and a fresh event ID. It does not create a delivery row, and routine events never carry the Test Events code.

The result and the recent test sends show Meta's answer:

* **Events received** — how many events Meta accepted for processing. Only `1` counts as received. `0`, a missing count or an unreadable answer is shown as "Not confirmed", even when the HTTP status is 200.
* **Messages** — Meta's notes about the event. "Messages: none" means Meta sent an empty list; "not reported" means Meta's answer had no messages. Error messages are included, with the access token and browser identifiers removed.
* **Trace ID** — Meta's `fbtrace_id`. Quote it when asking Meta support about a specific request.
* **HTTP status** — the status of Meta's answer, or "No HTTP response" when the request did not reach Meta.

A received event confirms that Meta accepted the payload. It does not prove that the event will appear in the Overview: Meta processes, aggregates and attributes events on its own schedule and rules, and Test Events are not shown in the Overview.

Routine deliveries use the same rule. A row is "Received by Meta" only after Meta confirms one received event. An answer without that confirmation is retried with the same event ID, so Meta can deduplicate it, on the usual schedule (1 minute up to 12 hours, five retries). Deliveries finished before this check existed keep the label "Delivered (not confirmed)", because their success was only an HTTP status.

Weekly Telegram summaries moved to Fair Events: they are managed in Fair Events → Event notifications, which keeps the settings, bot token and delivery history. This plugin no longer sends them; its Experimental settings tab links to the new page. Event feeds, which decide the events a notification lists, are still created here.

== Changelog ==

= 0.1.0 =
* Initial release — moves internal feature bundles out of fair-events.
