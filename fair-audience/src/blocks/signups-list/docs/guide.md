## Purpose

Shows who has signed up for an event. Anonymous visitors see only the number
of signups; logged-in users — and participants whose group has the
"view signups" permission for the event — see the list of names with avatars.

## Composition

Top-level block without inner blocks. Place it on the event's page.

## Attributes

None of its own (alignment and spacing supports only).

## Prerequisites

- Fair Events must be active and the post must be of an event-enabled post
  type; elsewhere the block renders nothing.
- Signups come from Fair Audience event participants with the "signed up"
  label for the selected event date (`?event_date=` selects an occurrence).
- Group-based visibility additionally needs Fair Events Experimental and Fair
  Audience Experimental.

## Rendering

Renders `.audience-signups` with either a count ("3 people signed up") or a
list of names. Participants without a name are shown by email only to
viewers allowed to see the list.
