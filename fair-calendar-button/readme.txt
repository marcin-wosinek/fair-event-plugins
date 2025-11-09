=== Fair Calendar Button ===
Contributors: marcinwosinek
Tags: calendar, events, gutenberg, block
Requires at least: 6.7
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.5.1
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html
Text Domain: fair-calendar-button
Domain Path: /languages

A Gutenberg block for calendar integration.

== Description ==

A Gutenberg block for calendar integration. The block displays a button with a calendar integration with support for Google Calendar, Outlook, Yahoo Calendar, and ICS downloads. With a clean, professional dropdown interface, visitors can add events to their preferred calendar application.

**Key Features:**

* **Multiple Calendar Providers:** Google Calendar, Outlook, Yahoo Calendar, and ICS download
* **Modern UI:** Clean dropdown with Font Awesome icons and smooth animations  
* **Server-side Rendering:** SEO-friendly with proper WordPress block architecture
* **Automatic URL Inclusion:** Event descriptions automatically include the page URL for reference
* **Responsive Design:** Works beautifully on desktop and mobile devices
* **Multilingual Support:** Available in English, Polish, German, Spanish, and French
* **Fair Pricing Model:** No premium tiers or hidden features - everything is included

**Supported Calendar Providers:**

* 🌐 Google Calendar - Opens directly in Google Calendar
* 🏢 Microsoft Outlook - Compatible with Outlook.com and Office 365
* 🟣 Yahoo Calendar - Direct integration with Yahoo Calendar
* 💾 ICS Download - Universal calendar file for any calendar application

**Perfect For:**

* Event organizers and venues
* Businesses hosting webinars or meetings
* Content creators with scheduled events
* Anyone wanting to make it easy for visitors to save events

The plugin uses server-side rendering for better performance and SEO, while providing a smooth user experience with JavaScript enhancements.

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-calendar-button` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress.
3. In the Gutenberg editor, find the "Calendar Button" block in the widgets category.
4. Add the block to your post or page and configure your event details.
5. Customize the button text and styling using WordPress core button block options.

== Frequently Asked Questions ==

= What calendar applications are supported? =

The plugin supports Google Calendar, Microsoft Outlook (including Outlook.com and Office 365), Yahoo Calendar, and provides ICS file downloads that work with any calendar application including Apple Calendar, Thunderbird, and others.

= Does this plugin require any external services? =

No, the plugin works entirely within WordPress. It uses the calendar-link JavaScript library to generate proper calendar URLs, but doesn't send data to external services.

= Can I customize the button appearance? =

Yes! The calendar button uses WordPress's core button block, so you can customize colors, typography, alignment, and other styling options using the standard WordPress block editor controls.

= Will this work with my theme? =

The plugin is designed to work with any properly coded WordPress theme. It uses WordPress's standard block wrapper and follows WordPress coding standards.

= Is this plugin GDPR compliant? =

Yes, the plugin doesn't collect, store, or transmit any personal data. Event details are processed client-side and sent directly to the user's chosen calendar provider.

== Screenshots ==

1. Calendar button block in the Gutenberg editor
2. Dropdown menu showing all calendar provider options  
3. Calendar button on the frontend with modern styling
4. Event successfully added to Google Calendar
5. Block settings panel in the editor

== Changelog ==

## 1.5.1

### Patch Changes

- 4ed3721: Add location to fair-events

## 1.5.0

### Minor Changes

- 13fb665: Integrate button with Fair Events content type

## 1.4.0

### Minor Changes

- f901aa2: Add support to Plausible integration

## 1.3.2

### Patch Changes

- 84fe629: Set correctly supported version

## 1.3.1

### Patch Changes

- Add missing translation

## 1.3.0

### Minor Changes

- Add translations to PL, DE, ES and FR

## 1.2.0

### Minor Changes

- Fix multiple UX issues in block

## 1.1.1

### Patch Changes

- Update dependencies to the newest version

## 1.1.0

### Minor Changes

- 99a2038: Change format of recurrence description in block attributes.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-30

### Added

- Initial release of Fair Calendar Button
- Gutenberg block for calendar event integration
- Support for multiple calendar providers:
  - Google Calendar
  - Microsoft Outlook
  - Yahoo Calendar
  - ICS file download
- Modern dropdown UI with Font Awesome SVG icons
- Server-side rendering for better SEO performance
- Automatic URL inclusion in event descriptions
- Responsive design for all device sizes
- WordPress 5.8+ compatibility
- PHP 8.0+ requirement

### Features

- Clean, professional dropdown interface
- Brand-specific hover effects for each calendar provider
- Smooth animations and transitions
- Uses WordPress core button block for maximum theme compatibility
- No external API dependencies
- GDPR compliant (no data collection)

### Technical

- Built with modern WordPress block development practices
- Uses block.json for block registration
- Font Awesome SVG icons (tree-shaken for performance)
- ES6+ JavaScript with webpack compilation
- Follows WordPress PHP and JavaScript coding standards
- Server-side rendering with render.php
- Namespace isolation to prevent conflicts

== Upgrade Notice ==

= 1.0.0 =
Initial release of Fair Calendar Button. Install to start adding calendar integration to your WordPress site.

== Developer Notes ==

This plugin is built with modern WordPress development practices:

* Uses WordPress's block.json for block registration
* Server-side rendering with render.php
* Font Awesome SVG icons (not CSS) for better performance
* ES6+ JavaScript with webpack compilation
* Follows WordPress PHP and JavaScript coding standards

The plugin is open source and contributions are welcome on GitHub: https://github.com/marcin-wosinek/fair-event-plugins
