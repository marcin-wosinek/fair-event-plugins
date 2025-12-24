# Webpack Configuration Guide

This guide documents the standard webpack configuration patterns used across Fair Event Plugins.

## Basic Structure

All plugins use `@wordpress/scripts` as the base configuration:

```javascript
const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');

module.exports = {
    ...defaultConfig,
    entry: { /* custom entries */ },
};
```

**Important**: When using a custom `webpack.config.cjs`, you must explicitly pass it to wp-scripts:

```json
{
  "scripts": {
    "build": "wp-scripts build --config webpack.config.cjs",
    "start": "wp-scripts start --config webpack.config.cjs"
  }
}
```

Without `--config`, wp-scripts will use its default entry discovery (looking for `src/index.js` and `src/*/index.js`).

## Entry Points

### Pattern 1: Static Entries (RECOMMENDED)

**Used in**: All plugins (`fair-payment`, `fair-events`, `fair-membership`, `fair-rsvp`, `fair-user-import`, `fair-platform`)

```javascript
module.exports = {
    ...defaultConfig,
    entry: {
        'admin/groups/index': path.resolve(
            process.cwd(),
            'src/Admin/groups/index.js'
        ),
        'blocks/my-block/editor': path.resolve(
            process.cwd(),
            'src/blocks/my-block/editor.js'
        ),
    },
};
```

**Pros**:
- Clear and explicit
- Easy to understand and maintain
- Fails fast with clear error messages if files are missing
- No extra dependencies

**Cons**:
- Manual update when adding/removing files (but this is actually a good thing - forces intentional changes)

**Use this pattern for all new plugins.**

### Pattern 2: Dynamic Entries with File Existence Check (NOT RECOMMENDED)

**Previously used in**: `fair-payment`, `fair-events` *(refactored to Pattern 1)*

```javascript
const fs = require('fs');

const entries = {};

const blockEntries = {
    'blocks/simple-payment/index': 'src/blocks/simple-payment/index.js',
    'blocks/simple-payment/view': 'src/blocks/simple-payment/view.js',
};

const adminEntries = {
    'admin/settings/index': 'src/Admin/settings/index.js',
};

const allEntries = { ...blockEntries, ...adminEntries };

// Only add entries for files that exist
Object.entries(allEntries).forEach(([key, filePath]) => {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (fs.existsSync(fullPath)) {
        entries[key] = fullPath;
    }
});

module.exports = {
    ...defaultConfig,
    entry: entries,
};
```

**Why NOT to use this**:
- ❌ Silent failures: Typos in paths won't cause build errors
- ❌ Harder to debug: "Why isn't my file being built?"
- ❌ More complexity: Extra code and `fs` dependency
- ❌ False sense of safety: Missing files should fail the build, not be silently skipped
- ❌ No real benefit: If you're listing a file in webpack config, you want it to build

**Only use if**: You have truly optional modules that may or may not exist (e.g., environment-specific features, premium modules). None of the current Fair Event Plugins have this requirement.

### Pattern 3: Entry as Function (Preserves Default Entries)

**Used in**: `fair-rsvp`

```javascript
module.exports = {
    ...defaultConfig,
    entry: () => {
        const defaultEntries =
            typeof defaultConfig.entry === 'function'
                ? defaultConfig.entry()
                : defaultConfig.entry;

        return {
            ...defaultEntries,
            'admin/events/index': path.resolve(
                process.cwd(),
                'src/Admin/events/index.js'
            ),
        };
    },
};
```

**Pros**: Preserves @wordpress/scripts default block detection (src/index.js, src/*/index.js)
**Cons**: More complex, usually not needed since we define all entries explicitly

## Translation Support (BundleOutputPlugin)

**Required for plugins with JavaScript translations**

```javascript
const BundleOutputPlugin = require('webpack-bundle-output');

module.exports = {
    ...defaultConfig,
    entry: { /* ... */ },
    plugins: [
        ...defaultConfig.plugins,
        new BundleOutputPlugin({
            cwd: process.cwd(),
            output: 'map.json',
        }),
    ],
};
```

**Purpose**: Generates `build/map.json` that maps source files to built files. This is required for `wp i18n make-json --use-map` to generate correct translation JSON hashes.

**When to use**:
- ✅ Plugin has translatable strings in JavaScript (uses `__()`, `_x()`, etc.)
- ✅ Plugin runs `npm run makejson` script
- ❌ Server-side only plugin (no JavaScript)

**Plugins using it**: `fair-events`, `fair-membership`, `fair-rsvp`, `fair-user-import`
**Plugins NOT using it**: `fair-payment` (should probably add it), `fair-platform` (server-side only, doesn't need it yet)

## Path Resolution

### Use `process.cwd()` for Entry Paths

**Correct**:
```javascript
entry: {
    'admin/settings/index': path.resolve(
        process.cwd(),
        'src/Admin/settings/index.js'
    ),
}
```

**Why**: `process.cwd()` resolves relative to the current working directory (the plugin folder when running `npm run build`). This is consistent with how `@wordpress/scripts` expects paths.

**Avoid**: `__dirname` in entry definitions (works but inconsistent with other plugins)

## Entry Naming Convention

### Directory Structure Matches Entry Keys

```
src/
├── Admin/
│   ├── settings/
│   │   └── index.js        → 'admin/settings/index'
│   └── groups/
│       └── index.js        → 'admin/groups/index'
└── blocks/
    ├── simple-payment/
    │   ├── index.js        → 'blocks/simple-payment/index'
    │   └── view.js         → 'blocks/simple-payment/view'
    └── my-block/
        └── editor.js       → 'blocks/my-block/editor'
```

### Common Entry Suffixes

- `index` - Main entry point (editor + view combined, or admin page)
- `editor` - Block editor script (for blocks with separate frontend)
- `view` / `frontend` - Frontend-only script (loaded via viewScript in block.json)

## Output Structure

Default output from `@wordpress/scripts`:

```
build/
├── admin/
│   └── settings/
│       ├── index.js
│       ├── index.asset.php    (dependencies & version)
│       └── index.css
└── blocks/
    └── simple-payment/
        ├── index.js
        ├── index.asset.php
        └── index.css
```

## Example Configurations

### Server-Side Only Plugin (No Build Needed)

```javascript
// package.json
{
    "scripts": {
        "build": "echo 'No build needed - server-side only plugin'",
        "start": "echo 'No watch needed - server-side only plugin'"
    }
}
```

No `webpack.config.cjs` needed.

### Simple Plugin with One Admin Page

**webpack.config.cjs**:
```javascript
const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const BundleOutputPlugin = require('webpack-bundle-output');

module.exports = {
    ...defaultConfig,
    entry: {
        'admin/settings/index': path.resolve(
            process.cwd(),
            'src/Admin/settings/index.js'
        ),
    },
    plugins: [
        ...defaultConfig.plugins,
        new BundleOutputPlugin({
            cwd: process.cwd(),
            output: 'map.json',
        }),
    ],
};
```

**package.json**:
```json
{
  "scripts": {
    "build": "wp-scripts build --config webpack.config.cjs",
    "start": "wp-scripts start --config webpack.config.cjs"
  },
  "devDependencies": {
    "@wordpress/scripts": "^30.20.0",
    "webpack-bundle-output": "^1.1.0"
  }
}
```

### Complex Plugin with Blocks and Admin Pages

```javascript
const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const BundleOutputPlugin = require('webpack-bundle-output');

module.exports = {
    ...defaultConfig,
    entry: {
        'blocks/event-dates/editor': path.resolve(
            process.cwd(),
            'src/blocks/event-dates/editor.js'
        ),
        'blocks/events-list/editor': path.resolve(
            process.cwd(),
            'src/blocks/events-list/editor.js'
        ),
        'admin/settings/index': path.resolve(
            process.cwd(),
            'src/Admin/settings/index.js'
        ),
        'admin/event-meta/index': path.resolve(
            process.cwd(),
            'src/Admin/event-meta/index.js'
        ),
    },
    plugins: [
        ...defaultConfig.plugins,
        new BundleOutputPlugin({
            cwd: process.cwd(),
            output: 'map.json',
        }),
    ],
};
```

## Checklist for New Plugins

When creating webpack.config.cjs for a new plugin:

1. ✅ Import `defaultConfig` from `@wordpress/scripts/config/webpack.config`
2. ✅ Import `path` module
3. ✅ Define `entry` object with all JavaScript entry points (use **Static Entries** pattern)
4. ✅ Use `path.resolve(process.cwd(), ...)` for entry paths
5. ✅ Add `BundleOutputPlugin` if plugin has JavaScript translations (version `^1.1.0`)
6. ✅ Follow naming convention: `admin/page-name/index` or `blocks/block-name/editor`
7. ✅ **Update package.json scripts**: Add `--config webpack.config.cjs` to build/start commands
8. ✅ Update `package.json` with `webpack-bundle-output` dependency if using translations
9. ✅ If using `"type": "module"`, include `.js` extension in relative imports
10. ❌ **DON'T** use dynamic file existence checks unless you have a specific reason

## Common Issues

### Issue: "No entry file discovered in the 'src' directory"

**Cause 1**: Not passing `--config` flag to wp-scripts

**Solution**: Update package.json build script: `"build": "wp-scripts build --config webpack.config.cjs"`

**Cause 2**: Entry points not properly defined or paths incorrect

**Solution**: Ensure `entry` object explicitly lists all entry points with correct paths

**Cause 3**: Missing `webpack-bundle-output` dependency

**Solution**: Run `npm install` after adding the dependency to package.json

### Issue: Translation JSON files have wrong hash

**Cause**: Missing `BundleOutputPlugin` or not using `--use-map` flag

**Solution**:
1. Add BundleOutputPlugin to webpack config
2. Update `makejson` script: `wp i18n make-json languages ./build/languages --domain=plugin-name --use-map=build/map.json`

### Issue: Webpack builds but files not in expected location

**Cause**: Custom output path configuration

**Solution**: Don't override `output.path` unless necessary. Default (`build/`) works for all plugins.

## See Also

- [Translation Setup Guide](./CLAUDE.md#translation-i18n-setup)
- [React Admin Pattern](./REACT_ADMIN_PATTERN.md)
- [WordPress Scripts Documentation](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-scripts/)
