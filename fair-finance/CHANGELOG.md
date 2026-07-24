# Changelog

## 1.0.4

### Patch Changes

-   a7c09e1: Fix the budgets page's responsive card layout not applying on mobile (its styles were still scoped to the old fair-payments-connector class names), and stack the finance entries summary totals vertically below 600px instead of letting them overlap.

## 1.0.3

### Patch Changes

-   c60efeb: Fix the Budget Movements link in the Budgets admin page — it was pointing to the wrong route and now correctly navigates to the fair-finance-entries view for the selected budget.

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
