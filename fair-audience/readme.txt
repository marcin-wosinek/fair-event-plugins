=== Fair Audience ===
Contributors: marcinwosinek
Tags: events, participants, audience, management
Requires at least: 6.7
Tested up to: 6.7
Stable tag: 0.3.0
Requires PHP: 8.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Manage event participants with custom profiles and many-to-many event relationships.

== Description ==

Fair Audience is a WordPress plugin that helps you manage event participants. It provides:

* Custom participant profiles with name, surname, email, Instagram handle
* Email preferences (minimal or in-the-loop)
* Many-to-many relationships between participants and events
* Participant interest levels (interested or signed up)
* Admin interface for managing participants and viewing them by event
* REST API for integration with other tools

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-audience` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress
3. Use the Fair Audience menu in the admin panel to manage participants

== Frequently Asked Questions ==

= What WordPress version do I need? =

WordPress 6.7 or higher.

= Does this work with custom event types? =

Yes, it integrates with the fair_event post type from the Fair Events plugin.

== Changelog ==

## 0.3.0

### Minor Changes

-   2708bf8: Add foto author to the image.

## 0.2.0

### Minor Changes

-   109ae1a: Add participant poll feature.
-   fe6b0c8: Add import from Entradium xlsx.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-09

### Added

-   Initial release
-   Participant management with name, surname, email, Instagram handle
-   Email preference settings (minimal or in-the-loop)
-   Many-to-many relationships between participants and events
-   Participant labels (interested or signed up)
-   Admin interface for managing participants
-   Events list with participant counts
-   Event participants view
-   REST API endpoints for participants and event-participant relationships
-   Database tables for participants and event-participant relationships

[0.1.0]: https://github.com/marcin-wosinek/fair-event-plugins/releases/tag/fair-audience-0.1.0

== Upgrade Notice ==

= 0.1.0 =
Initial release
