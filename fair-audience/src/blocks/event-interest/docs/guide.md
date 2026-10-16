## Purpose

Lets visitors register interest in an event without buying a ticket — for
example while sales have not opened yet. Interested participants receive a
confirmation email and are recorded against the event, so organizers can
contact them later.

## Composition

Top-level block without inner blocks. Place it on the event's own page.

## Attributes

- `submitButtonText` — button label (default "Register interest").
- `successMessage` — shown after submitting.
- `namePlaceholder` / `emailPlaceholder` — input placeholders.

Default English values are translated at render time, so leaving them unset
gives localized texts.

## Prerequisites

- Fair Events must be active, and the post must be an event: a post of an
  event-enabled type or one linked to an event date. Elsewhere the block
  renders nothing.
- Visitors already recognized by Fair Audience (logged-in user linked to a
  participant, or an audience session) are told they are registered instead
  of seeing the form again.

## Rendering

Renders `.fair-audience-event-interest` with a form posting to
`POST /wp-json/fair-audience/v1/event-interest`.
