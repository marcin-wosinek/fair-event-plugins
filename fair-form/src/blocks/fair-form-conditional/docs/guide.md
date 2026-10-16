## Purpose

A group of form content that is shown only when a condition holds — for
example a follow-up question when a previous answer is "Yes". Hidden fields
are neither required nor submitted.

## Composition

- Nested inside `fair-audience/fair-form`, `fair-events/event-signup`, or
  (legacy content only) `fair-audience/event-signup`. Sections can be nested
  inside each other.
- **Inner blocks:** `core/heading`, `core/paragraph`, `core/list`, and every
  Fair Form question block, including another Conditional Section. Inside
  Event Signup the same reduced question set as Event Signup itself applies
  (no File Upload or Mailing Sign Up).
- The section is serialized with its inner blocks; the condition lives in its
  attributes.

## Attributes

- `conditionSource` — what the condition tests:
  - `question` (default) — the answer of another question in the same form;
  - `eventOption` — whether an event option/activity is selected (Event
    Signup only);
  - `ticketType` — whether one of the given ticket types is selected (Event
    Signup only, and only for events with ticket types).
- For `question`:
  - `conditionQuestionKey` — the `questionKey` of the controlling question.
    Place that question **before** the section.
  - `conditionOperator` — `equals` (default), `not_equals`, `contains`, or
    `not_empty`.
  - `conditionValue` — the value compared against (not used by `not_empty`).
    For choice questions use an option's exact `value`; `contains` matches
    one of several selected values of a multiselect, or a substring of text.
- For `eventOption`:
  - `conditionOptionShortName` — the option's short name (Fair Events → event
    → Prices tab → options).
  - `conditionOperator` — `selected` or `not_selected`.
- For `ticketType`:
  - `conditionTicketTypeIds` — ticket type IDs; the section shows when any of
    them is selected.
  - `conditionOperator` — `selected` or `not_selected`.

## Prerequisites

Fair Form must be active. The `eventOption` and `ticketType` sources need
Fair Events and the referenced option or ticket types configured on the event.

## Rendering

A section whose controlling reference is missing (no question key, no option
short name, or no ticket type IDs for its source) renders nothing. Otherwise
it renders `.fair-form-conditional` with `data-condition-*` attributes and
its content; the shared form script shows or hides it as the visitor answers.
