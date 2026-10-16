## Purpose

The original "Get Tickets" signup block. It is superseded by **Event Signup**
(`fair-events/event-signup`) and kept only so that existing posts keep
working. Do not use it for new content.

## Availability

Registered on every site with Fair Events active, but hidden from the
inserter. In the editor an existing instance shows a notice and a preview,
and can be transformed into Event Signup (block toolbar → Transform), which
carries over `eventDateId` and `submitButtonText`.

## Composition

Top-level block without inner blocks.

## Attributes

- `eventDateId` — event date to sign up for; `0` means the current post's
  event date.
- `submitButtonText` — submit button label (default "Get Tickets").

## Prerequisites

The same as Event Signup: an event date on the current post (or the given
`eventDateId`) and configured ticket types.

## Rendering

Delegates to Event Signup: the output is the Event Signup form for the same
event date and button text, with Event Signup's defaults for the options this
block does not have.
