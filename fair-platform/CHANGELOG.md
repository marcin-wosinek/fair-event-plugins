# Changelog

All notable changes to Fair Platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - TBD

### Added
- Initial release
- OAuth authorization endpoint (`/oauth/authorize`)
- OAuth callback endpoint (`/oauth/callback`)
- OAuth refresh endpoint (`/oauth/refresh`)
- Admin status page showing configuration
- CSRF protection with state tokens
- HTTPS-only security checks
- Mollie PHP library integration

### Security
- Client secret stored only on platform server
- State tokens expire after 10 minutes
- All OAuth communication over HTTPS
- Input sanitization and validation
- No token storage on platform (stateless)

## [Unreleased]

### TODO
- Implement `handle_callback()` - exchange OAuth code for tokens
- Implement `handle_refresh()` - refresh expired access tokens
- Add rate limiting to prevent abuse
- Add logging for OAuth flow debugging
- Add webhook support for payment status updates
