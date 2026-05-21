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

## `load_plugin_textdomain()` Required for Bundled Translations

`load_plugin_textdomain()` **IS REQUIRED** to load `.mo` files bundled in the
plugin's own `languages/` directory. WordPress only auto-loads translations from
`wp-content/languages/plugins/` (downloaded from translate.wordpress.org).

**Pattern** (add in `Plugin::init` or equivalent):

```php
load_plugin_textdomain( 'fair-audience', false, 'fair-audience/languages' );
```

**For this project:**

- All plugins call `load_plugin_textdomain()` in their `Plugin::init()` method
- PHP `.mo` files are in the plugin's `languages/` directory
- JavaScript translations use `wp_set_script_translations()` pointing to `build/languages/`

**Reference**: [WordPress Plugin Internationalization Handbook](https://developer.wordpress.org/plugins/internationalization/how-to-internationalize-your-plugin/#loading-text-domain)
