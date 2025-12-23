=== Fair Events ===
Contributors: marcinwosinek
Tags: events, calendar, custom post type, gutenberg
Requires at least: 6.7
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.6.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html
Text Domain: fair-events
Domain Path: /languages

Event management plugin with custom post type for events.

== Description ==

A comprehensive event management plugin that adds a custom "Event" post type to WordPress. Create, manage, and display events with start times, end times, and all-day event options.

**Key Features:**

* **Custom Event Post Type:** Dedicated content type for events with all standard post features
* **Event Metadata:** Track event start time, end time, and all-day events
* **Gutenberg Blocks:** Display events using calendar grid, event list, and event dates blocks
* **Calendar View:** Month grid calendar with category filtering and mobile-responsive design
* **Author Support:** Full author attribution and author archives
* **Category & Tag Support:** Organize events using standard WordPress taxonomies
* **REST API Enabled:** Full support for Gutenberg block editor and headless WordPress
* **Admin Meta Box:** Easy-to-use datetime inputs in the WordPress admin
* **Automatic Formatting:** Event times displayed in your site's configured date/time format
* **Theme Integration:** Events automatically use your theme's single post template
* **Fair Pricing Model:** No premium tiers or hidden features - everything is included

**Available Blocks:**

* **Events Calendar** - Monthly calendar grid showing events with category filtering
* **Events List** - Flexible list view with customizable patterns and time filtering
* **Event Dates** - Display event start/end times with customizable formatting

**Event Features:**

* 📅 Start Date & Time - When your event begins
* 🏁 End Date & Time - When your event concludes
* ⏰ All-Day Events - Flag for events that span entire days
* 👤 Author Attribution - Track who created each event
* 🏷️ Categories & Tags - Organize events your way
* 🖼️ Featured Images - Add visual appeal to your events
* ✍️ Full Content Editor - Use Gutenberg blocks for rich event descriptions

**Perfect For:**

* Event venues and organizers
* Community calendars
* Conference and workshop organizers
* Businesses hosting events
* Educational institutions
* Any organization that needs event management

The plugin integrates seamlessly with WordPress's native features, using the block editor, REST API, and standard template hierarchy.

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-events` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress.
3. Navigate to "Events" in the WordPress admin menu to create your first event.
4. Fill in the event details including start time, end time, and content.
5. Publish your event and it will appear on your site.

== Development ==

* GitHub Repository: https://github.com/marcin-wosinek/fair-event-plugins
* Report Issues: https://github.com/marcin-wosinek/fair-event-plugins/issues
* Contribute: https://github.com/marcin-wosinek/fair-event-plugins/pulls

== Frequently Asked Questions ==

= How do I create an event? =

After activating the plugin, you'll see "Events" in your WordPress admin menu. Click "Add New" to create an event just like you would create a post.

= Where do I set the event times? =

Event times are set in the "Event Details" meta box in the sidebar when editing an event. You can set start time, end time, and mark it as an all-day event.

= Can I use categories and tags with events? =

Yes! Events support standard WordPress categories and tags. You can organize your events using these taxonomies just like regular posts.

= Will events work with my theme? =

Yes! Events use WordPress's template hierarchy and will automatically use your theme's single post template. Event metadata (times) is automatically added to the content.

= How are event times formatted? =

Event times are automatically formatted using your site's date and time format settings from Settings → General in WordPress admin.

= Does this support the block editor? =

Yes! Events are fully compatible with the Gutenberg block editor and the REST API.

= How do I display a calendar of events? =

Use the "Events Calendar" block in the block editor. You can filter by categories, choose the start day of the week (Monday/Sunday), and select how events are displayed (simple title or with time). The calendar is responsive and shows only event days on mobile devices.

= Can I filter events by category in the calendar? =

Yes! The Events Calendar block allows you to select which categories to display. This filtering is configured in the block settings (editor sidebar) and applies to all visitors viewing the calendar.

= How do I change how events appear in the calendar? =

In the Events Calendar block settings, use the "Event Display Pattern" dropdown to choose between different display styles (simple title, or title with time). You can also create custom patterns for more advanced layouts.

== Screenshots ==

1. Event list in WordPress admin
2. Event editor with meta box for times
3. Single event display on frontend

== Changelog ==

## 0.6.0

### Minor Changes

- 96a150c: Add calendar display block.

## 0.5.2

### Patch Changes

- fa15b85: Improve copy screen for events.

## 0.5.1

### Patch Changes

- 7e7ea9c: Update version tested up to version to 6.9.

## 0.5.0

### Minor Changes

- 83743d6: Add a workflow to copy the event

### Patch Changes

- 3a60309: Add lenght dropdown to the event content type.
- 97fd67d: Add support for user groups.

## 0.4.3

### Patch Changes

- 9b83592: Link to RSVP confirmation if plugin is available

## 0.4.2

### Patch Changes

- ccb5d6a: Add list of upcomming events

## 0.4.1

### Patch Changes

- 2ee1396: Integrate event & schedule blocks—reference event dates in block
- 1bfddd0: Fix data formating in translated date

## 0.4.0

### Minor Changes

- 8f0db61: Move start & end dates to separate table

## 0.3.3

### Patch Changes

- 4ed3721: Add location to fair-events
- ee8bef8: Simplify showing the dates in event-dates block
- 2e270f0: Add translations for PL, DE & ES

## 0.3.2

### Patch Changes

- 8c3c2fe: Fix the category search in event-list block
- 46fbaaf: Fix the filtering in event-list block

## 0.3.1

### Patch Changes

- c8f06d5: Fix slug setting page

## 0.3.0

### Minor Changes

- Add slug setting
- Improve edit UX

## 0.2.0

### Minor Changes

- f39c6fb: Add list view block with patterns support

== Upgrade Notice ==

= 0.1.0 =
Initial release of Fair Events. Install to start managing events on your WordPress site.

== Developer Notes ==

This plugin is built with modern WordPress development practices:

* PSR-4 autoloading with namespaces
* Singleton pattern for plugin initialization
* WordPress coding standards (WPCS)
* Proper sanitization and security measures
* REST API integration
* Uses WordPress's template hierarchy
* Supports both classic and block themes

The plugin is open source and contributions are welcome on GitHub: https://github.com/marcin-wosinek/fair-event-plugins
