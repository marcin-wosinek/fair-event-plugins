# Changelog

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
