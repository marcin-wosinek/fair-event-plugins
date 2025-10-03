=== Fair Schedule Blocks ===
Contributors: marcinwosinek
Tags: blocks, schedule, events, gutenberg, accordion
Requires at least: 6.7
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.2
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Schedule  blocks for Gutenberg.

== Description ==

Fair Schedule Blocks provides WordPress Gutenberg blocks with time-dependent display. 

**Schedule Accordion Block Features:**

* **Auto-collapse functionality** - Set a date/time when content automatically collapses
* **Timezone support** - Uses WordPress site timezone for accurate scheduling  
* **Click-to-reveal** - Collapsed content can be expanded by clicking
* **Responsive design** - Works seamlessly across all devices
* **Accessibility focused** - Built following WordPress accessibility guidelines

Perfect for event organizers, conference planners, and anyone managing time-sensitive content.

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-schedule-blocks/` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress
3. Add blocks through the Gutenberg block editor in the "Widgets" category

== Frequently Asked Questions ==

= What blocks are included? =

Currently includes the Schedule Accordion block with auto-collapse functionality based on date/time.

= How does the timezone support work? =

The plugin uses your WordPress site's configured timezone to determine when content should auto-collapse.

= Can collapsed content be expanded again? =

Yes, users can click on collapsed content to reveal it again.

== Screenshots ==

1. Schedule Accordion block in the editor
2. Block settings panel showing auto-collapse options
3. Collapsed schedule item on the frontend

== Changelog ==

## 0.1.2

### Patch Changes

- d0fc2d3: Allow anyblock inside timed accordian

## 0.1.1

### Patch Changes

- Fix the syntax issue

= 0.1.0 =
* Initial release
* Schedule Accordion block with auto-collapse functionality
* Timezone-aware datetime handling
* Click-to-reveal functionality
* Responsive design

== Upgrade Notice ==

= 0.1.0 =
Initial release of Fair Schedule Blocks with Schedule Accordion block.
