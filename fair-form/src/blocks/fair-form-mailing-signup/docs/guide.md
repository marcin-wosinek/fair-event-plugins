## Purpose

Adds a "subscribe to our mailing list" opt-in to a Fair Form, optionally with
category preferences. Visitors who opt in get a confirmation email and join
the mailing list after confirming (double opt-in).

## Composition

- **Parent:** must be a direct child of `fair-form/fair-form` or of a
  `fair-form/fair-form-conditional` inside one. Not available in Event
  Signup, which has its own "keep me informed" checkbox.
- No inner blocks. Use at most one per form.
- The form needs an Email question (`fair-form/fair-form-email`): the
  subscription is made for the submitted email address.

## Attributes

- `showCategories` — show category checkboxes.
- `categoryIds` — post category term IDs to offer; empty offers all.
- `preselectedCategoryIds` — categories checked by default.

## Prerequisites

- Fair Form, plus **Fair Audience** for the subscription itself: without Fair
  Audience the checkbox renders but opting in has no effect.
- Outgoing email for the confirmation message.

## Rendering

Renders `.fair-form-mailing-signup` with the opt-in checkbox and, when
enabled, the category checkboxes.
