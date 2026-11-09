# Shared admin table

One presentation pattern for the admin lists that show items with actions:

- **Event Notifications** — `fair-events/src/Admin/event-notifications/NotificationList.js`
- **Event Feeds** — `fair-events-experimental/src/Admin/sources/SourcesList.js` (pilot, #2206)
- **Finance Entries** — `fair-finance/src/Admin/entries/EntriesApp.js`
- **Transactions** — `fair-payments-connector/src/Admin/transactions/TransactionsApp.js`

Today these place actions differently: Notifications puts text links under
the name, Feeds and Entries use button groups, and Transactions relies on
linked references. This folder holds the shared look and a few small
components. Rolling it out to each page happens in #2206–#2209; toolbar
integration in #2210.

The shared code only renders. Each page keeps its own requests, filters,
pagination state, permissions, confirmations and mutations. There is no
column schema or data-grid abstraction: a page writes its own `thead` and
`tbody` with the cells below.

## Using it

```javascript
import {
	AdminTable,
	AdminTableHeaderCell,
	AdminTableCell,
	ItemIdentity,
	StatusLabel,
	RowActions,
	TableMessage,
} from 'fair-events-shared/src/admin-table/index.js';
import 'fair-events-shared/src/admin-table/style.css';
```

Import the module directly, not the package root, and import `style.css`
from the page's own entry point. Every rule is scoped to `.fair-admin-table`,
so the stylesheet changes no table that doesn't use the wrapper.

Components read no plugin globals and call no `__()`. Pass every string
already translated in the consuming plugin's text domain, as the
[shared calendar](../calendar/README.md) does.

## Components

| Export                 | Props                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `AdminTable`           | `caption` (accessible table name, visually hidden), `className`, `children` (`thead`, `tbody`) |
| `AdminTableHeaderCell` | `variant`, `children` — renders `<th scope="col">`                                          |
| `AdminTableCell`       | `label` (column header text, shown on mobile), `variant`, `children`                         |
| `ItemIdentity`         | `title`, `fallback`, `href`, `meta`, `children`                                             |
| `StatusLabel`          | `tone` (`success`, `warning`, `error`, `info`, `neutral`), `children`                       |
| `RowActions`           | `primary`, `secondary`, `moreLabel`                                                         |
| `TableMessage`         | `status` (`loading`, `empty`, `no-results`, `error`), `children`, `onRetry`/`retryLabel`, `onClear`/`clearLabel` |

`variant` is `identity`, `amount`, `status` or `actions`; leave it out for
plain columns.

## Presentation rules

**Surface.** White table on the WordPress gray page background, a 1px
`#dcdcde` border, a light gray header row with muted semibold labels,
horizontal row dividers only, no zebra stripes. System font stack at 13px;
cells use 12px vertical and 16px horizontal padding.

**Identity.** The first column names the item: a semibold, linked name
(`ItemIdentity`) with muted supporting text below (slug, kind, recipient
count). Long names wrap; they are never truncated. An empty name shows a
fallback, e.g. "(untitled feed)", per
[UI guidelines § Input](../../../UI_GUIDELINES.md#input-never-silently-drop-what-the-user-typed).
Warnings and eligibility reasons the organizer must see go in
`ItemIdentity`'s `children` with the `fair-admin-table__warning` class. They
stay visible; never move them into a tooltip or the overflow menu.

**Amounts.** `variant="amount"` right-aligns the header and cell and uses
tabular digits. Always show the currency ("€1,250.00", "PLN 80.00").
Formatting and calculations stay where they are today (each page's own
money helpers); the table only aligns the result. Show "—" for a missing
amount rather than an empty cell.

**Status.** `StatusLabel` renders compact sentence-case text ("Paid",
"Pending", "Failed") after a colored dot. The text carries the meaning;
color only supports it. Tones: `success` (done, paid, sent), `warning`
(needs attention, pending), `error` (failed), `info` (scheduled, in
progress), `neutral` (off, paused, refunded, draft — hollow dot). Each color
meets 4.5:1 contrast on white.

**Actions.** The rightmost column, `variant="actions"`, holds `RowActions`:

- `primary` is the one most frequent action, shown as a text link-button
  ("Edit", "View", "Retry"). Give `href` for navigation or `onClick` for an
  in-page action.
- `secondary` lists the other actions in an always-visible "⋮" menu.
  Destructive ones go last with `isDestructive`. With no secondary actions
  the menu is omitted entirely — never render an empty menu.
- `moreLabel` names the menu trigger for this item:
  `sprintf( __( 'More actions for “%s”', 'plugin' ), name )`.
- `disabled` + `disabledReason`: the action stays visible and focusable
  (`aria-disabled`) with its reason shown next to it — a disabled primary
  action shows the reason under the buttons, a disabled menu item shows it
  inside the item.
- `isBusy` + `busyLabel` (primary only): shows a pending label, e.g.
  "Sending…", and ignores clicks until the page clears it. Prevent duplicate
  submission in the page as well (see
  [UI guidelines § Pending and error behaviour](../../../UI_GUIDELINES.md#pending-and-error-behaviour)).

Actions that need confirmation open the page's own dialog, following
[UI guidelines § Popups and confirmations](../../../UI_GUIDELINES.md#popups-and-confirmations).
The shared code adds no confirmation of its own and never runs a request.

## Focus

- The menu opens with Enter/Space, moves with the arrow keys, closes on
  Escape, and returns focus to its trigger.
- Running a menu action closes the menu and focuses the trigger before
  calling `onClick`, so a `Modal` opened by the page returns focus to the
  trigger when it closes.
- Every `onClick` receives `{ restoreFocus }`. Call it when the page closes
  its own UI without removing the row (e.g. Cancel in a dialog that was not a
  `Modal`).
- When the action removes the row, its trigger is gone: move focus to a
  stable element, such as the page heading (`tabIndex={ -1 }`) or the next
  row's identity link, and announce the result with a `Notice`.

## States around the table

`TableMessage` renders the list's non-table states. The page decides which
one applies:

| State      | When                                         | Shows                                         |
| ---------- | -------------------------------------------- | --------------------------------------------- |
| loading    | First load, or a reload with nothing to show | Spinner with text, `role="status"`            |
| empty      | Loaded, nothing exists yet                   | What appears here and how to create the first item |
| no-results | Items exist, but the filters exclude all     | The filters that matched nothing, `onClear`   |
| error      | A load failed                                | Error `Notice` with the server message and `onRetry` |

Report a load failure above the table and keep the rows already shown, so
the organizer keeps their context; don't replace a loaded list with an empty
state. Report a single row's failed action next to that row or in a notice
naming the item.

## Responsive layout

At 782px and below (the WordPress admin breakpoint, so tablets in portrait
included) each row stacks into a labeled block:

1. Identity first, full width, without a label.
2. Every other cell as "label — value", using the cell's `label` prop.
   Amount and status stay visible.
3. Actions last, left-aligned, without a label.

The page must not scroll sideways at 375px. Column widths beyond the identity
and actions columns are each page's choice.

## Toolbar and pagination (for #2210)

Not built here; this is the agreed anatomy for the integration ticket.

- **Above the table, one toolbar row:** search first (widest, labeled), then
  filters (`SelectControl`s with visible labels), then the result count
  ("12 of 40 entries", `role="status"`) pushed to the end. A clear-filters
  button appears only while a filter is active.
- **Page-level primary action** ("Add event feed") stays in the page header,
  not in the toolbar.
- **Bulk actions**, where a page has them, sit at the start of the toolbar
  and appear only when rows are selected, following
  [UI guidelines § Bulk actions](../../../UI_GUIDELINES.md#bulk-actions).
- **Below the table:** pagination as a `nav` with an accessible name,
  "Previous page" / "Page N of M" / "Next page", hidden for a single page.
  The page owns the page state and keeps it in the URL where it does today.
- **Narrow screens:** toolbar controls wrap to full width, in the same order.

## Review example

A test-only page shows every piece with synthetic rows: long names, missing
values, positive and negative amounts in several currencies, every status
tone, disabled actions with reasons and a row without secondary actions.

- Source: `example/` (not exported from the module, never shipped).
- Built by `npm run build` in fair-events-shared into
  `e2e/mu-plugins/admin-table-example/build/` (gitignored).
- Served by `e2e/mu-plugins/fair-e2e-admin-table-example.php`, which loads
  only on the wp-env tests site:
  `/wp-admin/admin.php?page=fair-e2e-admin-table-example`.
- `&scenario=` selects `loading`, `empty`, `no-results`, `pending` or
  `error`; `&layout=baseline` shows the same rows in today's table
  conventions for before/after screenshots.

Tests: `src/admin-table/__tests__/` (Jest) and
`e2e/admin-table-example.spec.js` (layout, keyboard and focus in a browser).

## Pilot notes for #2206 (Event Feeds)

- Identity: feed name linked to its view page, slug as supporting text.
- Status: `success` "Enabled" / `neutral` "Disabled".
- Primary action: "View"; secondary: "Edit", then "Delete" (destructive,
  existing `ConfirmActionModal`).
- Keep the copy-URL buttons and the WhatsApp summary hint as their own
  columns; the hint is an eligibility explanation and must stay visible.
