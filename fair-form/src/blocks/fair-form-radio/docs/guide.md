## Purpose

A single choice shown as radio buttons, all options visible at once. One of the Fair Form question blocks.

## Composition

It can be nested (at any depth) inside:

- `fair-audience/fair-form` — directly or inside a Conditional Section;
- `fair-events/event-signup` — as a signup question (Fair Events' Event
  Signup offers a smaller set of question types; see below);
- `fair-audience/event-signup` — only in content saved with that removed
  block, which now renders as Event Signup.

`ancestor` metadata alone does not make a question insertable: each parent
also keeps its own allow-list. Fair Form and Conditional Section accept every
question type; Event Signup accepts all of them except File Upload and
Mailing Sign Up.

**Inner blocks:** the options, as `fair-audience/fair-form-option` blocks (the
only allowed child), in display order. A question without options renders no
choices.

## Attributes

- `questionText` — the label shown to visitors. **Required for rendering:** a
  question with empty text renders nothing.
- `questionKey` — the stable key the answer is stored under (lowercase
  letters, digits, `_`). The editor derives it from the question text when
  left empty, e.g. "Your city" → `your_city`. Keys must be unique within a
  form; changing a key later separates new answers from old ones in the
  responses view, and Conditional Sections refer to questions by key.
- `required` — the form cannot be submitted without an answer.

The options are not attributes: each is a nested Form Option block whose
`value` is both the visible label and the stored answer.

## Validation and storage

Answers are stored as submitted (the option values the visitor picked); the
server does not re-check them against the option blocks.
Conditional Sections can show or hide content based on the answer (operators
`equals`, `not equals`, `contains`, `is not empty`).

## Prerequisites

Fair Form must be active (and Fair Events inside Event Signup).

## Rendering

Renders `.fair-form-question.fair-form-question-radio` with
`data-question-type="radio"`, `data-question-key`, and `data-required`,
containing the label and one radio input per option block. The option blocks render nothing themselves.
