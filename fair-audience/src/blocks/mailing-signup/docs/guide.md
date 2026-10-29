## Purpose

A newsletter subscription form with double opt-in: subscribers receive an
email and are added to the mailing list once they confirm. Optionally they
choose which categories of announcements they want, and whether they want
the weekly email of upcoming events from Fair Events' event feeds.

## Composition

Top-level block without inner blocks. Inside a Fair Form use
`fair-form/fair-form-mailing-signup` instead.

## Attributes

- `submitButtonText` — button label (default "Subscribe").
- `successMessage` — shown after submitting (default asks to check email).
- `showCategories` — show category checkboxes.
- `categoryIds` — post category term IDs offered; empty offers all
  categories.
- `preselectedCategoryIds` — categories checked by default.
- `weeklyUpdate` — the "Receive a weekly update" checkbox: `hidden` (the
  default) leaves weekly emails as they are and sends no weekly fields;
  `unchecked` and `checked` show it with that starting state.
- `feedSelection` — with the checkbox shown, `multiselect` lists every event
  feed that has a weekly update, none selected, and asks for at least one
  when the checkbox is checked; `hidden` subscribes to the single `feedId`
  without showing a feed choice.
- `feedId` — the event feed of the `hidden` feed selection.

Weekly and category choices are independent. Chosen weekly preferences wait
for the email confirmation and apply only when it is used; an address that is
already subscribed is emailed a link to change its preferences instead.

## Prerequisites

Only Fair Audience, with outgoing email working (confirmation emails). The
weekly update needs Fair Events with at least one event feed that has an
enabled weekly email; otherwise the form says weekly updates are not
available and signs up without them, never with every feed. Known
visitors (logged-in users linked to a participant, or an audience session) get
their name and email prefilled.

## Rendering

Renders `.fair-audience-mailing-signup` with a form posting to
`POST /wp-json/fair-audience/v1/mailing-signup`. With the weekly checkbox
shown, `.fair-audience-mailing-weekly` carries the form's signed feed
configuration (`data-weekly-config`); the server resolves a hidden feed from
it and checks every feed again on submission.
