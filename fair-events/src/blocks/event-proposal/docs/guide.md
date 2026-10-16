## Purpose

A public form that lets visitors propose an event (title, date and time,
duration, optional description and category) for the organizers to review.

## Availability in this release

**Not registered.** The block's metadata ships, but Fair Events registers it
only when its `sources` feature is enabled, and the `sources` bundle now lives
in Fair Events Experimental. Fair Events' own feature registry has no such
key, and unknown keys resolve to "off", so on current releases:

- `GET /wp/v2/block-types/fair-events/event-proposal` returns 404;
- the block is not in the inserter;
- saved instances render nothing.

The submission endpoint (`EventProposalController`) is provided by Fair Events
Experimental when its `sources` feature is on. Do not author new content with
this block until a release documents it as `authoring`.

## Composition

Top-level block with no inner blocks.

## Attributes

- `enableCategories` — show a category selector populated with all post
  categories (default `true`).
- `enableDescription` — show a description textarea (default `true`).
- `submitButtonText` — label of the submit button.
- `enableNotifications`, `notificationEmail`, `successMessage` — editable in
  the block settings and stored, but not used by the current frontend
  rendering.

## Rendering

When registered, renders `.fair-events-proposal-form` containing the form;
logged-out visitors also see name and email fields.
