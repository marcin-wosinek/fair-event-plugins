## Purpose

A newsletter subscription form with double opt-in: subscribers receive an
email and are added to the mailing list once they confirm. Optionally they
choose which categories of announcements they want.

## Composition

Top-level block without inner blocks. Inside a Fair Form use
`fair-audience/fair-form-mailing-signup` instead.

## Attributes

- `submitButtonText` — button label (default "Subscribe").
- `successMessage` — shown after submitting (default asks to check email).
- `showCategories` — show category checkboxes.
- `categoryIds` — post category term IDs offered; empty offers all
  categories.
- `preselectedCategoryIds` — categories checked by default.

## Prerequisites

Only Fair Audience, with outgoing email working (confirmation emails). Known
visitors (logged-in users linked to a participant, or an audience session) get
their name and email prefilled.

## Rendering

Renders `.fair-audience-mailing-signup` with a form posting to
`POST /wp-json/fair-audience/v1/mailing-signup`.
