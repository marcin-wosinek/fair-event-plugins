# Adding a New Plugin to Fair Event Plugins Monorepo

This guide documents the complete process of adding a new plugin to the Fair Event Plugins monorepo. Follow these steps to ensure proper integration with the build system, CI/CD pipeline, and development workflow.

## Table of Contents

1. [Plugin Directory Structure](#plugin-directory-structure)
2. [Required Files](#required-files)
3. [Root Monorepo Updates](#root-monorepo-updates)
4. [Build and Verification](#build-and-verification)
5. [Checklist](#checklist)

## Plugin Directory Structure

Create a new directory `fair-plugin-name/` in the monorepo root with this structure:

```
fair-plugin-name/
├── src/
│   ├── Core/
│   │   └── Plugin.php             # Main plugin class
│   ├── Hooks/
│   │   └── BlockHooks.php         # Block registration
│   ├── API/                       # REST API controllers (uppercase "API")
│   ├── Admin/                     # Admin pages
│   └── blocks/                    # Block source files
├── build/                         # Compiled assets (gitignored)
├── languages/                     # PHP .pot/.po/.mo translation files
├── assets/                        # WordPress.org assets
├── __tests__/                     # Jest unit tests
│   └── example.test.js            # Basic example test
├── e2e/                           # Playwright E2E tests
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

### Reference Plugin: fair-team

The `fair-team` plugin provides a complete, minimal example of all required files. Use it as a template when creating new plugins.

### 1. Main Plugin File: `fair-plugin-name.php`

**Reference**: `fair-team/fair-team.php`

**Key points:**
- Version must match `package.json`
- Text Domain must match plugin slug (directory name)
- Namespace should be PascalCase version of plugin slug
- Requires at least: 6.7, Requires PHP: 8.0

### 2. package.json

**Reference**: `fair-team/package.json`

**Key points:**
- `"type": "module"` is required for ES modules
- `build` script must run `makejson` after building for translation JSON files
- `makejson` requires `--use-map=build/map.json` for correct translation hashes
- Add `webpack-bundle-output` to devDependencies for translation mapping
- Include `fair-events-shared` dependency only if you need shared utilities

### 3. composer.json

**Reference**: `fair-team/composer.json`

**Key points:**
- PSR-4 autoloading: `FairPluginName\\` → `src/`
- Namespace must match directory names (case-sensitive on Linux)
- PHP version requirement should match main plugin file

### 4. webpack.config.cjs

**Reference**: `fair-team/webpack.config.cjs`

**Key points:**
- Extends `@wordpress/scripts` default configuration
- Add custom entries for admin pages
- `BundleOutputPlugin` is **required** for translation system
- Generates `build/map.json` mapping source files to build files

### 5. .gitignore and .distignore

**References**:
- `fair-team/.gitignore`
- `fair-team/.distignore`

**Important**: Build artifacts (`build/`, `vendor/`) should be **included** in the distribution but **excluded** from git.

### 6. readme.txt (WordPress.org format)

**Reference**: `fair-team/readme.txt`

**Key points:**
- `Stable tag` must match version in `package.json` and main PHP file
- Use Markdown formatting for readability
- Keep synchronization with `CHANGELOG.md`

### 7. CHANGELOG.md

**Reference**: `fair-team/CHANGELOG.md`

**Key points:**
- Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format
- Version headers must be `## [X.Y.Z]` format
- Synced to readme.txt via `npm run sync-wp-versions`

### 8. src/Core/Plugin.php

**Reference**: `fair-team/src/Core/Plugin.php`

**Key points:**
- Singleton pattern for main plugin class
- Register hooks in `init()` method
- Namespace: `FairPluginName\Core`

### 9. Test Configuration Files

**References**:
- `fair-team/jest.config.js` - Jest configuration
- `fair-team/__tests__/example.test.js` - Example test file
- `fair-team/playwright.config.js` - Playwright configuration

**Key points for Jest:**
- Use `@wordpress/jest-preset-default` preset (included with `@wordpress/scripts`)
- Set `setupFilesAfterEnv: []` (empty array, not referencing a setup file)
- Configure `testMatch` to find test files in `__tests__/` directories
- Add `testPathIgnorePatterns` to exclude `node_modules`, `vendor`, `e2e`
- Create `__tests__/example.test.js` with a basic passing test (see `fair-rsvp` or `fair-user-import`)

See [TESTING.md](./TESTING.md) for complete testing architecture.

## Root Monorepo Updates

When adding a new plugin, you must update these files in the monorepo root:

**Quick reference** - files to update:
1. `/package.json` - Add to workspaces, scripts (start, format:php, dist-archive, svn:tag, svn:rm)
2. `/.github/workflows/php-ci.yml` - Add vendor cache path
3. `/.github/workflows/deploy-acroyoga.yml` - Add to deployment plugin list (if applicable)
4. `/compose.yml` - Add plugin volume mounts (wordpress and wpcli services)
5. `/scripts/sync-wp-versions.js` - Add plugin configuration
6. `/scripts/sync-changelog.js` - Add plugin configuration

### 1. Root package.json

**Location**: `/package.json`

Add plugin to:
- `workspaces` array (line ~961-974)
- `start` script - append `& npm run start --workspace=fair-plugin-name` (line ~27)
- `format:php` script - append plugin path (line ~30)
- Add `dist-archive:fair-plugin-name` script (after line ~58)
- Add `svn:tag:fair-plugin-name` script (after line ~46)
- Update `svn:rm` script to include `fair-plugin-name/svn` (line ~48)

**Example**: See the existing entries for `fair-team` in these sections.

### 2. GitHub CI Configuration

**Location**: `/.github/workflows/php-ci.yml`

Add `./fair-plugin-name/vendor` to composer cache paths (line ~27-42).

**Example**: See `./fair-team/vendor` entry.

### 3. Deployment Workflow (Optional)

**Location**: `/.github/workflows/deploy-acroyoga.yml`

Add plugin name to deployment list (line ~103) **only if** the plugin should be deployed to this environment.

**Example**: See `fair-team` in the plugin list.

### 4. Docker Compose Configuration

**Location**: `/compose.yml`

Add plugin volume mount to **both** services:
- `wordpress` service (line ~14-24)
- `wpcli` service (line ~52-64)

**Example**: See `./fair-team:/var/www/html/wp-content/plugins/fair-team` entries.

### 5. Version Sync Script

**Location**: `/scripts/sync-wp-versions.js`

Add plugin configuration object to the `plugins` array (line ~20-81).

**Example**: See `fair-team` configuration (lines ~81-86).

### 6. Changelog Sync Script

**Location**: `/scripts/sync-changelog.js`

Add plugin configuration object to the `plugins` array (line ~20-56).

**Example**: See `fair-team` configuration (lines ~51-55).

## Build and Verification

After creating all files and updating monorepo configurations:

```bash
# 1. Install root dependencies (adds plugin to workspaces)
npm install

# 2. Install PHP dependencies
cd fair-plugin-name
composer install
cd ..

# 3. Build the plugin
npm run build --workspace=fair-plugin-name

# 4. Generate translation template
cd fair-plugin-name
npm run makepot
cd ..

# 5. Verify everything works
npm test --workspace=fair-plugin-name

# 6. Start development server (optional)
npm run start --workspace=fair-plugin-name
```

## Translation Setup

The plugin uses WordPress's standard translation workflow with special handling for JavaScript translations.

### Workflow

1. **Extract strings**: `npm run makepot` → generates `languages/fair-plugin-name.pot`
2. **Update .po files**: `npm run updatepo` → updates all `.po` files
3. **Translate**: Use Poedit or similar tool to translate `.po` files
4. **Generate JS translations**: `npm run build` → generates `build/languages/*.json` files

### Why build/map.json is Required

WordPress generates translation JSON hashes based on **source file paths** but loads them based on **build file paths**. The `webpack-bundle-output` plugin generates `build/map.json` to map source → build files, ensuring correct hashes.

**Reference**: See `fair-team/webpack.config.cjs` for BundleOutputPlugin configuration.

### Translation File Locations

- **PHP translations**: `languages/` directory (`.pot`, `.po`, `.mo`)
- **JavaScript translations**: `build/languages/` directory (`.json` files)

**Important**: PHP `.mo` files are loaded automatically from `languages/` (no `load_plugin_textdomain()` needed for WordPress 6.7+). JavaScript translations require `wp_set_script_translations()` pointing to `build/languages/`.

## Versioning and Deployment

### Changesets Workflow

```bash
# 1. Create changeset after making changes
npx changeset

# 2. Version packages (when ready to release)
npm run version-packages

# 3. Build and create distribution
npm run build --workspace=fair-plugin-name
npm run dist-archive:fair-plugin-name
```

### WordPress.org SVN Deployment

```bash
# 1. Checkout SVN repository (first time only)
cd fair-plugin-name
npm run svn:checkout

# 2. Copy files to SVN
npm run svn:copy

# 3. Commit to SVN
cd svn
svn add trunk/* --force
svn commit -m "Version 0.1.0"
svn cp trunk tags/0.1.0
svn commit -m "Tagging version 0.1.0"
```

## Checklist

Use this checklist when adding a new plugin:

### Plugin Files
- [ ] Create plugin directory: `fair-plugin-name/`
- [ ] Copy and adapt files from `fair-team/` reference plugin
- [ ] Update all instances of "fair-team" to "fair-plugin-name"
- [ ] Update all instances of "FairTeam" namespace to "FairPluginName"
- [ ] Update plugin description and metadata
- [ ] Set up directory structure (`src/`, `languages/`, `assets/`, `__tests__/`, `e2e/`)

### Root Monorepo Updates
- [ ] Add to `/package.json` workspaces array
- [ ] Add to `/package.json` start script
- [ ] Add to `/package.json` format:php script
- [ ] Add dist-archive script to `/package.json`
- [ ] Add svn:tag script to `/package.json`
- [ ] Add to svn:rm script in `/package.json`
- [ ] Add to `/.github/workflows/php-ci.yml` cache paths
- [ ] Add to `/.github/workflows/deploy-acroyoga.yml` plugin list (if deploying to this environment)
- [ ] Add to `/compose.yml` wordpress service volumes
- [ ] Add to `/compose.yml` wpcli service volumes
- [ ] Add to `/scripts/sync-wp-versions.js` plugins array
- [ ] Add to `/scripts/sync-changelog.js` plugins array

### Build and Translation
- [ ] Run `npm install` in root directory
- [ ] Run `composer install` in plugin directory
- [ ] Run `npm run build --workspace=fair-plugin-name`
- [ ] Verify `build/map.json` is generated
- [ ] Run `npm run makepot` to generate translation template
- [ ] Add initial `.po` files for target languages (if needed)
- [ ] Run `npm run build` again to generate `.json` translations
- [ ] Verify `build/languages/*.json` files are generated

### Testing
- [ ] Create `__tests__/example.test.js` with basic passing test (copy from `fair-team`)
- [ ] Run `npm test --workspace=fair-plugin-name`
- [ ] Verify test passes successfully

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
1. Add `webpack-bundle-output` plugin to webpack config (see `fair-team/webpack.config.cjs`)
2. Use `--use-map=build/map.json` in `makejson` script (see `fair-team/package.json`)
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

**Questions or issues?** Check the `fair-team` plugin for a complete reference implementation.
