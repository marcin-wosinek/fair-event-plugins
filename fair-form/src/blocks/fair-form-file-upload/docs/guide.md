## Purpose

Lets visitors attach a file — a photo, a CV, a portfolio PDF. Uploaded files
are stored in the media library and linked from the submission.

## Composition

- Nested (at any depth) inside `fair-audience/fair-form`, including inside a
  Conditional Section.
- **Not available in Event Signup** (`fair-events/event-signup`): there is no
  vetted upload path for anonymous signups. A saved
  `fair-audience/event-signup` form containing a file upload is not rendered
  at all.
- No inner blocks.

## Attributes

- `questionText`, `questionKey`, `required` — as for every Fair Form question
  (the text is required for the question to render; the key must be unique
  within the form).
- `acceptedTypes` — the `accept` filter for the file picker: MIME types or
  extensions, comma-separated, e.g. `image/*` (default), `application/pdf`,
  or `.pdf,.doc,.docx`.
- `maxFileSize` — maximum size in megabytes (default 5), checked in the
  browser before upload.

Whatever the attributes say, the server accepts only JPEG, PNG, GIF, WebP,
PDF, DOC, and DOCX files of at most 20 MB (and the site's own upload limit).

## Prerequisites

Fair Form must be active. The site must accept uploads of the chosen types.

## Rendering

Renders `.fair-form-question.fair-form-question-file-upload` with
`data-question-type="file_upload"`, `data-max-file-size`, and
`data-accepted-types`, containing an `input[type=file]`.
