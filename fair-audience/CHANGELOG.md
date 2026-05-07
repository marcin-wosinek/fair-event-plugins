# Changelog

## 1.2.0

### Minor Changes

-   41a295c: Improve event audience management. Edit ticket type and options on existing sign-ups via a popup, delete sign-ups, and store the chosen option name on the sign-up record. Audience table gains copy buttons, activity totals, side counter, ticket shortname, and a wider layout that shows the activity options purchased by each participant.
-   41a295c: Improve participant management. Add a link to edit a user's mailing settings, and a remove-user button that anonymizes the participant across groups, poll access keys, and poll responses.
-   41a295c: Update the sign-up confirmation email and apply discount logic across activities and ticket options at sign-up time.
-   41a295c: Link tickets to event activities. Tickets can now be assigned to specific activities by ID, with per-activity discounts (including facilitator-based discounts) applied at sign-up and at the option level. Ticket option table extended to support this.

### Patch Changes

-   41a295c: Fix missing link from membership payment to participant.
-   41a295c: Fix free ticket error, ticket break in the editor, and price setting error.
-   41a295c: Activity log improvements. Combine multiple user sign-ups into a single timeline entry, add event sign-up entries, and hide test payments from the activity log.

## 1.1.1

### Patch Changes

-   e22779c: Add email notification to form sign up & registrations
-   c8a6a54: Add participant's import form kit.com

## 1.1.0

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
