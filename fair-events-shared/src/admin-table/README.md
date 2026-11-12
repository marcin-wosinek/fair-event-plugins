# Shared admin table

One presentation pattern for the admin lists that show items with actions:

- **Event Notifications** — `fair-events/src/Admin/event-notifications/NotificationList.js`
- **Event Feeds** — `fair-events-experimental/src/Admin/sources/SourcesList.js` (pilot, #2206)
- **Finance Entries** — `fair-finance/src/Admin/entries/EntriesApp.js`
- **Transactions** — `fair-payments-connector/src/Admin/transactions/TransactionsApp.js`

This folder holds the shared look and a few small components: the table
(#2205, rolled out in #2206–#2209) and the header, toolbar and pagination
around it (#2210).

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
	ListHeader,
	ListToolbar,
	ListToolbarField,
	MoreFiltersToggle,
	MoreFiltersPanel,
	ResultCount,
	AppliedFilters,
	SelectionSummary,
	ListPagination,
	pageRange,
} from 'fair-events-shared/src/admin-table/index.js';
import 'fair-events-shared/src/admin-table/style.css';
```

Import the module directly, not the package root, and import `style.css`
from the page's own entry point. When two entries of one plugin import it,
wp-scripts puts it in the first entry's `style-index.css` only; give the
other entry its own copy with a query, e.g.
`import 'fair-events-shared/src/admin-table/style.css?event-notifications';`. Every rule is scoped to `.fair-admin-table` or
`.fair-admin-list-*`, so the stylesheet changes no screen that doesn't use
these components.

Components read no plugin globals and call no `__()`. Pass every string
already translated in the consuming plugin's text domain, as the
[shared calendar](../calendar/README.md) does.

## Components

| Export                 | Props                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `AdminTable`           | `caption` (accessible table name, visually hidden), `className`, `children` (`thead`, `tbody`) |
| `AdminTableHeaderCell` | `variant`, `children` — renders `<th scope="col">`                                          |
| `AdminTableCell`       | `label` (column header text, shown on mobile), `variant`, `children`                         |
| `ItemIdentity`         | `title`, `fallback`, `href`, `onClick`, `meta`, `children`                                  |
| `StatusLabel`          | `tone` (`success`, `warning`, `error`, `info`, `neutral`), `children`                       |
| `RowActions`           | `primary`, `secondary`, `moreLabel`                                                         |
| `TableMessage`         | `status` (`loading`, `empty`, `no-results`, `error`), `children`, `onRetry`/`retryLabel`, `onClear`/`clearLabel`, `actions` (empty only) |
| `ListHeader`           | `title`, `actions`, `ref` (to the heading, `tabIndex={ -1 }`)                                 |
| `ListToolbar`          | `selection`, `children` (fields), `actions`, `count`, `panel`                                 |
| `ListToolbarField`     | `wide` (search), `children`                                                                   |
| `MoreFiltersToggle`    | `panelId`, `isOpen`, `onToggle`, `label`                                                      |
| `MoreFiltersPanel`     | `id`, `isOpen`, `label`, `children`                                                           |
| `ResultCount`          | `children` — `role="status"`                                                                  |
| `AppliedFilters`       | `label`, `items` (one string per applied criterion; renders nothing without any)              |
| `SelectionSummary`     | `label` (selected count), `children` (actions for the selection)                              |
| `ListPagination`       | `page`, `totalPages`, `label`, `positionLabel`, `previousLabel`, `nextLabel`, `onChange` or `pageProps` |
| `pageRange( page, perPage, total )` | Returns `{ first, last }` shown positions for the count text                     |

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
  ("Edit", "Retry"). Give `href` for navigation or `onClick` for an
  in-page action, and `accessibleLabel` to name it after the item
  ("Edit “Spring feed”").
- A link action (`href`, primary or in the menu) can also take
  `onLinkClick`, which receives the click event. A page that changes its
  view in place passes its own handler here and calls `preventDefault()` on
  a plain click, leaving modified clicks (new tab or window) to the browser.
  `ItemIdentity`'s `onClick` does the same for the identity link.
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

## Header, toolbar and pagination

Every list page uses the same arrangement, top to bottom. Each piece appears
only where the page already has the capability: a page never gains search,
server pagination, selection or bulk actions just to fill the layout.

1. **`ListHeader`**: the page title (`h1`) with the page's existing creation
   and import actions beside it ("Add Event Feed", "Add Entry", "Import").
   The title is the stable focus target when the focused control goes away.
2. Page-level summaries and notices (totals, warnings).
3. **`ListToolbar`**, one row, in this order:
   - `selection`: a `SelectionSummary` with the selected count ("2
     transactions selected") and the actions that apply to the selection,
     only while items are selected, only on pages with bulk actions.
   - Search first (`ListToolbarField wide`), then the frequent filters, each
     with a visible label.
   - `actions`: `MoreFiltersToggle` when there are less-used filters, a
     page's Apply/Reset buttons where filters are applied explicitly, and
     "Clear filters" only while a criterion is active.
   - `count`: `ResultCount` at the end, the range and total of the
     matching results, using the server's pagination units ("51–100 of 236
     transactions", or "12 entries" on a single page). Omit it while there
     is nothing to count; the list message explains why.
   - `panel`: `MoreFiltersPanel` with the less-used filters, under the row.
     The page keeps the open state; the panel is hidden, not unmounted, so
     its fields keep their values. Keep it open while one of its fields
     shows a validation error.
4. **`AppliedFilters`**: the criteria that produced the shown rows,
   including those inside a collapsed More filters panel. Where drafts are
   applied explicitly (Transactions), list the applied criteria, not the
   draft.
5. The table, or a `TableMessage`. An empty dataset offers its first steps
   through `actions` ("Add your first event feed", "Import transactions");
   no results offers `onClear`. Clear-filters labels may repeat the
   toolbar's: both do the same thing.
6. **`ListPagination`** below the table, aligned right: "Previous page",
   "Page N of M", "Next page", in a `nav` named by `label`. Hidden for a
   single page. The boundary buttons stay focusable (`aria-disabled`), so
   reaching the last page keeps focus on Next. Keep it mounted while the
   next page loads. Pass `pageProps` for link navigation (URL-backed pages)
   or `onChange` for in-place page changes. The page owns the page number,
   resets it to 1 on a filter or sort change, and keeps it in the URL only
   where it already does.

After "Clear filters" removes itself, move focus to a stable toolbar
control (the search field or the More filters toggle).

**Narrow screens** (782px and below): toolbar fields, actions and the count
stack full width in the same order, and the pagination buttons share the
row under the position.

### Per page

| Page          | Header actions                                 | Visible filters        | More filters                  | Selection     | Pagination              |
| ------------- | ---------------------------------------------- | ---------------------- | ----------------------------- | ------------- | ----------------------- |
| Notifications | Add a notification (moves to the add form)     | Search, Event feed     | —                             | —             | Client-side, URL-backed |
| Event Feeds   | Add Event Feed                                 | —                      | —                             | —             | — (complete list)       |
| Entries       | Add Entry, Transfer, Import, Export CSV        | Budget, Type, Matching | Dates, Link, Tag              | —             | Server, in place        |
| Transactions  | Import, Load missing Mollie fees               | Search, Status, Mode   | Dates, amounts                | Export Selected | Server, in place      |

Transactions keeps "Reset filters" (back to Paid + Live) next to "Clear
filters" (every criterion off).

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
  `error`; `&layout=baseline` shows the same rows in the pre-#2205 table
  conventions; `&per_page=N` pages the rows to review pagination. The
  toolbar shows search, More filters (holding the scenario), a selection
  toggle and the count.

Tests: `src/admin-table/__tests__/` (Jest) and
`e2e/admin-table-example.spec.js` (layout, keyboard and focus in a browser).

## Pilot outcome: Event Feeds (#2206)

Event Feeds was the first page migrated. What it settled for the rollouts:

- **Primary action is the most frequent in-page action, not navigation.**
  When the identity link already opens the item, don't repeat it as "View";
  Event Feeds shows "Edit" (opening the existing editor) as the primary
  action.
- **Copy actions go in the menu,** before the destructive action, unless the
  page establishes copying as its primary workflow. The page owns the
  clipboard call and reports the result in a `Notice` naming the item and
  what was copied. When the clipboard is unavailable or rejects the write,
  the error notice includes the text itself so it can be copied by hand; the
  menu item stays available for a retry. No separate URL columns.
- **Name repeated primary actions per item.** Pass `accessibleLabel`
  (starting with the visible label, e.g. "Edit “Spring feed”") so a screen
  reader can tell rows' actions apart; the visible text stays short.
- **Eligibility explanations stay in their own column** when they describe
  one property of the item (the WhatsApp summary hint), and in
  `ItemIdentity`'s `children` when they concern the item as a whole.
- **Keep loaded rows mounted across reloads.** Show `TableMessage`
  `loading` only before the first successful load; afterwards refresh in
  place, so a `Modal` can return focus to the row's control. A failed reload
  shows the `error` message with a retry above the rows it keeps.
- **After deleting,** remove the row from local state, then move focus to the
  page heading (`tabIndex={ -1 }`) once the confirmation has closed.
- **Import the shared stylesheet from the page entry and enqueue the page's
  built `style-index.css`** in PHP; without the enqueue the table renders
  unstyled.
