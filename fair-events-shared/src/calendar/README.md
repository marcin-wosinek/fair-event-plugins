# Shared admin month calendar

One implementation of the month calendar used by:

- **Event administration** — `fair-events/src/Admin/calendar/CalendarApp.js`
  (Fair Events → Calendar).
- **Event feed previews** —
  `fair-events-experimental/src/Admin/source-view/SourceViewApp.js`
  (Fair Events → Event Feeds → View).

The shared code renders the calendar and does the date arithmetic. Each page
owns its URL state, its requests and everything around the calendar (filters,
notices, feed details, legends).

## Contract

Components are plain presentation: they read no plugin globals and call no
`__()`. Consumers pass every setting and every translated string, so each
plugin's strings live in its own text domain.

| Export           | Props / signature                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `CalendarHeader` | `currentDate`, `onPrevMonth`, `onNextMonth`, `onToday`, `onAddEvent?`, `labels`                                                               |
| `CalendarGrid`   | `currentDate`, `events`, `startOfWeek` (0–6, default 1), `onAddEvent?`, `manageEventUrl?`, `forceGrid?`, `showEmptyMessage?`, `labels`        |
| `DayCell`        | Rendered by `CalendarGrid`; exported for tests.                                                                                              |
| `month.js`       | `startOfMonth`, `addMonths`, `formatMonthParam`, `parseMonthParam`, `getCalendarDays`, `getVisibleRange`                                      |
| `eventLinks.js`  | `getEventLinkType`, `getLinkTypeIcon`, `getEventDateId`, `getEventUrl`                                                                        |

`labels` holds `previous`, `today`, `next`, `addEvent`, `untitled`,
`openDestination`, `noEvents` (strings) and `more( count )` (returns the
`_n()`-formatted "+N more" text).

- **Creation actions** appear only when `onAddEvent` is passed: the header's
  Add event button and each day's "+" button.
- **Event links:** with `manageEventUrl`, local events link to their
  management page; without it, every event links to its own `url`. Events
  with a `url` also get a destination button, which opens external pages in
  a new tab with `noopener noreferrer`.
- **Untitled events** show `labels.untitled`.
- **Crowded days:** every event is in the DOM. Grid mode clamps to
  `MAX_VISIBLE_EVENTS` rows with CSS and shows "+N more"; the mobile agenda
  (≤600px) lists every event.
- **Empty months:** the mobile agenda shows `labels.noEvents` only when
  `showEmptyMessage` is set. Pass it only after a successful load, so a
  failed or pending request is never reported as an empty month.
- **`forceGrid`** keeps the dated grid on mobile and suppresses the agenda
  empty message — for a page that shows its own empty-results message.

Styles: import `fair-events-shared/src/calendar/style.css` from the page's
entry point. The rules assume the calendar sits in a `Card`, with
`fair-events-calendar-card-body` on the `CardBody`.

## Intentional differences

| Behaviour                    | Administration                                                         | Feed preview                                              |
| ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| Creation actions             | Add event (header and days), quick-create modal                        | None                                                      |
| Event title link             | Manage-event page for local events; event URL otherwise                | Event URL (feeds include external events)                 |
| Category filter              | Yes, in the URL with the month (#1850)                                 | No                                                        |
| Filtered-empty results       | Message above a forced dated grid                                      | n/a                                                       |
| Requests                     | `/fair-events/v1/events`, 500 per page until a short page               | `/fair-events/v1/sources/{slug}/json`, one request        |
| Legend                       | Link-type legend below the grid                                        | None                                                      |
| Around the calendar          | Success notice after creating an event                                 | Feed details, feed URLs, edit modal, back link            |

Both pages keep the month in the `month` URL parameter (preserving unrelated
parameters), push a history entry per navigation, restore the month on
Back/Forward, and ignore responses to superseded requests.
