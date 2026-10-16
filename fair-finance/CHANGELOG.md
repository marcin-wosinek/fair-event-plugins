# Changelog

## 1.3.0

### Minor Changes

-   dcdef69: Loading Mollie settlements now starts with **Load new**: it brings in only
    the settlements that are not saved yet and leaves the ones already loaded
    from Mollie unchanged, saying so when nothing new was found. **Reload all**
    stays available as the lesser action for retrieving every settlement again.

    An import that failed or was interrupted can be continued or replaced by
    another import. After a failed request the page reads the import back from
    the server instead of leaving its buttons disabled, and an import the server
    still counts as running is shown as such with a way to refresh its status.

    While Fair Finance is active, the External Updates page of Fair Payments
    Connector has a **Mollie settlements** section that loads new settlements
    and continues an import left unfinished on either page. Settlement imports
    appear in its operation log, one entry per import.

-   6906403: Save Mollie settlements on your site. A new Settlements page in Fair Finance loads payouts from Mollie or from a settlement CSV export, keeps them available without a Mollie connection, and shows where the two sources agree or differ.
-   e25afe2: Settlements loaded from Mollie keep the report amounts exactly as Mollie
    states them, including fees, VAT and rounding differences with fractions of a
    cent, which used to be saved as unknown. A saved settlement now opens with a
    settlement summary: reported revenue, refunds, costs and adjustments, the
    report net, the payout and the exact difference between them. The Mollie
    report breakdown lists every line by period with its count, rates, net, VAT
    and gross amounts and invoice reference. Settlements saved before this
    update show "Refresh to load report details"; refreshing them from Mollie
    loads the details.
-   f00414c: **Transactions** now link each matched financial entry reference to the Fair Finance **Financial Entries** screen, narrowed to that entry. This includes entries that are part of a split. The references are links only while Fair Finance is active; otherwise they stay plain text.

    **Financial Entries** opened for a single entry shows "Showing entry #N" with a **Show all entries** action, hides the filters and tag chart, and limits the totals and CSV export to that entry. A split parent keeps its nested children and is counted once in the totals. A missing entry shows an explanation, and an invalid entry link shows an error instead of the full list.

    `GET /fair-finance/v1/financial-entries` and `/financial-entries/totals` accept an optional `entry_id` (a positive integer). It takes precedence over the other filters.

### Patch Changes

-   1dfaa7d: Financial entries on an event's Finance tab and on the Reconciliation
    screen now link to the focused entry view. Each `#id` in the Payments
    table's Budget entry column, the date of each cost entry, and the date of
    each unmatched and matched reconciliation entry open that entry on the
    Entries screen. When Fair Finance is unavailable, the event's references
    stay plain text.
-   6126ba9: A saved settlement now links to the Mollie dashboard of the organization it
    was saved under: its Mollie settlement ID opens the settlements report, and
    the payment IDs of its movements open their payments. Refunds, captures and
    chargebacks link the payment they belong to. The Movements table ends with a Totals row that adds up the Settled
    column per currency, keeps deductions negative, and says when rows with an
    unknown amount were left out.
-   211afc8: Spreadsheet imports now read files with SheetJS 0.20.3, which fixes the
    prototype-pollution and denial-of-service problems of the release used before.
    Bank-entry imports (.xlsx, .xls) and Mollie settlement CSV matching give the
    same results as before.

    A file that cannot be read as a spreadsheet now shows "Failed to parse file."
    instead of an internal error message, and an empty settlement file is reported
    as empty. Choosing another file while an earlier one is still being matched no
    longer lets the earlier result appear next to the new file's error.

-   Updated dependencies [dcdef69]
-   Updated dependencies [8e7c2de]
-   Updated dependencies [9321736]
-   Updated dependencies [6906403]
-   Updated dependencies [e25afe2]
-   Updated dependencies [e1f6379]
-   Updated dependencies [f00414c]
    -   fair-payments-connector@2.5.0

## 1.2.0

### Minor Changes

-   bc63391: Request Mollie settlement access when Fair Finance is active. Connecting to Mollie asks for the same permissions as before, plus permission to read settlements on sites running Fair Finance. The site records the permissions Mollie actually granted and treats settlement access as available only when that permission was granted.

    A site connected before this change keeps accepting payments. Its connection settings now offer **Reconnect**, which goes through the Mollie authorization again without disconnecting first, and Fair Finance's Reconciliation page explains when settlement access still needs to be authorized and links there. Cancelling or failing an authorization leaves the existing connection as it was and says so, instead of ending on an error page.

### Patch Changes

-   9413f36: Load the plugins' own scripts with WordPress's `defer` strategy. The Add to Calendar button script, the payment return notification script, and the admin and editor scripts of these plugins no longer pause page parsing while they download; they stay in the footer and behave as before. WordPress still loads a script the usual way where deferring would break ordering — Manage Event while a plugin adds tabs to it (Fair Audience does), and Fair Events → Settings while an extension adds a settings tab.

## 1.1.0

### Minor Changes

-   1cda6dd: Add an optional Budget selector to each Connected Site, so a transaction imported from that site retains a durable link to its local id. During reconciliation, an unmatched imported transaction now shows its source site's configured budget, and the administrator can review, change, or clear that proposal before confirming a match — an existing budget assignment is always preserved, and no budget is proposed when selected transactions resolve to different sites. Removing a Connected Site or its linked budget never breaks existing data; both simply resolve to no budget going forward.
-   7362ce4: Add a budget selector to the Manage Event Finance tab, applying to the whole event/series. When Fair Finance pre-generates a reconciliation split for a settlement transfer, or matches a bank entry to a single transaction, each allocation now preselects the budget linked to its payment's event (falling back to no budget when the event has none, is unlinked, or its budget was deleted). Organisers can still override any preselected budget before saving.

### Patch Changes

-   Updated dependencies [19d0333]
    -   fair-events-shared@0.6.2

## 1.0.5

### Patch Changes

-   f0aa452: Fixed broken links left over from the Budgets/Entries/Reconciliation screens' move from Payments Connector into Finance: the budgets list's "View" links (for a specific budget and for unbudgeted entries) now point at the current `fair-finance-entries` admin page instead of the retired, unregistered slug that produced a permissions-denied page. The transactions list's entry column, whose deep link into a specific entry never actually worked, now shows the entry ids as plain text instead of a dead link.
-   Updated dependencies [7281a45]
-   Updated dependencies [84cfda0]
-   Updated dependencies [8d196d7]
-   Updated dependencies [9ae94d2]
-   Updated dependencies [1f9fcc1]
    -   fair-events-shared@0.5.0

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
