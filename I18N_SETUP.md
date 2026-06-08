# i18n Build Setup

How JavaScript translations are wired through the build so the hashes line up
and `.mo`/`.json` files load correctly. For the translation *tooling*
(`npm run translation:*`, AI-assisted translation, coverage), see
[TRANSLATIONS.md](./TRANSLATIONS.md).

## The Problem

WordPress generates translation JSON files with MD5 hashes based on source file
paths (`src/blocks/*/editor.js`), but loads them based on build file paths
(`build/blocks/*/editor.js`). This causes a hash mismatch and translations fail
to load.

## Solution: Official WordPress `--use-map` Approach

**Reference**: [WP-CLI i18n make-json documentation](https://developer.wordpress.org/cli/commands/i18n/make-json/)

### 1. Install webpack-bundle-output Plugin

```bash
npm install --save-dev webpack-bundle-output
```

### 2. Update webpack.config.cjs

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

### 3. Update package.json Scripts

```json
{
  "makepot": "wp i18n make-pot . languages/plugin-name.pot --exclude=node_modules,vendor,tests,build",
  "makejson": "wp i18n make-json languages ./build/languages --domain=plugin-name --pretty-print --no-purge --use-map=build/map.json",
  "makemo": "wp i18n make-mo languages/",
  "updatepo": "wp i18n update-po languages/plugin-name.pot languages/"
}
```

Key change: add `--use-map=build/map.json` to the `makejson` script.

### 4. Set Translation Paths in PHP

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

## Translation Workflow

```bash
npm run makepot     # Generate .pot from source
npm run updatepo    # Update .po files from .pot
# Translate .po files (manually or with tools)
npm run makemo      # Generate .mo files (PHP)
npm run build       # Builds JS and runs makejson (generates JSON with correct hashes)
```

## Default: WordPress.org language packs (no `load_plugin_textdomain()`)

Since WordPress 4.6, core auto-loads language packs for plugins hosted on
WordPress.org under the plugin slug (`wp-content/languages/plugins/{slug}-{locale}.mo`
/ `.json`). Since WP 6.7 it does so just-in-time. Calling
`load_plugin_textdomain()` is unnecessary for the standard case and was flagged
by the WordPress.org plugin review team.

For each of our plugins, the **default** is therefore:

- No `load_plugin_textdomain()` call.
- `wp_set_script_translations( $handle, '{slug}' )` is called **without a path
  argument**, so core resolves the JSON from the language-pack location.

Translated strings come from `wp-content/languages/plugins/` once the locale's
language pack is installed.

## Opt-in: `bundled-translations` feature flag

Each plugin (`fair-events`, `fair-payment`, `fair-audience`, `fair-platform`,
`fair-timetable`) exposes a `bundled-translations` flag through its `Features`
registry. When the flag is **on**:

- `load_plugin_textdomain( '{slug}', false, '{slug}/languages' )` is invoked on
  `init`, so the bundled `.mo` files in `languages/` are loaded.
- `wp_set_script_translations()` is passed the bundled `build/languages/` path,
  so JS strings resolve from there too.

This is useful while a locale is below the 90% publish threshold on
translate.wordpress.org, or when iterating on strings that have not yet been
uploaded.

**Resolution order** (first match wins; mirrors the existing Fair Events
features pattern):

1. Per-feature constant `FAIR_{PLUGIN}_FEATURE_BUNDLED_TRANSLATIONS`
2. Master switch `FAIR_{PLUGIN}_INTERNAL`
3. `fair_{plugin}_feature_enabled` filter
4. Stored option `fair_{plugin}_features` (Settings → Features tab)
5. Hardcoded default (`false`)

**Helper.** Each plugin's `Features` class exposes
`Features::script_translations_path()` returning either the bundled path or
`null`. Call sites pass the helper directly:

```php
wp_set_script_translations(
    'fair-events-manage-event',
    'fair-events',
    \FairEvents\Core\Features::script_translations_path()
);
```

**Reference**: [I18n improvements in WordPress 6.7](https://make.wordpress.org/core/2024/10/21/i18n-improvements-6-7/)
