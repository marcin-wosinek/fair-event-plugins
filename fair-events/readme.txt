=== Fair Events ===
Contributors: marcinwosinek
Tags: events, calendar, custom post type, gutenberg
Requires at least: 6.7
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.2.0
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
* **Author Support:** Full author attribution and author archives
* **Category & Tag Support:** Organize events using standard WordPress taxonomies
* **REST API Enabled:** Full support for Gutenberg block editor and headless WordPress
* **Admin Meta Box:** Easy-to-use datetime inputs in the WordPress admin
* **Automatic Formatting:** Event times displayed in your site's configured date/time format
* **Theme Integration:** Events automatically use your theme's single post template
* **Fair Pricing Model:** No premium tiers or hidden features - everything is included

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

== Screenshots ==

1. Event list in WordPress admin
2. Event editor with meta box for times
3. Single event display on frontend

== Changelog ==

## 0.2.0

### Minor Changes

- f39c6fb: Add list view block with patterns support

## 0.1.0
* Initial release
* Custom Event post type
* Event metadata (start, end, all-day)
* Admin meta box for event details
* Author support
* Category and tag support
* REST API integration
* Automatic date/time formatting
* Theme integration via content filter

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
