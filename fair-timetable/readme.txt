=== Fair Timetable ===
Contributors: marcinwosinek
Tags: timetable, schedule, events, gutenberg, calendar
Requires at least: 6.7
Tested up to: 6.8
Requires PHP: 8.0
Stable tag: 0.6.4
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

A Gutenberg block system for creating beautiful, responsive event timetables.

== Description ==

A comprehensive Gutenberg block system for creating beautiful, responsive event timetables. Build structured schedules with multiple columns and time slots, perfect for conferences, workshops, festivals, and any multi-track events.

**Key Features:**

* **Flexible Container System:** Timetable container block organizes multiple columns horizontally
* **Smart Context Inheritance:** Time settings defined once in the timetable, inherited by all columns
* **Responsive Time Display:** Time ranges automatically hide on narrow screens for optimal mobile experience
* **Precise Time Slots:** Individual time slots with calculated positioning based on start times
* **Visual Time Scale:** Configurable hour height for optimal visual presentation
* **Server-side Rendering:** SEO-friendly with proper WordPress block architecture
* **Clean Block Editor UX:** Intuitive editing with read-only settings display and parent navigation
* **Fair Pricing Model:** No premium tiers or hidden features - everything is included

**Block Structure:**

* 📅 **Timetable Container** - Organizes columns horizontally, defines global time settings
* 📊 **Timetable Column** - Individual schedule tracks (e.g., Room A, Stage 1, Workshop Track)
* ⏰ **Time Slot** - Individual events with precise time positioning and responsive display

**Perfect For:**

* Conference organizers managing multiple tracks
* Event venues with parallel sessions
* Workshop coordinators with concurrent activities
* Festival organizers with multiple stages
* Educational institutions with class schedules
* Any organization needing visual time-based layouts

The plugin uses advanced CSS container queries for responsive design and WordPress's block context system for seamless data inheritance between parent and child blocks.

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-timetable` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress.
3. In the Gutenberg editor, find the "Timetable" block in the design category.
4. Add the timetable container block to your post or page.

5. Add timetable columns within the container.
6. Add time slots within each column and configure your events.
7. Set global time settings (start time, end time, hour height) in the timetable container.

== Development ==

* GitHub Repository: https://github.com/marcin-wosinek/fair-event-plugins
* Report Issues: https://github.com/marcin-wosinek/fair-event-plugins/issues
* Contribute: https://github.com/marcin-wosinek/fair-event-plugins/pulls

== Frequently Asked Questions ==

= How do the time settings work? =

Time settings are defined once in the timetable container block and automatically inherited by all columns within it. This ensures consistency across your entire schedule.

= Can I have different time ranges for different columns? =

When columns are placed inside a timetable container, they inherit the parent's time settings for consistency. For different time ranges, use separate timetable containers or standalone timetable columns.

= Can I customize the visual appearance? =

Yes! The plugin provides three hour height options (Small, Medium, Large) for visual scaling, and all blocks follow WordPress styling standards for theme compatibility.

= Will this work with my theme? =

The plugin is designed to work with any properly coded WordPress theme. It uses WordPress's standard block wrapper and follows WordPress coding standards.

= How are time slots positioned? =

Time slots calculate their position automatically based on the timetable's start time and the slot's start time, creating precise visual alignment in your schedule.

== Screenshots ==

1. Timetable container block with multiple columns in the editor
2. Frontend display of multi-column timetable

== Changelog ==

## 0.6.4

### Patch Changes

-   ead4d69: Upgrade composer/installers from v1 to v2

## 0.6.3

### Patch Changes

-   02cf7b6: Default to WordPress.org language packs; gate `load_plugin_textdomain()` and the
    `wp_set_script_translations()` path behind a new per-plugin `bundled-translations`
    feature flag (resolved through the same constant / master / filter / option /
    default chain as the existing Fair Events features). The flag is exposed in
    each plugin's Settings → Features tab (or Features submenu) and defaults to off.

## 0.6.2

### Patch Changes

-   9cb93a0: Wire fair-timetable into release tooling: stamp build version in PHP header during CI build, and include `languages/` in the SVN trunk copy so bundled translations ship to WordPress.org.

## 0.6.1

### Patch Changes

-   7e7ea9c: Update version tested up to version to 6.9.

## 0.6.0

### Minor Changes

-   769be6b: Add automated hour as adding new time-slots

## 0.5.0

### Minor Changes

-   45729b3: Improve edition UX
-   29d5b69: Rename the block attributes (Hour->Time)

## 0.4.0

### Minor Changes

-   094cb00: Improve the block styling

## 0.3.0

### Minor Changes

-   905f4e4: Refactor timetable blocks

### Patch Changes

-   84fe629: Set correctly supported version

## 0.2.0

Minor fixes

## 0.1.0

Initial version of the plugin.

== Developer Notes ==

The plugin is open source and contributions are welcome on GitHub: https://github.com/marcin-wosinek/fair-event-plugins
