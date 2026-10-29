## Purpose

`fair-audience/event-signup` was Fair Audience's own signup block. It has been
removed; its name is kept only so that pages saved with it keep showing a
signup form. **Never author new content with it** — use
`fair-events/event-signup`.

## Availability

- Registered in PHP (`src/Hooks/BlockHooks.php`) without a block.json, editor
  script, or frontend script, and hidden from the inserter.
- In the editor an existing instance has no edit interface of its own. Replace
  it with Event Signup; the questions nested in it can be moved over
  unchanged, because the same Fair Form question blocks are allowed in Event
  Signup (except file uploads).
- Its examples are covered by rendering tests only, not by editor tests.

## Attributes

- `signupButtonText` — the saved button label. It becomes Event Signup's
  `submitButtonText`; when absent or empty the label is "Sign Up", as it was
  in the removed block.

Any other saved attributes are passed to Event Signup unchanged.

## Composition

Saved instances may contain Fair Form question blocks, which keep their saved
order. A form that contains a file-upload question
(`fair-form/fair-form-file-upload`, or its legacy name
`fair-audience/fair-form-file-upload`) is not rendered: visitors see "This form is temporarily unavailable. Please contact
the organizer." because Event Signup has no anonymous-upload path.

## Prerequisites

Fair Events must be active (the alias renders nothing otherwise), and the page
must resolve an event date as for Event Signup.

## Rendering

Renders exactly what `fair-events/event-signup` renders for the same event,
with the button text described above.
