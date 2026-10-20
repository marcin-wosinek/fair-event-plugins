## Purpose

A compact, chronological list of the sessions of a recurring event that
visitors can still attend. Each entry shows the session's full date (with the
year), only the times that were set for it, its venue or address, and links to
that session's own page. Use it next to Event Info, which describes one
session or the series, so visitors can move between sessions.

## Composition

No inner blocks and no parent restriction. Place it anywhere on an event post,
a page linked to an event, or a single-event template (it reads `postId` from
block context). It is independent of Event Info and the signup block, so it can
sit above, below, or beside them.

## Attributes

`maxSessions` sets how many sessions are listed (1–20, default 5). The server
clamps any other value into that range, so long series stay cheap to render.

## Prerequisites

- The current post must be linked to a recurring Fair Events event (a series).
  On a page without a linked event, or with a single event, visitors see
  nothing; the editor explains why.
- A draft series is hidden from visitors.
- Sessions come from the series only: its first session and every generated
  session, never unrelated events. Cancelled sessions are left out.

## Rendering

Renders `.wp-block-fair-events-other-sessions` with a `nav` landmark around a
list of sessions, in the initial HTML; no JavaScript runs on the page.

- On the series overview it lists the upcoming sessions.
- On a session page (`?event_date=<YYYY-MM-DD>`, or a page linked directly to
  one session) it lists the other upcoming sessions and leaves that session
  out.
- A session stays listed while it is ongoing. With an end time it is removed
  once that time is reached; without one, it stays through its end date in the
  site timezone. That boundary is never shown as a time.
- Only supplied times are shown. An end time without a start time is labelled
  ("Ends 21:30, …"); a midnight time is shown as 00:00; an all-day session is
  marked "All day". Session-specific times and venues are shown as set on the
  session.
- Links go to the event's own page on this site with `?event_date=` for every
  session, the first one included — never to an external event link.
- With nothing left to attend it says so. An invalid `?event_date=` selection
  shows that the selected session is unavailable above the list.
