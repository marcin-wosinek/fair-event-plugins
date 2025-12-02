=== Fair RSVP ===
Contributors: marcinwosinek
Tags: events, rsvp, registration, sign-up, gutenberg
Requires at least: 6.7
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 0.5.1
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

RSVP management for events - let users sign up for events.

== Description ==

Fair RSVP provides RSVP functionality for WordPress events. Users can sign up for events and manage their RSVPs.

**Features (Coming Soon):**

* **User Registration** - Allow logged-in users to RSVP to events
* **Admin Management** - View and manage RSVPs from WordPress admin
* **REST API** - Programmatic access to RSVP data
* **Gutenberg Blocks** - Easy-to-use blocks for displaying RSVP status and buttons

Perfect for event organizers managing attendee sign-ups.

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-rsvp/` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress
3. Navigate to the Fair RSVP menu in WordPress admin to manage RSVPs

== Development ==

* GitHub Repository: https://github.com/marcin-wosinek/fair-event-plugins
* Report Issues: https://github.com/marcin-wosinek/fair-event-plugins/issues
* Contribute: https://github.com/marcin-wosinek/fair-event-plugins/pulls

== Frequently Asked Questions ==

= Can guests (non-logged-in users) RSVP? =

Currently, only logged-in users can RSVP. Guest RSVP support is planned for future releases.

= How do I view RSVPs? =

Navigate to Fair RSVP in the WordPress admin menu to view and manage all RSVPs.

== Changelog ==

## 0.5.1

### Patch Changes

- 7e7ea9c: Update version tested up to version to 6.9.

## 0.5.0

### Minor Changes

- abf66b3: Add invitation workflow.
- e770b62: Add RSVP for anonymous users.

## 0.4.0

### Minor Changes

- be617e1: Add invitation modes to RSVP block
- 97fd67d: Add frontend attendance confirmation

## 0.3.1

### Patch Changes

- 2ba10ce: Improve admin UI for RSVP confirmation

## 0.3.0

### Minor Changes

- eaefbd6: Add confirmation workflow for participants

### Patch Changes

- f4b554d: Improve translations

## 0.2.0

### Minor Changes

- Add participant list block
