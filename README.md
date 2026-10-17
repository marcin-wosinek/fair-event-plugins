# Fair Event Plugins

A collection of WordPress plugins for running event websites with fair, transparent pricing. Built as a monorepo with shared development tools and standardized patterns.

## Plugins

Published on WordPress.org:

-   **[Fair Events](https://wordpress.org/plugins/fair-events/)** - Recurring events, venues, public calendars, ticket configuration, free signup, and signup administration; paid checkout requires Fair Payments Connector
-   **[Fair Audience](https://wordpress.org/plugins/fair-audience/)** - Participant profiles, attendee management, and mailing subscriptions; integrates with Fair Events signups and statistics
-   **[Fair Timetable](https://wordpress.org/plugins/fair-timetable/)** - Timetable management for events & weekly activities

In the monorepo, not (yet) published:

-   **fair-payments-connector** - Payment blocks and Mollie integration
-   **fair-finance** - Budgeting, financial entries, and reconciliation
-   **fair-form** - Form blocks and answer data layer
-   **fair-events-experimental** - Requires Fair Events; adds source configuration and feeds, group rules, schedule editing, event comparisons, and optional Meta conversions. Group rules and comparisons require Fair Audience; Meta conversions require Fair Payments Connector
-   **fair-audience-experimental** - Fair Audience companion, including scheduled event mailings
-   **fair-payments-connector-experimental** - Feature-flag companion for Fair Payments Connector
-   **fair-calendar-button** - Standalone Add to Calendar block; Fair Events also provides its own button variation
-   **fair-events-shared** - Shared JS utilities (private workspace package)

### Platform Plugin (Private)

-   **fair-platform** - OAuth proxy for Mollie Connect (deployed to fair-event-plugins.com only)

## Development

### Quick Start

Start the development environment with Docker:

```bash
docker compose up
```

This provides:

-   **WordPress**: http://localhost:8080
-   **phpMyAdmin**: http://localhost:8081

### Build Commands

```bash
# Start all plugins in watch mode
npm start

# Build all plugins for production
npm run build

# Format code (JavaScript, CSS, PHP)
npm run format

# Run tests
npm test
```

### Working with Plugins

Each plugin is a workspace in the monorepo:

```bash
# Work in a specific plugin
cd fair-events
npm run start    # Watch mode for this plugin only
npm run build    # Build this plugin only
```

### For Developers

-   **[CLAUDE.md](./CLAUDE.md)** - Project overview, coding standards, and AI assistant instructions
-   **[ADDING_NEW_PLUGIN.md](./ADDING_NEW_PLUGIN.md)** - How to add new plugins to the monorepo
-   **[PHP_PATTERNS.md](./PHP_PATTERNS.md)** - PHP best practices and security patterns
-   **[REST_API_BACKEND.md](./REST_API_BACKEND.md)** - REST API security and implementation standards
-   **[REST_API_USAGE.md](./REST_API_USAGE.md)** - Frontend REST API patterns with apiFetch
-   **[REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md)** - React admin pages architecture
-   **[TESTING.md](./TESTING.md)** - Testing strategy (Jest, Playwright)

### Operations

-   **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Automated deployment setup
-   **[RELEASES.md](./RELEASES.md)** - Release process and versioning

## Translation

Generate and update translations:

```bash
cd fair-events  # Or any plugin
npm run makepot      # Generate .pot template
npm run updatepo     # Update .po files
npm run makemo       # Generate .mo files
npm run build        # Build with translations
```

Translation files:

-   PHP translations: `languages/*.po`, `languages/*.mo`
-   JavaScript translations: `build/languages/*.json` (auto-generated)

## Requirements

-   **WordPress**: 7.0+ for Fair Events, Fair Events Experimental, Fair
    Audience, Fair Audience Experimental and Fair Form; 6.7+ for the other
    plugins. Each plugin's `Requires at least` header is authoritative.
-   **PHP**: 8.0+
-   **Node.js** (development only): 24.15+ (or 22.22.2+), required by
    `@wordpress/scripts` 36
-   **Composer**: 2.0+

### WordPress compatibility

The admin screens built with `@wordpress/dataviews` depend on the `wp-theme`
script that WordPress registers from 7.0, which is why the plugins that ship
them require 7.0. The `@wordpress/*` packages target React 19 but still
support React 18, which every released WordPress version, including 7.1,
ships. Builds are checked on the oldest supported core (6.7 and 7.0) and on
the latest release.

## License

GPL v2 or later (unless specified otherwise in individual plugin)

## Support

For plugin issues and questions, visit the support forums on WordPress.org or [open an issue](https://github.com/marcinwosinek/fair-event-plugins/issues).
