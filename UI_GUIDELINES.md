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

## Popups and confirmations

This section is the canonical popup policy for every plugin. Implementation
guidance lives in
[REACT_ADMIN_PATTERN.md § Popups and confirmations](./REACT_ADMIN_PATTERN.md#popups-and-confirmations);
`npm run validate:native-popups` enforces the first rule in the plugins listed
in [TESTING.md § Native popup check](./TESTING.md#native-popup-check).

### No browser-native popups

- Never call `confirm()`, `alert()` or `prompt()`, bare or through `window`,
  `globalThis` or `self`. They can't name the target with formatting, can't
  show pending state or a retryable error, aren't translatable as a whole,
  and block the page. There is no allowlist: replace a native popup, don't
  exempt it.
- **The one native exception is navigation protection.** A `beforeunload`
  handler that calls `event.preventDefault()` (the browser shows its own
  "Leave site?" prompt) is how unsaved edits are guarded — see
  [Save model](#save-model-buttons-do-exactly-what-they-say). It must not call
  `confirm()` itself.

### Pick the right surface

| Need                                                 | Surface                                                   |
| ---------------------------------------------------- | --------------------------------------------------------- |
| Ask before an action with consequences               | **Confirmation** — a dialog with Cancel and a named action |
| Collect input for an action (assign, edit, create)   | **Editing modal** — the form is the confirmation           |
| Explain a field or status without changing anything | **Information popover** / help text — no buttons to act    |
| Report what happened                                 | **Notice** — inline, next to what it affects; or a snackbar for a brief success |

- Don't confirm what is cheap to undo or obviously requested (saving a form,
  toggling a filter). Confirm deletions, publication changes, sending mail,
  anything touching payments, and anything affecting more than the visible
  object.
- Never use a confirmation to report a result, and never put an action
  button in an information popover.

### Name the target and the consequences

A confirmation answers: _what exactly changes, for whom, and can it be undone?_

- **Identify the target** the way the organizer recognizes it: the person's
  name (with email when names can collide), the ticket's position and
  reference, the event's title **and date**, the transaction's amount and
  date. "Delete this item?" is never enough.
- **State the related-data scope.** Say what else goes with it: "Delete the
  registration for _Ana Ruiz_, with all 3 of its tickets?" plus "This deletes
  the entire purchase on every date: 1 on this date and 2 tickets on other
  dates." For a series, name the series and its date count; list linked pages
  that change too.
- **Say what does _not_ change** when an organizer could reasonably assume it
  does — especially money: "It removes only the local signup record and does
  not refund or cancel any payment-provider transaction." "The purchase and
  its payment stay with the purchaser."
- **State reversibility accurately.** "This cannot be undone" only when true;
  otherwise say how to undo it ("You can move it back to draft").
- Use counts with `_n()` and one sentence per `sprintf` — see
  [i18n](#i18n-translatable-sentences-only).

### Bulk actions

- Show the selected count **and** the reviewable identities (a scrollable list
  of names, not just "12 participants").
- Say up front which selected items are ineligible and why, and whether the
  action skips them.
- Report partial results: what succeeded, and which items failed with each
  item's reason. Keep only the failed items in the dialog for a retry.

### Buttons, styling and wording

- The confirming button names the action — "Delete registration", "Publish
  event", "Assign ticket" — never "OK" or "Yes". Cancel is "Cancel".
- Destructive actions (delete, cancel, remove access) use `isDestructive` on
  the confirming button. Non-destructive confirmations (publish) don't.
- The title names the action and, for a single target, the target ("Delete
  participant — Ana Ruiz").

### Pending and error behaviour

- While the request runs: the confirming button shows busy state (optionally
  a pending label, "Assigning…"), and both it and Cancel are disabled.
  Escape, the close button and clicking outside are blocked too — the outcome
  of a dismissed in-flight request is unknown to the user.
- Prevent duplicate submission in code, not only by disabling the button: a
  double click can fire before the re-render (`if ( isBusy ) return;` or a
  ref).
- On failure, keep the dialog or editor open with everything the user entered
  or selected, and show the server's message in an inline error `Notice` with
  a translatable full-sentence fallback. The user can retry or cancel from
  there.
- Clear a stale error when a new attempt starts and when the dialog closes.
- On success, close the dialog and confirm the result with a notice next to
  the affected content.

### Accessibility

- Use `Modal`/`ConfirmDialog` from `@wordpress/components`: they trap focus,
  label the dialog with its title and close on Escape (when not pending).
- Focus moves into the dialog on open and returns to the triggering control
  on close — don't unmount the trigger while the dialog is open.
- Everything is keyboard-operable; no hover-only controls.
- Errors and results are announced: `Notice` from `@wordpress/components`
  speaks its message via `@wordpress/a11y`. Don't convey status by color
  alone.

### Responsive layout

- Dialogs fit a 375px viewport: cap width (`maxWidth: '560px', width: '100%'`),
  let long names and titles wrap (`overflowWrap: 'anywhere'`), and let the
  button row wrap.
- Long lists (bulk identities, linked pages) scroll inside the dialog body,
  not the page.

### Public pages

Public `viewScript` code follows the same rules — no native popups — but
stays lightweight: don't import `@wordpress/components` or the admin
component stack. Prefer inline feedback next to the form (an element with
`role="status"` or `role="alert"`), keep entered values after an error, and
disable the submit button while pending. When a public flow genuinely needs a
dialog, use a native `<dialog>` element with `showModal()` and a named action
button — it provides focus trapping and Escape handling without a framework.

### Reference experiences

These show the useful parts of the policy in real code. They are examples of
specific behaviour, not certification that each satisfies every rule above.

- **Registration deletion** — `fair-events/src/Admin/manage-event/EventSignups.js`:
  names the registrant, counts tickets on this date and other dates, mentions
  inactive tickets, and says the local deletion does not refund or cancel
  provider payments.
- **Event publication** — `fair-events/src/Admin/manage-event/ManageEventApp.js`:
  distinguishes a single event from a whole series (with date count), lists
  linked pages that change too, and notes that unsaved detail edits are not
  saved by this action.
- **Ticket assignment** — `fair-audience/src/Admin/manage-event-audience-tab/AssignTicketModal.js`:
  an editing modal that names the ticket, the purchaser and current assignee,
  states that purchase ownership and payment stay unchanged, and blocks
  assignment with an inline reason.
- **Bulk participant deletion** — `fair-audience/src/Admin/components/DeleteParticipantsModal.js`:
  lists every selected identity, guards against a double submit with a ref,
  reports partial success, and keeps only the failed profiles with their
  reasons for a retry.

## Dates and times: one interpretation, everywhere

- Stored dates and times (`start_date`, `start_time` etc.) are naive site-local
  values; show a time only when one is set (`formatTimingStart()` in
  fair-events-shared). Every view must format them with the same convention —
  `dateI18n` converts assuming UTC by default, which double-converts and shifts
  the displayed time (issue #993). Pass explicit timezone handling and verify all consumers of the same
  field show the same wall-clock time.
- Test date display with a site timezone ≠ UTC (e.g. Europe/Madrid) — the
  default UTC dev site hides this whole bug class.

## See Also

- [REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md) — admin page architecture
- [TRANSLATIONS.md](./TRANSLATIONS.md) — translation tooling
- [TICKETS.md](./TICKETS.md) — turning review findings into issues
