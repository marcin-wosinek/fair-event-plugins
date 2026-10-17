# Changelog

## 1.6.0

### Minor Changes

- 68ef130: Each plugin now ships documentation of its blocks in `block-docs/`, matched
  to the release: `index.json` lists every block the plugin supplies, with its
  owning plugin, block.json, status, and when it is registered, and each block
  has a usage guide and serialized examples that open in the editor without
  validation errors. Site tooling and AI assistants can read these files from
  the installed plugin and compare them with the blocks a site reports through
  WordPress's authenticated `/wp/v2/block-types` endpoint.

## 1.5.5

### Patch Changes

- 9603b8d: Update the bundled calendar-link library from 2.11.4 to 2.11.6 and Recharts
  from 3.10.0 to 3.10.1. Calendar exports and the statistics and comparison
  charts show the same dates, values and tooltips as before.

    The Fair Events calendar button now passes all-day events to the calendar
    as plain dates, so they stay on their day in every timezone. Without this,
    the updated library would have moved them one day later for visitors in
    UTC+12 timezones, such as New Zealand in winter or Fiji.

## 1.5.4

### Patch Changes

- 0c94b22: Calculate Calendar Button repeat dates the same way Fair Events does. An event that repeats until a chosen date now includes the occurrence that falls on that date, even when it starts later in the day, and the editor's occurrence calendar marks the right end day in timezones behind UTC. Existing blocks keep their saved repeat rule until the repeat settings are edited.

## 1.5.3

### Patch Changes

- a439c54: Restore the standalone Fair Calendar Button plugin build so its wp.org listing can keep shipping, versioned independently starting from 1.5.2.

## 1.5.2

### Patch Changes

- 7e7ea9c: Update version tested up to version to 6.9.

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
