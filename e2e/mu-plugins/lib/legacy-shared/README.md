# Legacy shared-library fixtures (#2181)

Each `fair-timetable-<version>/` directory holds `fair-timetable.php` and the
complete `vendor/` tree of that Fair Timetable release, unmodified, as
wordpress.org ships it. They are the audited legacy releases of the
shared-library loader; see PHP_PATTERNS.md § Shared Package.

| Directory              | Source archive                                                  | SHA-256 of the archive                                             | Bundled shared |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ | -------------- |
| `fair-timetable-0.7.0` | https://downloads.wordpress.org/plugin/fair-timetable.0.7.0.zip | `252acb41e0f5aee312d7972843359defa3b463bb422e8440efbb42b3fb3624e2` | 0.2.1          |
| `fair-timetable-0.7.1` | https://downloads.wordpress.org/plugin/fair-timetable.0.7.1.zip | `bab84cb413ffb68908724446da60ec54a15453c0992d91e0819da8a0d6642429` | 0.2.6          |
| `fair-timetable-0.8.0` | https://downloads.wordpress.org/plugin/fair-timetable.0.8.0.zip | `4b19a26957a22fcbe7e5e3b64774764ba9717fe2ef8cead66cea5d05a0d8cfbb` | 0.2.10         |

Only the Composer autoloader runs (from `../../fair-e2e-shared-loader.php`
and `fair-events/__tests__/Shared/SharedLibraryLoaderTest.php`); the main
file is kept so the loader can name the plugin. WordPress never loads files
below `mu-plugins/lib/`. Don't edit or reformat these files: they stand in
for real installed releases.
