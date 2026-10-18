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

To verify reporting, open Meta Events Manager for the configured dataset and check the Overview for `FairEventCalendarClick` and `FairEventTicketClick` after clicking the buttons on a public event page with marketing consent granted. In WordPress, Fair Events → Settings → Experimental lists recent deliveries and their outcomes. Events are delivered by WP-Cron, so they appear shortly after the click.

= Checking that Meta receives calendar clicks =

The Experimental settings tab can send one `FairEventCalendarClick` straight to Meta's Test Events, built exactly like a real "Add to calendar" click:

1. Save the dataset ID, access token and the Test Events code shown in Events Manager → Test events.
2. In the same browser, open a public event page with the Meta Pixel active and accept marketing cookies, so the browser has an `_fbp` (or `_fbc`) cookie and marketing consent. The WP Consent API plugin must be active; the settings page reads consent through it, as event pages do.
3. Open Fair Events → Settings → Experimental. Under "Calendar click test", open the Event list, which shows the latest events with an event page, or type to search by title. Choose the event (and a date, for a series), and select "Send FairEventCalendarClick test". If consent or the Meta cookie was missing, fix it in the same browser and select "Check this browser again"; the chosen event is kept.
4. In Events Manager → Test events, the event should appear as Processed, received from Server.

A disabled test button always has its reason next to it. The PageView, InitiateCheckout and Purchase tests only need the saved configuration: choosing an event or this browser's consent never disables them. Unsaved edits do, because a test would use the saved values. Browser password managers can fill a saved login into the access token field, so if testing says there are unsaved changes you did not make, select "Discard changes".

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
