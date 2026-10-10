# Changelog

## 1.4.0

### Minor Changes

-   bc63391: Request Mollie settlement access when Fair Finance is active. Connecting to Mollie asks for the same permissions as before, plus permission to read settlements on sites running Fair Finance. The site records the permissions Mollie actually granted and treats settlement access as available only when that permission was granted.

    A site connected before this change keeps accepting payments. Its connection settings now offer **Reconnect**, which goes through the Mollie authorization again without disconnecting first, and Fair Finance's Reconciliation page explains when settlement access still needs to be authorized and links there. Cancelling or failing an authorization leaves the existing connection as it was and says so, instead of ending on an error page.

### Patch Changes

-   9413f36: Load the plugins' own scripts with WordPress's `defer` strategy. The Add to Calendar button script, the payment return notification script, and the admin and editor scripts of these plugins no longer pause page parsing while they download; they stay in the footer and behave as before. WordPress still loads a script the usual way where deferring would break ordering — Manage Event while a plugin adds tabs to it (Fair Audience does), and Fair Events → Settings while an extension adds a settings tab.

## 1.3.0

### Minor Changes

-   3e696d0: Move the "Bundled translations" toggle out of each plugin's own settings screen into a single shared **Settings → Fair Event Plugins** screen that lists one row per active plugin. Previously saved values keep working unchanged. fair-audience and fair-payments-connector lose their Features tab (bundled-translations was its only entry); fair-timetable loses its whole Settings page; fair-platform loses its Features submenu. fair-events keeps its Features tab for the Ticketing bundle. The experimental companion plugins (fair-events-experimental, fair-audience-experimental, fair-payments-connector-experimental) now always load their bundled translation files instead of waiting on a WordPress.org language pack that will never exist for them.

## 1.2.1

### Patch Changes

-   6973be8: Convert hand-rolled admin notices to wp_admin_notice().

## 1.2.0

### Minor Changes

-   aec8208: Add OAuth state parameter to prevent CSRF credential replacement in the Mollie connection flow.

## 1.1.3

### Patch Changes

-   02cf7b6: Default to WordPress.org language packs; gate `load_plugin_textdomain()` and the
    `wp_set_script_translations()` path behind a new per-plugin `bundled-translations`
    feature flag (resolved through the same constant / master / filter / option /
    default chain as the existing Fair Events features). The flag is exposed in
    each plugin's Settings → Features tab (or Features submenu) and defaults to off.

## 1.1.2

### Patch Changes

-   0ebaea4: Group admin menus with string positions to avoid overwriting core menus

    Each plugin's top-level admin menu now registers with a unique string decimal
    position (`20.1`–`20.4`) so the four menus cluster together in order without
    colliding with each other or with core WordPress menu items.

## 1.1.1

### Patch Changes

-   a517212: Fix database table creation on a clean install: declare the primary and secondary keys in dbDelta-compliant form (`PRIMARY KEY  (id)` / `KEY`) instead of inline on the column, which had caused "Multiple primary key defined" errors and a failed activation.
-   7f6ab85: Update the local Docker environment and "Tested up to" headers to WordPress 7.

## 1.1.0

### Minor Changes

-   386d1f9: Store basic info about connected accounts.

### Patch Changes

-   a25d6c7: Move Mollie payment integration to OAuth & Mollie Connect.

All notable changes to Fair Platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - TBD

### Added

-   Initial release
-   OAuth authorization endpoint (`/oauth/authorize`)
-   OAuth callback endpoint (`/oauth/callback`)
-   OAuth refresh endpoint (`/oauth/refresh`)
-   Admin status page showing configuration
-   CSRF protection with state tokens
-   HTTPS-only security checks
-   Mollie PHP library integration

### Security

-   Client secret stored only on platform server
-   State tokens expire after 10 minutes
-   All OAuth communication over HTTPS
-   Input sanitization and validation
-   No token storage on platform (stateless)

## [Unreleased]

### TODO

-   Implement `handle_callback()` - exchange OAuth code for tokens
-   Implement `handle_refresh()` - refresh expired access tokens
-   Add rate limiting to prevent abuse
-   Add logging for OAuth flow debugging
-   Add webhook support for payment status updates
