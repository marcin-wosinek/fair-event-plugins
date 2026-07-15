=== Fair Events ===
Contributors: marcinwosinek
Tags: events, calendar, recurring events, tickets, gutenberg
Requires at least: 6.7
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 1.9.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html
Text Domain: fair-events
Domain Path: /languages

Events with recurring dates, a responsive calendar, and built-in ticket signup. A complete event system for the block editor — all features free.

== Description ==

Fair Events turns WordPress into a complete event system. Create events with real start and end dates, repeat them weekly or on hand-picked dates, show them in a responsive monthly calendar, and let visitors sign up or buy tickets — all with native Gutenberg blocks that inherit your theme's styling.

**Fair pricing, no subscription:** The plugin is free to install and every feature is included — there is no premium version. Publishing events and taking free signups costs nothing, ever. When you sell paid tickets through [Fair Payments Connector](https://wordpress.org/plugins/fair-payments-connector/), a 1% integration fee is collected automatically in the payment flow, capped at €12/month for the whole suite: sell nothing in a month, pay €0; sell for €200, pay €2. See [fair-event-plugins.com](https://fair-event-plugins.com/) for details.

**Key Features:**

* **Real Event Dates:** Start, end, and all-day events, always displayed in your site's date and time format
* **Recurring Events:** Weekly rules or manually picked dates, with per-occurrence edits and cancellations that don't break the series
* **Ticket Signup Built In:** Ticket types, early-bird sale periods, capacity limits, and pay-what-you-can pricing
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
* ➕ **Add to Calendar** - One-click save to the visitor's own calendar
* 🎟 **Event Signup** - Signup and ticket purchase for an event date
* 📨 **Event Proposal Form** - Let visitors submit events for review

**Perfect For:**

* Community groups publishing a shared calendar
* Venues and clubs with weekly recurring events
* Conference and workshop organizers selling tickets
* Nonprofits and associations running free signups
* Any site builder who needs events without a subscription

Fair Events works on its own and grows with the rest of the suite: add [Fair Payments Connector](https://wordpress.org/plugins/fair-payments-connector/) for online payments through Mollie, Fair Audience for attendee management and mailings, and [Fair Timetable](https://wordpress.org/plugins/fair-timetable/) for multi-track schedules.

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
5. Event Info block on a single event post (date and venue address)
6. Add to Calendar block on a single event post

== Changelog ==

The full changelog is maintained on GitHub:
[CHANGELOG.md](https://github.com/marcin-wosinek/fair-event-plugins/blob/main/fair-events/CHANGELOG.md)

== Developer Notes ==

The plugin is open source and contributions are welcome on [GitHub](https://github.com/marcin-wosinek/fair-event-plugins).
