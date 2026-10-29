## Purpose

A single choice from a dropdown list. One of the Fair Form question blocks.

## Composition

It can be nested (at any depth) inside:

- `fair-form/fair-form` — directly or inside a Conditional Section;
- `fair-events/event-signup` — as a signup question (Fair Events' Event
  Signup offers a smaller set of question types; see below);
- `fair-audience/event-signup` — only in content saved with that removed
  block, which now renders as Event Signup.

`ancestor` metadata alone does not make a question insertable: each parent
also keeps its own allow-list. Fair Form and Conditional Section accept every
question type; Event Signup accepts all of them except File Upload and
Mailing Sign Up.

**Inner blocks:** the typed options, as `fair-form/fair-form-option`
blocks (the only allowed child), in display order. They are used only while
`optionSource` is `manual`; a question without options renders no choices.
With a category source the option blocks are kept but ignored, so switching
back to typed options restores them.

## Attributes

- `questionText` — the label shown to visitors. **Required for rendering:** a
  question with empty text renders nothing.
- `questionKey` — the stable key the answer is stored under (lowercase
  letters, digits, `_`). The editor derives it from the question text when
  left empty, e.g. "Your city" → `your_city`. Keys must be unique within a
  form; changing a key later separates new answers from old ones in the
  responses view, and Conditional Sections refer to questions by key.
- `required` — the form cannot be submitted without an answer. This holds
  for a category-backed question with no choices too.
- `optionSource` — where the choices come from:
  - `manual` (also content saved before the attribute existed) — the typed
    option blocks;
  - `categories` — every standard WordPress post category;
  - `categoryChildren` — every descendant of `parentCategoryId`, at any
    depth, excluding the parent itself.
- `parentCategoryId` — the parent category's term ID, used only by
  `categoryChildren`. A missing or deleted parent yields no choices; it never
  falls back to every category.

Category choices include empty categories, are sorted by name and follow the
site's normal category query filters (for example a multilingual plugin's
current language). They are resolved on every render, so added, renamed and
deleted categories show up without editing the form. Identically named
categories appear once. Custom taxonomies are not supported.

Typed options are not attributes: each is a nested Form Option block whose
`value` is both the visible label and the stored answer. For a category
source, the category name is both.

## Transforms

Select One and Multiselect convert into each other, keeping the option source
and parent. Converting to a Radio Button question is offered only with typed
options; switch a category-backed question back to typed options first.

## Validation and storage

Answers are stored as submitted (the option values or category names the
visitor picked); the server does not re-check them against the current
choices. A stored answer keeps the name it was given, so renaming or deleting
a category later leaves earlier answers readable — but a Conditional Section
comparing against the old name needs updating; the editor flags such values.
Conditional Sections can show or hide content based on the answer (operators
`equals`, `not equals`, `contains`, `is not empty`).

## Prerequisites

Fair Form must be active (and Fair Events inside Event Signup).

## Rendering

Renders `.fair-form-question.fair-form-question-select-one` with
`data-question-type="select"`, `data-question-key`, and `data-required`,
containing the label and a `select` with a "Select an option..." first entry and one `option` per choice. A category-backed question without choices
renders only the first entry, followed by a `.fair-form-question-empty` note. The option blocks render nothing themselves.
