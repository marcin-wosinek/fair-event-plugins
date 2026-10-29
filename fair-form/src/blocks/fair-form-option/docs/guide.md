## Purpose

One answer option of a choice question. Its `value` is the text shown to the
visitor and the value stored as the answer.

## Composition

- **Parent:** must be a direct child of `fair-form/fair-form-select-one`,
  `fair-form/fair-form-radio`, or `fair-form/fair-form-multiselect`.
- No inner blocks. It cannot be made reusable.

## Attributes

- `value` — the option's label and stored value. Keep values unique within a
  question; Conditional Sections compare answers against these strings.

## Prerequisites

Fair Form must be active.

## Rendering

Renders nothing by itself: the parent question reads its option blocks and
renders them as `option` elements, radio buttons, or checkboxes.
