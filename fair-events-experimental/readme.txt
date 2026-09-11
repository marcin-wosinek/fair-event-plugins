=== Fair Events Experimental ===
Contributors: marcinwosinek
Tags: events, experimental
Requires at least: 6.7
Tested up to: 7.1
Stable tag: 1.7.0
Requires PHP: 8.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Activates advanced feature bundles for Fair Events: galleries, sources, ticketing, duplicate and merge tools, migration.

== Description ==

When the optional Meta Conversions feature is enabled, the plugin processes consented Meta browser identifiers (`_fbp` and `_fbc`), the checkout source URL, purchase value, currency, and transaction identifier to report checkout and completed-purchase measurements to Meta Platforms, Inc. Delivery is asynchronous. Identifiers are cleared after delivery reaches a terminal result, and all delivery rows are deleted after 90 days. The feature requires marketing consent and administrator-supplied Meta credentials; its external service terms and privacy policy apply.

This plugin is a companion to Fair Events. It activates five advanced feature bundles that are excluded from the public Fair Events build:

* **Galleries** — Per-event photo galleries, photo likes/downloads, image exports.
* **Event sources & feeds** — External event sources, iCal/JSON feeds, event proposals.
* **Ticketing** — Tickets, group pricing/permission rules, invitations.
* **Event tools** — Advanced event duplication and merge tools.
* **Migration** — One-time post → event migration tooling.

Requires Fair Events to be active.

== Changelog ==

= 0.1.0 =
* Initial release — moves internal feature bundles out of fair-events.
