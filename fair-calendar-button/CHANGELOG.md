# Changelog

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
