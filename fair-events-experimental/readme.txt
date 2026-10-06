=== Fair Events Experimental ===
Contributors: marcinwosinek
Tags: events, experimental
Requires at least: 7.0
Tested up to: 7.1
Stable tag: 1.10.0
Requires PHP: 8.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Activates advanced feature bundles for Fair Events: sources, ticketing, duplicate and merge tools.

== Description ==

When the optional Meta Conversions feature is enabled, the plugin processes consented Meta browser identifiers (`_fbp` and `_fbc`), the checkout source URL, purchase value, currency, and transaction identifier to report checkout and completed-purchase measurements to Meta Platforms, Inc. Delivery is asynchronous. Identifiers are cleared after delivery reaches a terminal result, and all delivery rows are deleted after 90 days. The feature requires marketing consent and administrator-supplied Meta credentials; its external service terms and privacy policy apply.

When weekly notifications are turned on, the plugin sends the upcoming week's event summary to Telegram (Telegram Messenger Inc.) through the Telegram Bot API at `api.telegram.org`, at the day and time the administrator schedules, and a short test message whenever an administrator requests one. Each request carries the administrator-supplied bot token and chat or channel identifier, and the summary text: the title and link of the public page the administrator selects, the date range, and each public event's weekday, start time, title and link. No visitor or attendee data is sent. Telegram's [Terms of Service](https://telegram.org/tos), [Bot Platform terms](https://telegram.org/tos/bot-developers) and [Privacy Policy](https://telegram.org/privacy) apply.

= Setting up weekly Telegram notifications =

Requires WordPress 7.0 or newer, where the Connectors screen was introduced.

1. Create a bot with [@BotFather](https://core.telegram.org/bots/features#botfather) and copy its bot token.
2. In WordPress, open Settings → Connectors, choose "Set up" on the Telegram connector, paste the token as the API key and save. To change it later, choose "Edit", then "Remove and replace". A value that is not a bot token is refused and the saved token stays in place.
3. Add the bot to each chat or channel it should post to, with permission to post.
4. Open Fair Events → Settings → Experimental. Under Weekly notifications, choose the event source, heading page, schedule and the chats or channels, then save.
5. Choose "Send test summary to Telegram". Connectors only stores the token; the test send is what confirms that Telegram accepts it and that the bot can post to each chat.

A bot token saved in an earlier version keeps working and appears in Connectors as connected; nothing needs to be entered again.

The token can also be supplied outside the database, as an environment variable or a PHP constant, both named `FAIR_EVENTS_EXPERIMENTAL_TELEGRAM_BOT_TOKEN`. The environment variable is used first, then the constant, then the token saved in Connectors. The Weekly notifications settings say which one is in use. Without a usable token, test and scheduled sends are stopped before anything is sent to Telegram, and the reason is shown in the settings and in Recent sends.

This plugin is a companion to Fair Events. It activates three advanced feature bundles that are excluded from the public Fair Events build:

* **Event sources & feeds** — External event sources, iCal/JSON feeds, event proposals.
* **Ticketing** — Tickets, group pricing/permission rules, invitations.
* **Event tools** — Advanced event duplication and merge tools.

Requires Fair Events to be active.

== Changelog ==

= 0.1.0 =
* Initial release — moves internal feature bundles out of fair-events.
