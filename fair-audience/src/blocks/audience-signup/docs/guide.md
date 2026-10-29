## Purpose

A standalone form that registers a visitor as an audience member (a Fair
Audience participant), without tickets or an event signup. Use it to grow a
community list, collect registrations of interest, or gather profile answers.

## Composition

Top-level block without inner blocks. Questions are stored in the `questions`
attribute (not as nested blocks); for block-based questions use Fair Form
(`fair-form/fair-form`).

## Attributes

- `submitButtonText` — button label (default "Register").
- `successMessage` — message shown after a successful registration.
- `showInstagram` — add an Instagram handle field.
- `showKeepInformed` — add the "keep me informed" checkbox. Checking it
  subscribes the participant to mailings after they confirm by email; when
  unchecked the participant is registered as confirmed without mailing
  consent.
- `questions` — an array of question objects, rendered in order:
  `{ "key": "city", "text": "Which city?", "type": "short_text", "required": true, "options": [] }`.
  `type` is one of `short_text`, `long_text`, `number`, `date`, `select`,
  `radio`, or `checkbox`; `options` (strings) is used by `select`, `radio`,
  and `checkbox`. `key` must be unique within the block (lowercase letters,
  digits, `_`); answers are stored under it.
- `eventDateId` — link the registration and answers to an event date. `0`
  (default) uses the current post's event date when the block is placed on an
  event post, and none otherwise.

## Prerequisites

Only Fair Audience. Linking to events needs Fair Events. Returning visitors
recognized by a participant link or session see their details prefilled.

## Rendering

Renders `.fair-audience-audience-signup` with a form posting to
`POST /wp-json/fair-audience/v1/audience-signup`; the success message replaces
the form after submission.
