=== Fair Events Experimental ===
Contributors: marcinwosinek
Tags: events, experimental
Requires at least: 7.0
Tested up to: 7.1
Stable tag: 1.12.0
Requires PHP: 8.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Sources, group rules, schedules, duplicate/merge tools, comparisons and optional Meta conversions. Requires Fair Events.

== Description ==

Fair Events Experimental is a companion requiring Fair Events. Core Fair Events already supplies ticket configuration, public signup, calendars, venues and basic event copying. This companion adds:

* **Event feeds:** Configure event feeds combining local categories, external iCal feeds and Fair Events JSON feeds, preview them, and share feed-specific ICS subscriptions. Parsing and aggregation are provided by Fair Events.
* **Group pricing and permissions:** Apply group discount and signup visibility rules using Fair Audience group and participant data.
* **Event tools:** Duplicate events through a configurable wizard or preview and merge event dates, including linked data choices.
* **Workshop/activity schedules:** Edit schedule rows and booking state on Manage Event. Storage, API and booking enforcement are provided by core Fair Events ticketing.
* **Event comparisons:** Compare ticket-sales and revenue timelines for two occurrences and download chart images. Requires Fair Audience statistics.
* **Optional Meta conversions:** Report consented checkout and purchase measurements, and clicks on event-page calendar and ticket buttons. Disabled by default; requires Fair Payments Connector and configured Meta credentials.

Sources, group rules and event tools have feature toggles enabled by default. Meta conversions are opt-in. Visitor proposal submission has an API, but the public form is currently unavailable. Scheduled event mailings are supplied by Fair Audience Experimental.

When the optional Meta Conversions feature is enabled, the plugin processes consented Meta browser identifiers (`_fbp` and `_fbc`), the checkout source URL, purchase value, currency, and transaction identifier to report checkout and completed-purchase measurements to Meta Platforms, Inc. Delivery is asynchronous. Identifiers are cleared after delivery reaches a terminal result, and all delivery rows are deleted after 90 days. The feature requires marketing consent and administrator-supplied Meta credentials; its external service terms and privacy policy apply.

= Meta button-click events =

With Meta conversions enabled and configured, event pages also report two custom engagement events, separate from `InitiateCheckout` and `Purchase`:

* `FairEventCalendarClick` — a visitor activated the "Add to calendar" button. It measures interest; it does not confirm the event was saved to a calendar, and choosing a calendar provider is not counted again.
* `FairEventTicketClick` — a visitor activated a ticket button. Mark a button or link as a ticket button by adding the CSS class `fair-events-ticket-button` under the block's Advanced → Additional CSS class(es). The class works on a Button block (its wrapper) or on a link itself. The button's text is never inspected, and the link can jump to a ticket section on the same page or lead to another purchase page.

Each activation, by mouse, touch or keyboard, sends one event; clicking again sends another. Events are only sent when the visitor has given marketing consent and has a valid Meta browser identifier at the moment of the click. Tracking never delays or blocks the button: if it is unavailable or fails, the calendar menu still opens and ticket links still navigate.

Each event carries the event's post ID, the event-date ID of the occurrence shown on the page, the action (`calendar` or `ticket`), the event page's address without query parameters, and the visitor's `_fbp`/`_fbc` identifiers. Destination links, query strings, button text and personal details are never sent. The capture endpoint accepts only public event pages, ignores replayed clicks, and limits requests from one address to 60 per hour.

To verify reporting, open Meta Events Manager for the configured dataset and check the Overview for `FairEventCalendarClick` and `FairEventTicketClick` after clicking the buttons on a public event page with marketing consent granted. In WordPress, Fair Events → Settings → Experimental lists recent deliveries and their outcomes. Events are delivered by WP-Cron, so they appear shortly after the click.

Weekly Telegram summaries moved to Fair Events: they are managed in Fair Events → Event notifications, which keeps the settings, bot token and delivery history. This plugin no longer sends them; its Experimental settings tab links to the new page. Event feeds, which decide the events a notification lists, are still created here.

== Changelog ==

= 0.1.0 =
* Initial release — moves internal feature bundles out of fair-events.
