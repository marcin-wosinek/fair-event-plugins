# Fair Event Plugins

A collection of WordPress plugins for running event websites with fair, transparent pricing. Built as a monorepo with shared development tools and standardized patterns.

## Published Plugins

All plugins are available on WordPress.org:

- **[Fair Events](https://wordpress.org/plugins/fair-events/)** - Core event management with custom post types and blocks
- **[Fair Calendar Button](https://wordpress.org/plugins/fair-calendar-button/)** - Add events to Google Calendar, Apple Calendar, etc.
- **[Fair Timetable](https://wordpress.org/plugins/fair-timetable/)** - Display event schedules in an organized timetable format
- **[Fair Schedule Blocks](https://wordpress.org/plugins/fair-schedule-blocks/)** - Gutenberg blocks for event schedules
- **[Fair RSVP](https://wordpress.org/plugins/fair-rsvp/)** - Event registration and attendance management
- **[Fair Membership](https://wordpress.org/plugins/fair-membership/)** - Membership management with fees and groups

### Platform Plugin (Private)

- **fair-platform** - OAuth proxy for Mollie Connect (deployed to fair-event-plugins.com only)

## Development

### Quick Start

Start the development environment with Docker:

```bash
docker compose up
```

This provides:
- **WordPress**: http://localhost:8080
- **phpMyAdmin**: http://localhost:8081

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

## Documentation

### For Developers

- **[CLAUDE.md](./CLAUDE.md)** - Project overview, coding standards, and AI assistant instructions
- **[ADDING_NEW_PLUGIN.md](./ADDING_NEW_PLUGIN.md)** - How to add new plugins to the monorepo
- **[PHP_PATTERNS.md](./PHP_PATTERNS.md)** - PHP best practices and security patterns
- **[REST_API_BACKEND.md](./REST_API_BACKEND.md)** - REST API security and implementation standards
- **[REST_API_USAGE.md](./REST_API_USAGE.md)** - Frontend REST API patterns with apiFetch
- **[REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md)** - React admin pages architecture
- **[TESTING.md](./TESTING.md)** - Testing strategy (Jest, Playwright)

### Operations

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Automated deployment setup
- **[RELEASES.md](./RELEASES.md)** - Release process and versioning

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
- PHP translations: `languages/*.po`, `languages/*.mo`
- JavaScript translations: `build/languages/*.json` (auto-generated)

## Requirements

- **WordPress**: 6.7+
- **PHP**: 8.0+
- **Node.js**: 18+
- **Composer**: 2.0+

## License

GPL v2 or later (unless specified otherwise in individual plugin)

## Support

For plugin issues and questions, visit the support forums on WordPress.org or [open an issue](https://github.com/marcinwosinek/fair-event-plugins/issues).
