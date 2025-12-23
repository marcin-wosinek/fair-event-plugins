# Adding a New Plugin to Fair Event Plugins Monorepo

This guide documents the complete process of adding a new plugin to the Fair Event Plugins monorepo. Follow these steps to ensure proper integration with the build system, CI/CD pipeline, and development workflow.

## Table of Contents

1. [Plugin Directory Structure](#plugin-directory-structure)
2. [Required Files](#required-files)
3. [Root Monorepo Updates](#root-monorepo-updates)
4. [Configuration Templates](#configuration-templates)
5. [Translation Setup](#translation-setup)
6. [Testing Setup](#testing-setup)
7. [Versioning and Deployment](#versioning-and-deployment)
8. [Checklist](#checklist)

## Plugin Directory Structure

Create a new directory `fair-plugin-name/` in the monorepo root with this structure:

```
fair-plugin-name/
├── src/                           # PHP source files
│   ├── Core/
│   │   └── Plugin.php             # Main plugin class
│   ├── Hooks/
│   │   └── BlockHooks.php         # Block registration
│   ├── API/                       # REST API controllers (uppercase "API")
│   ├── Admin/                     # Admin pages
│   │   ├── AdminHooks.php
│   │   └── page-name/             # React admin components
│   │       ├── index.js
│   │       └── PageName.js
│   ├── blocks/                    # Block source files
│   │   └── block-name/
│   │       ├── block.json
│   │       ├── editor.js
│   │       ├── render.php         # Server-side rendering
│   │       ├── style.scss
│   │       ├── editor.scss
│   │       └── components/
│   ├── Models/                    # Database models
│   └── Helpers/                   # Utility functions
├── build/                         # Compiled assets (gitignored)
│   ├── blocks/
│   ├── admin/
│   ├── languages/                 # JavaScript .json translation files
│   └── map.json                   # Source-to-build mapping for translations
├── languages/                     # PHP .pot/.po/.mo translation files
│   ├── fair-plugin-name.pot
│   ├── fair-plugin-name-pl_PL.po
│   └── fair-plugin-name-pl_PL.mo
├── assets/                        # WordPress.org assets
│   ├── icon-128x128.png
│   ├── icon-256x256.png
│   ├── banner-772x250.png
│   └── banner-1544x500.png
├── svn/                           # WordPress.org SVN checkout (gitignored)
├── __tests__/                     # Jest unit tests
│   └── *.test.js
├── e2e/                           # Playwright E2E tests
│   └── *.spec.js
├── fair-plugin-name.php           # Main plugin file
├── package.json                   # npm configuration
├── composer.json                  # PHP dependencies and autoloading
├── webpack.config.cjs             # Webpack configuration
├── jest.config.js                 # Jest test configuration
├── playwright.config.js           # Playwright test configuration
├── readme.txt                     # WordPress.org readme
├── CHANGELOG.md                   # Version history
├── .gitignore                     # Git ignore patterns
└── .distignore                    # Distribution ignore patterns
```

**Important**: Use uppercase `API` for REST API directory to ensure PSR-4 autoloading works correctly on case-sensitive filesystems (Linux production servers).

## Required Files

### 1. Main Plugin File: `fair-plugin-name.php`

**Template:**

```php
<?php
/**
 * Plugin Name: Fair Plugin Name
 * Plugin URI: https://fair-event-plugins.com
 * Description: Brief description of what this plugin does
 * Version: 0.1.0
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPL-3.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-plugin-name
 * Domain Path: /languages
 * Requires at least: 6.7
 * Requires PHP: 8.0
 *
 * @package FairPluginName
 */

namespace FairPluginName;

defined( 'ABSPATH' ) || die;

// Plugin constants.
define( 'FAIR_PLUGIN_NAME_VERSION', '0.1.0' );
define( 'FAIR_PLUGIN_NAME_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAIR_PLUGIN_NAME_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// Composer autoloader.
require_once __DIR__ . '/vendor/autoload.php';

// Initialize plugin.
use FairPluginName\Core\Plugin;
Plugin::instance()->init();

/**
 * Activation hook.
 */
function fair_plugin_name_activate() {
	// Database setup, rewrite rules, default options, etc.
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\\fair_plugin_name_activate' );

/**
 * Deactivation hook.
 */
function fair_plugin_name_deactivate() {
	// Cleanup (flush rewrite rules, clear scheduled events, etc.)
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\fair_plugin_name_deactivate' );
```

**Key points:**
- Version must match `package.json`
- Text Domain must match plugin slug (directory name)
- Namespace should be PascalCase version of plugin slug
- Requires at least: 6.7, Requires PHP: 8.0 (or higher based on needs)

### 2. Package.json

**Template:**

```json
{
	"name": "fair-plugin-name",
	"version": "0.1.0",
	"description": "Fair Plugin Name WordPress plugin",
	"license": "GPL-3.0-or-later",
	"author": "Marcin Wosinek",
	"type": "module",
	"main": "build/index.js",
	"scripts": {
		"build": "wp-scripts build --config webpack.config.cjs; npm run makejson",
		"clean": "rm -rf build",
		"prebuild": "npm run clean",
		"start": "wp-scripts start",
		"format": "wp-scripts format",
		"composer:install": "composer install",
		"composer:install:prod": "composer install --no-dev",
		"composer:update": "composer update",
		"composer:validate": "composer validate --strict",
		"makepot": "wp i18n make-pot . languages/fair-plugin-name.pot --exclude=node_modules,vendor,tests,build,svn",
		"makejson": "wp i18n make-json languages ./build/languages --domain=fair-plugin-name --pretty-print --no-purge --use-map=build/map.json",
		"makemo": "wp i18n make-mo languages/",
		"updatepo": "wp i18n update-po languages/fair-plugin-name.pot languages/",
		"test": "npm-run-all test:js",
		"test:js": "jest",
		"test:php": "vendor/bin/phpunit",
		"test:e2e": "playwright test",
		"playwright:run": "playwright test --headed",
		"playwright:up": "playwright test --headed --ui",
		"svn:checkout": "svn co https://plugins.svn.wordpress.org/fair-plugin-name svn",
		"svn:copy": "cp -r readme.txt fair-plugin-name.php src package* composer* languages CHANGELOG.md svn/trunk; cp assets/* svn/assets"
	},
	"dependencies": {
		"@wordpress/api-fetch": "^7.2.0",
		"@wordpress/block-editor": "^15.2.0",
		"@wordpress/blocks": "^15.2.0",
		"@wordpress/components": "^30.2.0",
		"@wordpress/i18n": "^6.2.0",
		"fair-events-shared": "*"
	},
	"devDependencies": {
		"@babel/core": "^7.28.3",
		"@babel/preset-env": "^7.28.3",
		"@playwright/test": "^1.40.0",
		"@wordpress/scripts": "^30.20.0",
		"babel-jest": "^30.0.5",
		"dotenv": "^16.3.1",
		"jest": "^30.0.0",
		"webpack-bundle-output": "^1.1.0"
	}
}
```

**Key points:**
- `"type": "module"` is required for ES modules
- `build` script must run `makejson` after building to generate translation JSON files
- `makejson` requires `--use-map=build/map.json` for correct translation hashes
- `fair-events-shared` dependency only if you need shared utilities
- Add `webpack-bundle-output` to devDependencies for translation mapping

### 3. Composer.json

**Template:**

```json
{
	"name": "marcin-wosinek/fair-plugin-name",
	"description": "Fair Plugin Name WordPress plugin",
	"type": "wordpress-plugin",
	"license": "GPL-3.0-or-later",
	"authors": [
		{
			"name": "Marcin Wosinek",
			"email": "marcin.wosinek@gmail.com"
		}
	],
	"require": {
		"php": ">=8.0 <9.0"
	},
	"autoload": {
		"psr-4": {
			"FairPluginName\\": "src/"
		}
	}
}
```

**Key points:**
- PSR-4 autoloading: `FairPluginName\\` → `src/`
- Namespace must match directory names (case-sensitive on Linux)
- PHP version requirement should match main plugin file

### 4. Webpack Configuration: `webpack.config.cjs`

**Template:**

```javascript
const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const BundleOutputPlugin = require('webpack-bundle-output');

// Get default entries
const defaultEntries = defaultConfig.entry();

// Custom configuration
const customConfig = {
	...defaultConfig,
	entry: () => ({
		...defaultEntries,
		// Add custom admin pages if needed
		'admin/page-name/index': path.resolve(
			process.cwd(),
			'src/Admin/page-name/index.js'
		),
	}),
	plugins: [
		...defaultConfig.plugins,
		// Required for translation mapping
		new BundleOutputPlugin({
			cwd: process.cwd(),
			output: 'map.json',
		}),
	],
};

module.exports = customConfig;
```

**Key points:**
- Extends `@wordpress/scripts` default configuration
- Add custom entries for admin pages
- `BundleOutputPlugin` is **required** for translation system
- Generates `build/map.json` mapping source files to build files

### 5. .gitignore

**Template:**

```
# Build artifacts
/build/
/vendor/
/node_modules/

# WordPress.org SVN
/svn/

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.sublime-project
*.sublime-workspace

# Testing
/playwright-report/
/test-results/

# Logs
*.log
npm-debug.log*
```

### 6. .distignore

**Template for WordPress.org distribution:**

```
# Development files
.git/
.gitignore
.github/
node_modules/
tests/
__tests__/
e2e/
svn/
src/
.distignore
.editorconfig
.eslintrc.js
.prettierrc.js
composer.json
composer.lock
package.json
package-lock.json
phpcs.xml
webpack.config.cjs
jest.config.js
playwright.config.js
*.md
!CHANGELOG.md

# Build artifacts that should be included
!/build/
!/vendor/
```

**Important**: Build artifacts (`build/`, `vendor/`) should be **included** in the distribution but **excluded** from git.

### 7. readme.txt (WordPress.org format)

**Template:**

```
=== Fair Plugin Name ===
Contributors: marcinwosinek
Tags: events, calendar, block
Requires at least: 6.7
Tested up to: 6.8
Requires PHP: 8.0
Stable tag: 0.1.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Brief description for WordPress.org plugin directory (max 150 characters).

== Description ==

Detailed description of the plugin functionality.

**Features:**
* Feature 1
* Feature 2
* Feature 3

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/fair-plugin-name/`
2. Activate the plugin through the 'Plugins' screen in WordPress
3. Configure settings via the admin menu

== Frequently Asked Questions ==

= Question 1? =

Answer 1.

== Changelog ==

= 0.1.0 =
* Initial release

== Upgrade Notice ==

= 0.1.0 =
Initial release
```

**Key points:**
- `Stable tag` must match version in `package.json` and main PHP file
- Use Markdown formatting for readability
- Keep synchronization with `CHANGELOG.md`

## Root Monorepo Updates

When adding a new plugin, you must update these files in the monorepo root:

### 1. Root `package.json`

**Location**: `/package.json`

**Changes required:**

```json
{
  "scripts": {
    "start": "npm run start --workspace=fair-timetable & npm run start --workspace=fair-events & npm run start --workspace=fair-rsvp & npm run start --workspace=fair-plugin-name",
    "format:php": "prettier --write --parser php 'fair-timetable/src/**/*.php' 'fair-events/src/**/*.php' 'fair-rsvp/src/**/*.php' 'fair-plugin-name/src/**/*.php'",
    "dist-archive:fair-plugin-name": "wp dist-archive fair-plugin-name dist --create-target-dir"
  },
  "workspaces": [
    "fair-calendar-button",
    "fair-payment",
    "fair-events",
    "fair-events-shared",
    "fair-rsvp",
    "fair-user-import",
    "fair-plugin-name"
  ]
}
```

**Lines to update:**
- Line ~27: Add to `start` script (append `& npm run start --workspace=fair-plugin-name`)
- Line ~30: Add to `format:php` script (append plugin path)
- Line ~42: Add `dist-archive:fair-plugin-name` script
- Lines ~951-957: Add to `workspaces` array

### 2. GitHub CI Configuration

**Location**: `/.github/workflows/php-ci.yml`

**Changes required:**

```yaml
- name: Cache Composer packages
  id: composer-cache
  uses: actions/cache@v3
  with:
      path: |
          ./fair-calendar-button/vendor
          ./fair-payment/vendor
          ./fair-events/vendor
          ./fair-rsvp/vendor
          ./fair-plugin-name/vendor  # Add this line
          ./vendor
```

**Lines to update:**
- Lines ~32-40: Add `./fair-plugin-name/vendor` to cache paths

### 3. Docker Compose Configuration

**Location**: `/compose.yml`

**Changes required:**

Add plugin volume mount to **ALL** WordPress services:

```yaml
services:
    wordpress:
        volumes:
            - ./fair-calendar-button:/var/www/html/wp-content/plugins/fair-calendar-button
            - ./fair-payment:/var/www/html/wp-content/plugins/fair-payment
            - ./fair-events:/var/www/html/wp-content/plugins/fair-events
            - ./fair-rsvp:/var/www/html/wp-content/plugins/fair-rsvp
            - ./fair-plugin-name:/var/www/html/wp-content/plugins/fair-plugin-name  # Add this

    wpcli:
        volumes:
            # Same as above - add plugin mount
```

**Services to update:**
- `wordpress` (main service, line ~14)
- `wpcli` (WP-CLI service, line ~52)

### 4. Version Sync Script

**Location**: `/scripts/sync-wp-versions.js`

**Changes required:**

```javascript
const plugins = [
    {
        name: 'fair-plugin-name',
        packagePath: 'fair-plugin-name/package.json',
        phpFiles: ['fair-plugin-name/fair-plugin-name.php'],
        readmeFiles: ['fair-plugin-name/readme.txt'],
    },
    // ... other plugins
];
```

**Lines to update:**
- Lines ~20-75: Add plugin configuration object

This ensures version synchronization across `package.json`, main PHP file, and `readme.txt`.

## Configuration Templates

### Jest Configuration: `jest.config.js`

**Template:**

```javascript
export default {
	testEnvironment: 'jsdom',
	moduleNameMapper: {
		'\\.(css|scss)$': '<rootDir>/__mocks__/styleMock.js',
	},
	transform: {
		'^.+\\.jsx?$': 'babel-jest',
	},
	testMatch: ['**/__tests__/**/*.test.js', '**/*.test.jsx'],
	setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
```

### Playwright Configuration: `playwright.config.js`

**Template:**

```javascript
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: 'html',
	use: {
		baseURL: process.env.WP_BASE_URL || 'http://localhost:8080',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		command: 'docker compose up',
		url: 'http://localhost:8080',
		reuseExistingServer: !process.env.CI,
		timeout: 120 * 1000,
	},
});
```

**Requires `.env` file:**

```
WP_BASE_URL=http://localhost:8080
WP_ADMIN_USER=admin
WP_ADMIN_PASSWORD=password
```

## Translation Setup

The plugin uses WordPress's standard translation workflow with special handling for JavaScript translations.

### Workflow

1. **Extract strings** from PHP and JavaScript:
   ```bash
   npm run makepot
   ```
   Generates: `languages/fair-plugin-name.pot`

2. **Update .po files** from .pot template:
   ```bash
   npm run updatepo
   ```
   Updates all existing `.po` files in `languages/`

3. **Translate** using Poedit or similar tool:
   - Open `languages/fair-plugin-name-pl_PL.po`
   - Translate strings
   - Save (generates `.mo` file automatically, or run `npm run makemo`)

4. **Generate JavaScript translations**:
   ```bash
   npm run build
   ```
   This runs `makejson` which generates `build/languages/*.json` files

### Why build/map.json is Required

WordPress generates translation JSON hashes based on **source file paths** (`src/blocks/*/editor.js`), but loads them based on **build file paths** (`build/blocks/*/editor.js`). Without mapping, hashes mismatch and translations fail.

**Solution**: `webpack-bundle-output` plugin generates `build/map.json` mapping source → build files. The `--use-map=build/map.json` flag tells WP-CLI to generate correct hashes.

### Translation File Locations

- **PHP translations**: `languages/` directory
  - `.pot` (template), `.po` (translations), `.mo` (compiled)
- **JavaScript translations**: `build/languages/` directory
  - `.json` files (one per JS file per locale)

### Setting Translation Paths in PHP

```php
// In BlockHooks.php or similar
wp_set_script_translations(
    'fair-plugin-name-block-name-editor-script',
    'fair-plugin-name',
    dirname( __DIR__, 2 ) . '/build/languages'  // Note: build/languages for JS
);
```

**Important**: PHP `.mo` files are loaded automatically from `languages/` (no `load_plugin_textdomain()` needed for WordPress 6.7+). JavaScript translations require explicit path via `wp_set_script_translations()`.

## Testing Setup

Follow the unified testing architecture documented in [TESTING.md](./TESTING.md).

### Test Types and Locations

- **Unit Tests**: `src/**/__tests__/*.test.js` - Jest for utilities and functions
- **Component Tests**: `src/**/components/__tests__/*.test.jsx` - Jest + React Testing Library
- **API Tests**: `src/API/__tests__/*.api.spec.js` - Playwright for REST endpoints
- **E2E Tests**: `e2e/**/*.spec.js` - Playwright for user flows

### Running Tests

```bash
npm test              # Run all tests
npm run test:js       # Jest (unit + component)
npm run test:api      # Playwright API tests
npm run test:e2e      # Playwright E2E tests
```

See [TESTING.md](./TESTING.md) for complete configuration templates and best practices.

## Versioning and Deployment

### Changesets Workflow

This monorepo uses [Changesets](https://github.com/changesets/changesets) for versioning:

1. **Create changeset** after making changes:
   ```bash
   npx changeset
   ```
   - Select affected packages
   - Choose version bump type (patch/minor/major)
   - Write changelog entry

2. **Version packages** (when ready to release):
   ```bash
   npm run version-packages
   ```
   This runs:
   - `changeset version` - Updates `package.json` versions and `CHANGELOG.md`
   - `sync-wp-versions` - Updates PHP file and `readme.txt` versions

3. **Build and create distribution**:
   ```bash
   npm run build
   npm run dist-archive:fair-plugin-name
   ```
   Creates: `dist/fair-plugin-name.zip`

### WordPress.org SVN Deployment

1. **Checkout SVN repository** (first time only):
   ```bash
   npm run svn:checkout
   ```

2. **Copy files to SVN**:
   ```bash
   npm run svn:copy
   ```

3. **Commit to SVN**:
   ```bash
   cd svn
   svn add trunk/* --force
   svn commit -m "Version 0.1.0"
   svn cp trunk tags/0.1.0
   svn commit -m "Tagging version 0.1.0"
   ```

**Important**: The `svn:copy` script copies built files from `build/` and `vendor/` which are gitignored but required for distribution.

## Checklist

Use this checklist when adding a new plugin:

### Plugin Files

- [ ] Create plugin directory: `fair-plugin-name/`
- [ ] Create main plugin file: `fair-plugin-name.php`
- [ ] Create `package.json` with all required scripts
- [ ] Create `composer.json` with PSR-4 autoloading
- [ ] Create `webpack.config.cjs` with BundleOutputPlugin
- [ ] Create `.gitignore` and `.distignore`
- [ ] Create `readme.txt` for WordPress.org
- [ ] Create `CHANGELOG.md`
- [ ] Create `src/Core/Plugin.php` (main plugin class)
- [ ] Set up directory structure (`src/`, `build/`, `languages/`, `assets/`)

### Root Monorepo Updates

- [ ] Add to `/package.json` workspaces array
- [ ] Add to `/package.json` start script
- [ ] Add to `/package.json` format:php script
- [ ] Add dist-archive script to `/package.json`
- [ ] Add to `/.github/workflows/php-ci.yml` cache paths
- [ ] Add to `/compose.yml` wordpress service volumes
- [ ] Add to `/compose.yml` wpcli service volumes
- [ ] Add to `/scripts/sync-wp-versions.js` plugins array

### Build and Translation

- [ ] Run `npm install` in root directory
- [ ] Run `composer install` in plugin directory
- [ ] Run `npm run build` to verify webpack configuration
- [ ] Run `npm run makepot` to generate translation template
- [ ] Add initial `.po` files for target languages
- [ ] Run `npm run build` again to generate `.json` translations
- [ ] Verify `build/map.json` is generated
- [ ] Verify `build/languages/*.json` files are generated

### Testing

- [ ] Create `jest.config.js`
- [ ] Create `playwright.config.js`
- [ ] Create `.env` file for test environment
- [ ] Add test directories: `__tests__/`, `e2e/`
- [ ] Run `npm test` to verify test setup

### Version Control

- [ ] Create initial changeset: `npx changeset`
- [ ] Commit all files to git
- [ ] Verify `.gitignore` excludes `build/`, `vendor/`, `node_modules/`, `svn/`
- [ ] Push to repository

### WordPress.org (when ready)

- [ ] Create plugin on WordPress.org
- [ ] Run `npm run svn:checkout`
- [ ] Run `npm run svn:copy`
- [ ] Commit to SVN trunk
- [ ] Tag SVN release
- [ ] Verify plugin appears on WordPress.org

## Common Pitfalls

### Case Sensitivity

**Problem**: PSR-4 autoloading works on macOS but fails on Linux.

**Solution**: Ensure namespace casing matches directory structure:
- Namespace: `FairPluginName\API\ResourceController`
- Directory: `src/API/ResourceController.php` (uppercase "API")

### Translation Hashes

**Problem**: JavaScript translations don't load (hash mismatch).

**Solution**:
1. Add `webpack-bundle-output` plugin to webpack config
2. Use `--use-map=build/map.json` in `makejson` script
3. Run `npm run build` after updating translations

### Missing Dependencies

**Problem**: `vendor/` or `node_modules/` not included in distribution.

**Solution**:
1. Run `npm run composer:install:prod` before `dist-archive`
2. Run `npm run build` before `dist-archive`
3. Verify `.distignore` includes `!/build/` and `!/vendor/` (negated patterns)

### Rewrite Rules

**Problem**: Custom endpoints (OAuth, REST API) return 404.

**Solution**:
1. Flush rewrite rules on activation: `flush_rewrite_rules()`
2. Deactivate and reactivate plugin in WordPress admin
3. Check rewrite rules: `wp rewrite list` (via WP-CLI)

## Additional Resources

- [CLAUDE.md](./CLAUDE.md) - Project conventions and coding standards
- [TESTING.md](./TESTING.md) - Testing architecture and best practices
- [REST_API_USAGE.md](./REST_API_USAGE.md) - Frontend REST API guidelines
- [REST_API_BACKEND.md](./REST_API_BACKEND.md) - Backend REST API security
- [REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md) - React admin pages architecture
- [PHP_PATTERNS.md](./PHP_PATTERNS.md) - Secure PHP coding patterns

---

**Questions or issues?** Check existing plugins (fair-rsvp, fair-events, fair-calendar-button) for reference implementations.
