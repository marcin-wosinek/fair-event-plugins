=== Fair Events ===
Contributors: marcinwosinek
Tags: events, calendar, recurring events, tickets, gutenberg
Requires at least: 6.7
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.21.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html
Text Domain: fair-events
Domain Path: /languages

Recurring events, venues, calendars, ticket configuration and signup. Paid checkout requires Fair Payments Connector.

== Description ==

Fair Events provides event publishing, calendars, ticket configuration and signup for WordPress. Create events with real start and end dates, repeat them weekly or on hand-picked dates, show them in a responsive monthly calendar, and let visitors sign up or buy tickets — all with native Gutenberg blocks that inherit your theme's styling.

**Fair pricing, no subscription:** The plugin is free to install and every feature is included — there is no premium version. Publishing events and taking free signups costs nothing, ever. When you sell paid tickets through [Fair Payments Connector](https://wordpress.org/plugins/fair-payments-connector/), a flat 2% integration fee is collected automatically in the payment flow, with no monthly cap: sell nothing, pay €0; sell €200 in tickets, pay €4. The integration fee is waived through 31 December 2026, and Mollie's processing fees apply separately. See [fair-event-plugins.com](https://fair-event-plugins.com/) for details.

**Key Features:**

* **Real Event Dates:** Start, end, and all-day events, always displayed in your site's date and time format
* **Recurring Events:** Weekly rules or manually picked dates, with per-occurrence edits and cancellations that don't break the series
* **Ticket Configuration and Signup:** Ticket types, sale periods, scheduled prices, pay-what-you-can pricing, ticket and activity capacity, and activity options. Free signup is included; paid checkout requires Fair Payments Connector
* **Signup Administration:** Manage signups, edit tickets and answers, allocate activities, and export signup data
* **Venues and Event Copies:** Reuse venues with addresses, coordinates and map links; copy events with adjusted dates and ticket configuration
* **Weekly Event Notifications:** Post the week's events to Telegram chats and channels and, with Fair Audience, email them to your subscribers — each channel on its own schedule, with previews, test sends and delivery status
* **Suite Integrations:** Event statistics require Fair Audience; event budgets require Fair Finance; multilingual event links and activity options integrate with Polylang
* **Responsive Calendar:** Monthly grid with category filtering that collapses gracefully on mobile
* **Add to Calendar & iCal:** Visitors save events to Google, Apple, or Outlook; your site exposes an iCal feed
* **Organizer Dashboard:** An admin calendar, a filterable list of all events, and a Manage Event page that gathers details, dates, and tickets in one place
* **Theme-Friendly:** Events use your theme's templates; blocks are server-rendered and SEO-friendly
* **Fair Pricing Model:** No premium tiers or hidden features - everything is included

**Available Blocks:**

* 📅 **Events Calendar** - Monthly grid with category filtering
* 📋 **Events List** - Filterable list of upcoming or past events
* 🗓 **Events Week** - Seven-day overview of the current week
* ℹ️ **Event Info** - Date, time, and venue of a single event
* ⏰ **Event Dates** - Start and end times in your site's format
* 💶 **Event Prices** - Display configured ticket prices
* ➕ **Add to Calendar** - A core Button variation for saving events to personal calendars; the separate Fair Calendar Button plugin provides a standalone block
* 🎟 **Event Signup** - Signup and ticket purchase for an event date

The legacy Get Tickets block remains compatible with saved content and renders through Event Signup. The Event Proposal form is currently unavailable, including with Fair Events Experimental active.

**Perfect For:**

* Community groups publishing a shared calendar
* Venues and clubs with weekly recurring events
* Conference and workshop organizers selling tickets
* Nonprofits and associations running free signups
* Any site builder who needs events without a subscription

Fair Events works on its own and grows with the rest of the suite: add [Fair Payments Connector](https://wordpress.org/plugins/fair-payments-connector/) for online payments through Mollie, Fair Audience for attendee management and mailing subscriptions, Fair Audience Experimental for scheduled event mailings, Fair Finance for event budgets, and [Fair Timetable](https://wordpress.org/plugins/fair-timetable/) for multi-track schedules.

= Event notifications =

Fair Events → Event notifications is the one place to manage weekly event notifications. Each channel has its own on/off switch, event source, weekday, time, choice of week, save button, preview, test and delivery status, so one channel never changes or blocks another.

* **Telegram** posts the week's events to the chats and channels you list. It needs only Fair Events and a bot token. A test posts to the saved chats.
* **Bulk email** sends the week's events to your subscribers. It needs Fair Audience, which decides who receives it (participants who agreed to marketing emails and did not opt out of the weekly summary), adds each recipient's unsubscribe link and sends the email. A test goes to your own address only.

A notification lists the events of an event source. Event sources are created with Fair Events Experimental; existing sources keep working without it.

**Telegram setup.** Requires WordPress 7.0 or newer for the Connectors screen.

1. Create a bot with [@BotFather](https://core.telegram.org/bots/features#botfather) and copy its bot token.
2. Open Settings → Connectors, choose "Set up" on the Telegram connector, paste the token as the API key and save. A value that is not a bot token is refused and the saved token stays in place.
3. Add the bot to each chat or channel it should post to, with permission to post.
4. Open Fair Events → Event notifications. Under Telegram choose the event source, heading page, schedule and the chats or channels, then save.
5. Choose "Send test to the saved chats". Connectors only stores the token; the test is what confirms that Telegram accepts it and that the bot can post to each chat.

The token can also be supplied outside the database, as an environment variable or a PHP constant, both named `FAIR_EVENTS_EXPERIMENTAL_TELEGRAM_BOT_TOKEN` (the name is kept from Fair Events Experimental so existing configuration keeps working). The environment variable is used first, then the constant, then the token saved in Connectors. The page says which one is in use and never shows the token.

**When a plugin is inactive.** Deactivating Fair Audience pauses the bulk email only: its settings are kept, Telegram keeps running, and sending resumes at the next scheduled time after Fair Audience is active again. Deactivating Fair Events pauses every channel until it is active again. A send that was missed in the meantime is not sent later.

**Upgrading from Fair Events Experimental and Fair Audience.** Telegram summaries used to be set up in Fair Events → Settings → Experimental and the weekly email in Fair Audience → Weekly Digest. Fair Events takes both over the first time it runs next to versions of those plugins that hand them over (or while they are inactive): the settings, schedules, event sources, email wording, chats, the bot token and the delivery history are kept, each channel with its own schedule. Nothing is sent during the takeover and no channel is turned on by it; a channel that was not being sent arrives turned off. The former settings screens now lead to Event notifications. Update all three plugins together. While an older Fair Events Experimental or Fair Audience is still active, its channel keeps running from its old screen and Event notifications asks you to update it; the other channel is not affected. With an updated companion and an older Fair Events, that channel is paused until Fair Events is updated.

When Telegram posting is turned on, the plugin sends the week's event summary to Telegram (Telegram Messenger Inc.) through the Telegram Bot API at `api.telegram.org`, at the day and time the administrator schedules, and whenever an administrator requests a test. Each request carries the administrator-supplied bot token and chat or channel identifier, and the summary text: the title and link of the public page the administrator selects, the date range, and each public event's weekday, start time, title and link. No visitor or attendee data is sent. Telegram's [Terms of Service](https://telegram.org/tos), [Bot Platform terms](https://telegram.org/tos/bot-developers) and [Privacy Policy](https://telegram.org/privacy) apply.

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-events` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress.
3. Navigate to "Events" in the WordPress admin menu to create your first event.
4. Fill in the event details including start time, end time, and content.
5. Publish your event and add the Events Calendar or Events List block to any page to display it.

== Development ==

* GitHub Repository: [marcin-wosinek/fair-event-plugins](https://github.com/marcin-wosinek/fair-event-plugins)
* Report Issues: [Issues](https://github.com/marcin-wosinek/fair-event-plugins/issues)
* Contribute: [Pull Requests](https://github.com/marcin-wosinek/fair-event-plugins/pulls)

== Frequently Asked Questions ==

= How do I create an event? =

After activating the plugin, you'll see "Events" in your WordPress admin menu. Click "Add New" to create an event just like you would create a post.

= Can I create recurring events? =

Yes. Set a weekly rule or pick dates by hand. Each occurrence can be edited or cancelled individually without affecting the rest of the series.

= Can I sell tickets? =

Yes. Define ticket types with sale periods, capacity limits, and optional pay-what-you-can pricing, then place the Event Signup block. Free signups work out of the box; for paid tickets, install Fair Payments Connector to check out through Mollie.

= How do I display a calendar of events? =

Use the "Events Calendar" block in the block editor. You can filter by categories, choose the start day of the week (Monday/Sunday), and select how events are displayed. The calendar is responsive and shows only event days on mobile devices.

= Will events work with my theme? =

Yes! Events use WordPress's template hierarchy and will automatically use your theme's single post template. Event metadata (times) is automatically added to the content.

= How are event times formatted? =

Event times are automatically formatted using your site's date and time format settings from Settings → General in WordPress admin.

= Can I use categories and tags with events? =

Yes! Events support standard WordPress categories and tags. You can organize your events using these taxonomies just like regular posts.

== Screenshots ==

1. Events Calendar admin page with seeded events across the month
2. All Events admin list with linked posts and link types
3. Manage Event admin page (Details, Recurrence, Link Options cards)
4. Events Calendar block on a public page
5. Event Info block on an event page (date and venue address)
6. Add to Calendar block on an event page

== Changelog ==

The full changelog is maintained on GitHub:
[CHANGELOG.md](https://github.com/marcin-wosinek/fair-event-plugins/blob/main/fair-events/CHANGELOG.md)

== Developer Notes ==

The plugin is open source and contributions are welcome on [GitHub](https://github.com/marcin-wosinek/fair-event-plugins).

= Checkout total for conversion tracking =

The Event Signup form shows one total directly above its submit button. Site-level tracking (for example a Meta event configured in a tag manager) can read the current payable amount from it:

* Selector: `.fair-events-signup-checkout-total`
* `data-amount`: the total as a dot-separated decimal with two places (e.g. `42.50`), independent of the site language's number format. It is `0.00` for free signups or before a payable choice is made.
* `data-currency`: the ISO currency code (e.g. `EUR`).

Both attributes update whenever the visitor changes a ticket type, quantity, date, or activity, and always match the visible amount. Core Fair Events sends no tracking events. Fair Events Experimental can optionally send consented Meta conversions when configured. This selector and its attributes are a stable interface and will not be renamed.
