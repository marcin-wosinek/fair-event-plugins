## Project Overview

This is a WordPress plugin collection called "Fair Event Plugins" for event
organization with fair pricing models. 

## Development Commands

### Frontend Development
```bash
cd fair-payment 
npm run start    # Start development server with hot reload
npm run build    # Build production assets for blocks
npm run format   # Format code (ALWAYS run after making changes)
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
**IMPORTANT**: Always run `npm run format` after making any code changes to ensure consistent formatting across the codebase.

## Architecture

### PHP Architecture
- Uses PHP 8.0+ with PSR-4 autoloading standards
- Namespace: `FairPayment` with sub-namespaces for components
- WordPress hooks: `init` for block registration, `admin_menu` for admin interface

### Development Environment
- Docker Compose setup with WordPress, MySQL, and phpMyAdmin
- Plugin mounted directly into WordPress plugins directory
- WP-CLI available via Docker profile for WordPress management

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

- Don't use php templates.
