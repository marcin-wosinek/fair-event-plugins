=== Fair Events Experimental ===
Contributors: marcinwosinek
Tags: events, experimental
Requires at least: 7.0
Tested up to: 7.1
Stable tag: 1.11.0
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
* **Optional Meta conversions:** Report consented checkout and purchase measurements. Disabled by default; requires Fair Payments Connector and configured Meta credentials.

Sources, group rules and event tools have feature toggles enabled by default. Meta conversions are opt-in. Visitor proposal submission has an API, but the public form is currently unavailable. Scheduled event mailings are supplied by Fair Audience Experimental.

When the optional Meta Conversions feature is enabled, the plugin processes consented Meta browser identifiers (`_fbp` and `_fbc`), the checkout source URL, purchase value, currency, and transaction identifier to report checkout and completed-purchase measurements to Meta Platforms, Inc. Delivery is asynchronous. Identifiers are cleared after delivery reaches a terminal result, and all delivery rows are deleted after 90 days. The feature requires marketing consent and administrator-supplied Meta credentials; its external service terms and privacy policy apply.

Weekly Telegram summaries moved to Fair Events: they are managed in Fair Events → Event notifications, which keeps the settings, bot token and delivery history. This plugin no longer sends them; its Experimental settings tab links to the new page. Event feeds, which decide the events a notification lists, are still created here.

== Changelog ==

= 0.1.0 =
* Initial release — moves internal feature bundles out of fair-events.
