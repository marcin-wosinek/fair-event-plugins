== Fair Finance ==
Contributors: marcinwosinek
Tags: finance, budgeting, events
Requires at least: 6.7
Tested up to: 7.0
Requires PHP: 8.0
Stable tag: 1.0.2
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Budgeting, financial entries, and reconciliation for fair event management.

== Description ==

Fair Finance provides budgeting, financial entries, and reconciliation features for event organizers using the Fair Event Plugins suite.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/fair-finance`.
2. Activate the plugin through the **Plugins** screen in WordPress.

== Changelog ==

## 1.0.2

### Patch Changes

-   f46e6ec: Remove budgetingEnabled feature flag — budgeting is now always active.

## 1.0.1

### Patch Changes

-   ead4d69: Fix Finance tab API paths and gate the tab on the fair-finance plugin being active

## 1.0.0

### Major Changes

-   17770eb: Split budgets, financial entries, and reconciliation out of fair-payments-connector into a new fair-finance plugin. fair-finance introduces the plugin from scratch (major); fair-payments-connector loses the extracted functionality (minor).

### Minor Changes

-   f9e4993: Add tag field to financial entries with income/expense-by-tag chart, and CSV export of financial entries scoped to a budget.

## 0.1.0

### Added

-   Initial plugin scaffold.
