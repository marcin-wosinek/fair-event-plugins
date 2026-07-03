# Admin UI / UX Guidelines

Rules for admin-page UX across all Fair Event Plugins. They complement
[REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md) (which owns the
architecture) and target the first-time organizer who has never seen these
plugins before. Most rules originate from the 2026-07 UI review of the Manage
Event page (issues #986–#995) — check those tickets before re-fixing the same
screens.

## Orientation: say what the user is editing

- The page header must identify the object fully: title **and** date, plus a
  variant badge when the same page serves different modes (e.g. "Recurring
  series — 10 occurrences" vs. "Occurrence of _Test 2_ on July 7").
- Contextual notices ("this is an occurrence of…", "payments not set up for
  these tickets") belong **at the top of the content they affect**, never below
  the fold.
- Never disable a control (tab, button) without a discoverable reason. If
  `TabPanel` can't show a tooltip on a disabled tab, put the explanation in a
  nearby inline note ("Tickets are managed on the series — open the master
  event").

## Save model: buttons do exactly what they say

- A save button saves only what its label says. Scope save buttons to the tab
  or card whose state they persist ("Save event details", "Save tickets") and
  hide them on read-only views. Never one global button whose behavior changes
  with the active tab.
- Track dirty state. Warn before edits are lost (`beforeunload` guard) and mark
  the tab or section holding unsaved changes.
- A disabled save button must say why, inline ("Title is required") — a bare
  disabled button is a dead end.

## Progressive disclosure: primary task first

- The main editing UI is visible and interactive when the view opens. Don't
  hide it in a collapsed accordion, and don't lead with a read-only summary of
  data that is editable further down — one table, one mental model.
- Power-user features (export/import, advanced toggles) go in an overflow menu
  (`DropdownMenu`) or a collapsed "More options" section, not the primary
  button row.
- When a feature depends on another plugin's setup (e.g. ticket prices need
  Fair Payments Connector configured), surface the warning **inside the screen
  where the user configures the dependent feature**, with a link to fix it — a
  site-wide banner alone is not enough.

## Language: name intentions, not implementation

- Label controls by what the user wants, not by the data model. "Where does
  this event link to?" beats "Link type: Event placeholder". Keep
  master/generated, placeholder, rrule and similar vocabulary out of the UI
  (use "series" / "single date").
- Renames are display-only: never change REST field names or DB values in a
  wording pass, and regenerate translation catalogs
  ([TRANSLATIONS.md](./TRANSLATIONS.md)) in the same PR.

## i18n: translatable sentences only

- Never build a sentence by concatenating `__()` fragments or interpolating
  between them — translators can't reorder the parts. Use one string with
  `sprintf` placeholders.
- Anything countable uses `_n()`:

  ```javascript
  // ❌ '(%d days before event)' — renders "1 days"
  // ❌ __('This event is linked to') + count + __('posts.')
  sprintf(
  	_n(
  		'This event is linked to %d post.',
  		'This event is linked to %d posts.',
  		count,
  		'plugin-name'
  	),
  	count
  );
  ```

## Input: never silently drop what the user typed

- If a token/tag field only accepts known values, either create unknown values
  on the fly (what users expect from WordPress tag fields) or reject them
  visibly with a message — never filter them out quietly.
- Required fields are enforced twice: in the UI (disabled submit + inline
  message — the `required` prop on a `TextControl` alone validates nothing) and
  in the REST controller.
- Any display field that can be empty in the DB gets a rendered fallback
  ("(untitled event)"), everywhere it appears — a blank calendar bar or empty
  list cell is not acceptable.

## Destructive actions

- No `window.confirm` / `alert`. Use `ConfirmDialog` (or a small modal) that
  names the object and the blast radius: "Delete _Test 2_ and its 9
  occurrences? This cannot be undone."
- Destructive buttons use `isDestructive`; the confirm button names the action
  ("Delete event"), not "OK".

## Dates and times: one interpretation, everywhere

- Stored datetimes (`start_datetime` etc.) are naive site-local strings. Every
  view must format them with the same convention — `dateI18n` converts assuming
  UTC by default, which double-converts and shifts the displayed time (issue
  #993). Pass explicit timezone handling and verify all consumers of the same
  field show the same wall-clock time.
- Test date display with a site timezone ≠ UTC (e.g. Europe/Madrid) — the
  default UTC dev site hides this whole bug class.

## See Also

- [REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md) — admin page architecture
- [TRANSLATIONS.md](./TRANSLATIONS.md) — translation tooling
- [TICKETS.md](./TICKETS.md) — turning review findings into issues
