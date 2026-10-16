## Purpose

A single checkbox the visitor ticks to agree to something — terms and
conditions, a privacy notice, photo consent. One of the Fair Form question
blocks.

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

It has no inner blocks.

## Attributes

- `questionText` — the label shown to visitors. **Required for rendering:** a
  question with empty text renders nothing.
- `questionKey` — the stable key the answer is stored under (lowercase
  letters, digits, `_`). The editor derives it from the question text when
  left empty, e.g. "Your city" → `your_city`. Keys must be unique within a
  form; changing a key later separates new answers from old ones in the
  responses view, and Conditional Sections refer to questions by key.
- `required` — the form cannot be submitted without an answer.

Unlike the other questions, `required` defaults to `true`: the form cannot be
submitted until the box is ticked. Set it to `false` for optional consent
(for example, consent to be photographed).

The question text is the checkbox label; links cannot be embedded in it, so
put links to terms in a paragraph next to the question.

## Validation and storage

The answer is stored as given or not given, with the submission or signup.

## Prerequisites

Fair Form must be active (and Fair Events inside Event Signup).

## Rendering

Renders `.fair-form-question.fair-form-question-consent` with
`data-question-type="checkbox"`, one checkbox, and its label.
