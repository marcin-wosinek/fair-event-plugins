# fair-timetable

## 0.6.7

### Patch Changes

-   6973be8: Add Spanish (es_ES) WordPress.org screenshots and linkify GitHub URLs in the readme.

## 0.6.6

### Patch Changes

-   3232aba: Rewrite the readme description to clearly convey what the plugin does, and replace the inlined changelog with a link to CHANGELOG.md on GitHub. The release tooling no longer syncs the changelog into `readme.txt`.

## 0.6.5

### Patch Changes

-   f46e6ec: Fix duration labels to be extractable for translation.

## 0.6.4

### Patch Changes

-   ead4d69: Upgrade composer/installers from v1 to v2

## 0.6.3

### Patch Changes

-   02cf7b6: Default to WordPress.org language packs; gate `load_plugin_textdomain()` and the
    `wp_set_script_translations()` path behind a new per-plugin `bundled-translations`
    feature flag (resolved through the same constant / master / filter / option /
    default chain as the existing Fair Events features). The flag is exposed in
    each plugin's Settings → Features tab (or Features submenu) and defaults to off.

## 0.6.2

### Patch Changes

-   9cb93a0: Wire fair-timetable into release tooling: stamp build version in PHP header during CI build, and include `languages/` in the SVN trunk copy so bundled translations ship to WordPress.org.

## 0.6.1

### Patch Changes

-   7e7ea9c: Update version tested up to version to 6.9.

## 0.6.0

### Minor Changes

-   769be6b: Add automated hour as adding new time-slots

## 0.5.0

### Minor Changes

-   45729b3: Improve edition UX
-   29d5b69: Rename the block attributes (Hour->Time)

## 0.4.0

### Minor Changes

-   094cb00: Improve the block styling

## 0.3.0

### Minor Changes

-   905f4e4: Refactor timetable blocks

### Patch Changes

-   84fe629: Set correctly supported version

## 0.2.0

Minor fixes

## 0.1.0

Initial version of the plugin.
