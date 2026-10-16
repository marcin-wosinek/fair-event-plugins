## Purpose

A multi-line text answer, for comments, motivations, or descriptions. One of the Fair Form question blocks.

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
- `placeholder` — hint text inside the empty textarea.
- `rows` — visible height of the textarea in lines (default 4).

## Validation and storage

No format validation beyond `required`. Answers are stored with the submission (Fair Form → Responses)
or, inside Event Signup, with the signup.

## Prerequisites

Fair Form must be active. Inside Event Signup, Fair Events must be active too.

## Rendering

Renders `.fair-form-question.fair-form-question-long-text` with
`data-question-type="long_text"`, `data-question-key`, and `data-required`,
containing a label (with `*` when required) and an `textarea`.
