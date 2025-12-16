## Project Overview

This is a WordPress plugin collection called "Fair Event Plugins" for event
organization with fair pricing models. 

## Development Commands

### Frontend Development
```bash
cd fair-payment
npm run start    # Start development server with hot reload
npm run build    # Build production assets for blocks
npm run format   # Format code
```

### WordPress Development Environment
```bash
docker compose up        # Start WordPress (localhost:8080), MySQL, and phpMyAdmin (localhost:8081)
docker compose --profile cli run wpcli wp --help    # Run WP-CLI commands
```

### PHP Code Quality
```bash
cd fair-payment  # or fair-calendar-button or fair-schedule
composer install         # Install PHP dependencies
vendor/bin/phpcs        # Run PHP code sniffer (if configured)
```

### Code Quality Reminder
**IMPORTANT**: Claude Code will prompt you to run `npm run format` after making code changes. Please run this command when prompted to ensure consistent formatting across the codebase.

**For Claude Code**: Do NOT automatically run formatting tools (npm run format, vendor/bin/phpcs, etc.). Instead, remind the user to run these commands themselves after code changes are complete.

### Code Formatter Ignore Patterns
The following directories are automatically excluded from code formatting:
- `**/svn/` - WordPress.org SVN repository copies (excluded in `.prettierignore` and `phpcs.xml`)
- `**/build/` - Built assets
- `**/vendor/` - PHP dependencies
- `**/node_modules/` - JavaScript dependencies

**Configuration files**:
- `.prettierignore` - Excludes directories from JavaScript/CSS formatting (Prettier)
- `phpcs.xml` - Excludes directories from PHP formatting (PHP_CodeSniffer)

These ignore patterns ensure that only source files are formatted, not generated files or SVN copies.

## Architecture

### PHP Architecture
- Uses PHP 8.0+ with PSR-4 autoloading standards
- Namespace: `FairPayment` with sub-namespaces for components
- WordPress hooks: `init` for block registration, `admin_menu` for admin interface

### Development Environment
- Docker Compose setup with WordPress, MySQL, and phpMyAdmin
- Plugin mounted directly into WordPress plugins directory
- WP-CLI available via Docker profile for WordPress management

### PHP Best Practices

**IMPORTANT**: Follow secure PHP coding patterns documented in [PHP_PATTERNS.md](./PHP_PATTERNS.md).

**Key patterns include:**
- **Database queries**: Use `wpdb::prepare()` with `%i` for table/column names, `%s`/`%d`/`%f` for values
- **Security**: Prevent direct file access, verify nonces, sanitize input, escape output
- **PSR-4 autoloading**: Match namespace casing to directory structure (case-sensitive on Linux)

See [PHP_PATTERNS.md](./PHP_PATTERNS.md) for complete examples and anti-patterns to avoid.

## Key Integration Points

- Block registration happens in `fair-calendar-button.php:register_simple_payment_block()`
- Admin page registered via `FairPayment\Admin\register_admin_menu()`
- Frontend rendering handled by `FairPayment\render_simple_payment_block()`
- Block editor scripts built from `src/blocks/simple-payment/index.js` to `build/index.js`

## Adding New Plugins to the Monorepo

When creating a new plugin (e.g., `fair-new-plugin`), update these files outside the plugin directory:

### Root package.json
1. **Line ~27**: Add to start script: `& npm run start --workspace=fair-new-plugin`
2. **Line ~30**: Add to format:php script: `fair-new-plugin/src/ fair-new-plugin/__tests__/`
3. **Line ~42**: Add dist-archive script: `"dist-archive:fair-new-plugin": "wp dist-archive fair-new-plugin dist --create-target-dir"`
4. **Lines ~951-957**: Add to workspaces array: `"fair-new-plugin"`

### GitHub CI (.github/workflows/php-ci.yml)
- **Lines ~32-37**: Add vendor cache path: `./fair-new-plugin/vendor`

### Docker Compose (compose.yml)
Add plugin mount to all WordPress services:
- **Line ~14**: Main WordPress: `- ./fair-new-plugin:/var/www/html/wp-content/plugins/fair-new-plugin`
- **Line ~79**: PHP 7.4 service
- **Line ~116**: WP 6.3 service
- **Line ~152**: WP 6.7 service

### Scripts (scripts/sync-wp-versions.js)
**Lines ~20-51**: Add plugin configuration:
```javascript
{
    name: 'fair-new-plugin',
    packagePath: 'fair-new-plugin/package.json',
    phpFiles: ['fair-new-plugin/fair-new-plugin.php'],
    readmeFiles: ['fair-new-plugin/readme.txt'],
}
```

## Shared Code Package

### fair-events-shared
A workspace package containing shared JavaScript utilities used across multiple Fair Event plugins:
- **fair-events**: Event post type and blocks
- **fair-calendar-button**: Calendar button block
- **fair-timetable**: Event timetable functionality

**Location**: `fair-events-shared/`
**Type**: Private workspace package (not published)
**Usage**: Add `"fair-events-shared": "*"` to plugin's `dependencies` in package.json

**Structure**:
- `src/index.js` - Main entry point
- `__tests__/` - Jest test files
- Uses ES modules (`"type": "module"`)
- Configured with Jest + Babel for testing

**Adding utilities**:
1. Create utility file in `src/`
2. Export from `src/index.js`
3. Import in consuming plugins: `import { utility } from 'fair-events-shared'`

## Translation (i18n) Setup

### The Problem
WordPress generates translation JSON files with MD5 hashes based on source file paths (`src/blocks/*/editor.js`), but loads them based on build file paths (`build/blocks/*/editor.js`). This causes hash mismatch and translations fail to load.

### Solution: Official WordPress --use-map Approach

**Reference**: [WP-CLI i18n make-json documentation](https://developer.wordpress.org/cli/commands/i18n/make-json/)

#### 1. Install webpack-bundle-output Plugin
```bash
npm install --save-dev webpack-bundle-output
```

#### 2. Update webpack.config.cjs
```javascript
const BundleOutputPlugin = require('webpack-bundle-output');

module.exports = {
  ...defaultConfig,
  plugins: [
    ...defaultConfig.plugins,
    new BundleOutputPlugin({
      cwd: process.cwd(),
      output: 'map.json',
    }),
  ],
};
```

This generates `build/map.json` mapping source files to build files.

#### 3. Update package.json Scripts
```json
{
  "makepot": "wp i18n make-pot . languages/plugin-name.pot --exclude=node_modules,vendor,tests,build",
  "makejson": "wp i18n make-json languages ./build/languages --domain=plugin-name --pretty-print --no-purge --use-map=build/map.json",
  "makemo": "wp i18n make-mo languages/",
  "updatepo": "wp i18n update-po languages/plugin-name.pot languages/"
}
```

Key change: Add `--use-map=build/map.json` to makejson script.

#### 4. Set Translation Paths in PHP
```php
// In BlockHooks.php or similar
wp_set_script_translations(
    'plugin-name-block-name-editor-script',
    'plugin-name',
    dirname( __DIR__, 2 ) . '/build/languages'  // Note: build/languages for JSON
);
```

**Important**:
- PHP `.mo` files: `languages/`
- JavaScript `.json` files: `build/languages/`

#### Translation Workflow
```bash
npm run makepot     # Generate .pot from source
npm run updatepo    # Update .po files from .pot
# Translate .po files (manually or with tools)
npm run makemo      # Generate .mo files (PHP)
npm run build       # Builds JS and runs makejson (generates JSON with correct hashes)
```

#### `load_plugin_textdomain()` Not Required for Modern Plugins

**Important**: Since WordPress 4.6, `load_plugin_textdomain()` is **NOT REQUIRED** for plugins.

**Why?**
- WordPress automatically loads translations from translate.wordpress.org
- Translations are loaded based on the plugin's text domain (which must match the plugin slug)
- The `Text Domain` header in the main plugin file is optional but recommended

**When to use `load_plugin_textdomain()`:**
- Only if you want to override translate.wordpress.org translations with your own custom translations
- For plugins that need to support WordPress < 4.6 (not applicable to this project)

**For this project:**
- All plugins require WordPress 6.7+ (far above 4.6)
- Text domains match plugin slugs (e.g., `fair-membership`)
- **Do NOT add `load_plugin_textdomain()` calls**
- PHP `.mo` files are automatically loaded from the `languages/` directory
- JavaScript translations use `wp_set_script_translations()` pointing to `build/languages/`

**Reference**: [WordPress Plugin Internationalization Handbook](https://developer.wordpress.org/plugins/internationalization/how-to-internationalize-your-plugin/#loading-text-domain)

- Don't use php templates.

## Frontend JavaScript Best Practices

### Defensive DOM Ready Pattern

When using `viewScript` in block.json for frontend JavaScript, WordPress loads scripts after block markup is rendered. However, with caching plugins or deferred script loading, the DOM might already be ready when the script executes.

**Problem**: Using only `DOMContentLoaded` event listener fails if the script loads after DOM is ready (the event has already fired).

**Solution**: Use a defensive pattern that handles both scenarios:

```javascript
(function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initializeFunction);
	} else {
		initializeFunction();
	}

	function initializeFunction() {
		// Your initialization code here
	}
})();
```

**How it works**:
- Checks `document.readyState` to determine if DOM is still loading
- If loading: waits for `DOMContentLoaded` event
- If already loaded ('interactive' or 'complete'): executes immediately

**When to use**: All `viewScript` files that need to manipulate the DOM or attach event handlers to block elements.

**Example**: See `fair-rsvp/src/blocks/rsvp-button/frontend.js`

## WordPress REST API Integration

**IMPORTANT**: When implementing WordPress REST API functionality, you MUST follow the guidelines documented in:
- **Frontend**: [REST_API_USAGE.md](./REST_API_USAGE.md) - JavaScript/Frontend implementation
- **Backend**: [REST_API_BACKEND.md](./REST_API_BACKEND.md) - PHP/Security standards ⚠️ **CRITICAL**

### Quick Reference - Frontend

**Always use `apiFetch()` for WordPress REST APIs:**

```javascript
import apiFetch from '@wordpress/api-fetch';

// Use hardcoded paths - they are preferred
const data = await apiFetch({
    path: '/plugin-name/v1/endpoint',
    method: 'POST',
    data: { key: 'value' },
});
```

**Key Requirements:**
- ✅ Use `@wordpress/api-fetch` for all WordPress REST API calls
- ✅ Use hardcoded paths (e.g., `/fair-payment/v1/payments`)
- ✅ Always start paths with `/`
- ✅ Add viewScript to webpack config entries
- ✅ Register blocks from `build/` directory, not `src/`
- ❌ Never use raw `fetch()` for WordPress REST APIs
- ❌ Never use dynamic URL construction with `rest_url()`

**Complete Documentation:**
- Implementation patterns: See [REST_API_USAGE.md#best-practices](./REST_API_USAGE.md#best-practices-for-wordpress-rest-api-calls)
- Testing strategy: See [REST_API_USAGE.md#testing-strategy](./REST_API_USAGE.md#testing-strategy-for-rest-api-calls)
- Error handling: See [REST_API_USAGE.md#error-handling](./REST_API_USAGE.md#best-practices-for-wordpress-rest-api-calls)

### Quick Reference - Backend (PHP)

**WordPress handles nonces AUTOMATICALLY - never verify manually:**

```php
// ❌ WRONG - Do NOT manually verify nonces
public function create_item( $request ) {
    if ( ! wp_verify_nonce( ... ) ) {  // ❌ NEVER DO THIS
        return new WP_Error( ... );
    }
}

// ✅ CORRECT - WordPress verifies nonce automatically, just check permissions
public function create_item_permissions_check( $request ) {
    return is_user_logged_in();  // ✅ This is enough
}
```

**NEVER use `__return_true` for authenticated endpoints:**

```php
// ❌ WRONG - Security vulnerability for authenticated operations
'permission_callback' => '__return_true'

// ✅ CORRECT - Require logged in user
'permission_callback' => 'is_user_logged_in'

// ✅ CORRECT - Require admin capability
'permission_callback' => function() {
    return current_user_can( 'manage_options' );
}

// ✅ OK - For truly public endpoints (webhooks, anonymous forms)
'permission_callback' => '__return_true'  // Must document why
```

**Always extend `WP_REST_Controller`** and implement proper permission callbacks.

See [REST_API_BACKEND.md](./REST_API_BACKEND.md) for complete security standards and templates.

### Standard Directory Structure

**ALL plugins MUST use `src/API/` (uppercase "API") for REST API controllers:**

```
fair-plugin-name/
├── src/
│   └── API/                           # REST API directory (uppercase "API")
│       ├── PluginNameController.php   # Main resource controller
│       └── OtherController.php        # Additional controllers
```

**Why uppercase "API"?**
- Case sensitivity: Linux (production) is case-sensitive, macOS (development) is not
- PSR-4 autoloading: Clear mapping between namespace `PluginName\API` and directory `src/API/`
- Common convention: Uppercase acronyms in namespaces

**Registration pattern:**

```php
<?php
// In src/Core/Plugin.php

namespace FairPluginName\Core;

use FairPluginName\API\PluginNameController;

class Plugin {
    public function __construct() {
        add_action( 'rest_api_init', array( $this, 'register_api_endpoints' ) );
    }

    public function register_api_endpoints() {
        $controller = new PluginNameController();
        $controller->register_routes();
    }
}
```

See [REST_API_BACKEND.md#file-organization-and-project-structure](./REST_API_BACKEND.md#file-organization-and-project-structure) for complete templates.

### Implementation Checklist

When adding a new REST API integration:

1. **Backend (PHP)** - See [REST_API_BACKEND.md](./REST_API_BACKEND.md):
   - [ ] Create controller in `src/API/` directory (uppercase "API")
   - [ ] Extend `WP_REST_Controller` base class
   - [ ] Register routes in `rest_api_init` hook
   - [ ] **CRITICAL**: Add proper permission callbacks (NEVER `__return_true` for authenticated endpoints)
   - [ ] Validate and sanitize all inputs
   - [ ] Return proper HTTP status codes (401, 403, 404, 500)

2. **Frontend (JavaScript)** - See [REST_API_USAGE.md](./REST_API_USAGE.md):
   - [ ] Import `apiFetch` from `@wordpress/api-fetch`
   - [ ] Use hardcoded path starting with `/`
   - [ ] Add to webpack config if viewScript
   - [ ] Handle errors with nested message extraction
   - [ ] Show loading states during requests

3. **Testing** (see REST_API_USAGE.md for details):
   - [ ] PHP integration tests for endpoints
   - [ ] Frontend unit tests for error handling
   - [ ] E2E tests for critical flows (optional)

**Why apiFetch()?**
- Automatically handles pretty vs plain permalinks
- Includes WordPress nonce authentication
- Standardized error handling
- No manual URL construction needed

## React Admin Pages Pattern

**IMPORTANT**: All admin pages should be built with React and use REST API for data management. Follow the guidelines documented in [REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md).

### Quick Reference

**Standard Architecture**:
1. **PHP**: Admin menu registration + page wrapper (renders `<div id="root">`)
2. **React**: Admin component using `@wordpress/components`
3. **REST API**: Backend controller extending `WP_REST_Controller`
4. **Communication**: `apiFetch` for all API calls

**Directory Structure**:
```
plugin-name/
├── src/
│   ├── Admin/
│   │   ├── AdminHooks.php           # Menu + script enqueue
│   │   ├── PageNamePage.php         # PHP wrapper
│   │   └── page-name/
│   │       ├── index.js             # React entry point
│   │       └── PageName.js          # React component
│   └── API/
│       ├── RestHooks.php            # REST registration
│       └── ResourceController.php   # REST controller
└── build/admin/page-name/           # Built files
```

**Example Implementations**:
- **fair-rsvp**: Events List, Invitations, Attendance (most complete)
- **fair-membership**: Membership Matrix
- **fair-payment**: Settings Page

See [REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md) for complete templates and best practices.

- Make sure to pay attention to case in file & folder names. I'm programming on MacOs (that is case insensitive), but I'm building at Linux (case sensitive system)

## Testing Architecture

**IMPORTANT**: This project follows a unified testing architecture documented in [TESTING.md](./TESTING.md).

### Quick Reference

**Test Types and Locations**:
- **Unit Tests**: `src/**/__tests__/*.test.js` - Jest for utilities and functions
- **Component Tests**: `src/**/components/__tests__/*.test.jsx` - Jest + React Testing Library
- **API Tests**: `src/API/__tests__/*.api.spec.js` - Playwright for REST endpoints
- **E2E Tests**: `e2e/**/*.spec.js` - Playwright for user flows

**Running Tests**:
```bash
npm test              # Run all tests
npm run test:js       # Jest (unit + component)
npm run test:api      # Playwright API tests
npm run test:e2e      # Playwright E2E tests
```

**Complete Documentation**: See [TESTING.md](./TESTING.md) for:
- Directory structure and naming conventions
- Configuration templates (jest.config.js, playwright.config.js)
- Test discovery rules and best practices
- Migration guide for existing plugins
- Rollout strategy
