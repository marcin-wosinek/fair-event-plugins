## Purpose

A composable questionnaire: you build the form from question blocks, and
visitors' submissions are stored by Fair Form (Fair Form → Responses), with
an optional notification email. Use it for applications, surveys,
registrations, and feedback. For signing up to an event with tickets use
Event Signup (`fair-events/event-signup`), which accepts the same questions.

## Composition

- Top-level block, no parent restriction; supports wide/full alignment and
  padding/margin.
- **Inner blocks:** `core/heading`, `core/paragraph`, `core/list`, and the
  Fair Form blocks: `fair-form/fair-form-short-text`, `-long-text`,
  `-email`, `-phone`, `-url`, `-date`, `-datetime`, `-select-one`,
  `-multiselect`, `-radio`, `-file-upload`, `-consent`, `-conditional`, and
  `-mailing-signup`.
- The block names use the `fair-audience` namespace for historical reasons;
  they are supplied by Fair Form (see `ownerPlugin` in `index.json`).
- The submit button is rendered automatically after the inner blocks.

## Attributes

- `formId` — a UUID that identifies this form within the post; submissions
  and notification lookups use it. The editor generates one and regenerates
  it when a form is duplicated. Generated content must give each Fair Form
  block its own UUID.
- `formTitle` — a name for the form shown in the responses view (useful when
  a page has several forms).
- `submitButtonText` — button label (default "Submit").
- `successMessage` — shown after a successful submission.
- `notificationEmail` — address that receives an email for every submission;
  empty sends none.
- `eventDateId` — associate submissions with an event date (needs Fair
  Events). `0` means none. In the editor the event-date picker suggests the
  current post's event.

## Prerequisites

- Fair Form only, for storing submissions.
- Fair Audience (optional): an Email question then links each submission to a
  participant, and Mailing Sign Up can subscribe them.
- A form needs at least one question with text to collect anything.

## Rendering

Renders `.fair-form` (with `data-form-id`, `data-form-title`,
`data-event-date-id`, `data-post-id`) containing `form.fair-form-form`, the
rendered inner blocks, and a submit button. The frontend script validates
the answers and submits them to `POST /wp-json/fair-form/v1/fair-form-submit`.
