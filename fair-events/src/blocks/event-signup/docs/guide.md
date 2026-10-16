## Purpose

The signup and ticketing form for one event date. Visitors choose a ticket
type (and options or sessions where configured), enter their details, answer
any questions, and sign up — paying through Fair Payments Connector when the
ticket has a price. This is the block to use for all new signup forms; it
replaces `fair-events/get-tickets` and `fair-audience/event-signup`.

## Composition

- Top-level block, no parent restriction.
- **Inner blocks (optional):** form content shown inside the form, after the
  ticket and personal-details fields:
  - always: `core/heading`, `core/paragraph`, `core/list`;
  - when Fair Form is active: the question blocks
    `fair-audience/fair-form-short-text`, `-long-text`, `-email`, `-phone`,
    `-url`, `-date`, `-datetime`, `-select-one`, `-radio`, `-multiselect`,
    `-consent`, and `-conditional`.

  `fair-audience/fair-form-file-upload` and
  `fair-audience/fair-form-mailing-signup` are deliberately **not** allowed
  here (there is no vetted anonymous-upload path, and mailing consent has its
  own checkbox). Questions are answered once per signup and stored with it.
- The block saves its inner blocks; with none it serializes as a
  self-closing comment.

## Attributes

- `eventDateId` — which event date to sign up for. `0` (default) resolves, in
  order: the `?event_date=` URL parameter scoped to the current post's series,
  then the current post's own event date. Set it only to place the form on a
  page that is not linked to the event.
- `submitButtonText` — submit button label (default "Get Tickets").
- `showTicketPrice` — show prices next to ticket types.
- `showOptionPrices` — show prices next to add-on options/activities.
- `showKeepInformed` — show the "Keep me informed about future events"
  checkbox. When hidden, the signup grants no mailing consent.
- `isEditorPreview` — internal; the editor sets it on its server-side preview.
  Never set it in saved content.

## Prerequisites

- An event date: the current post must be a `fair_event` post or linked to an
  event date, or `eventDateId` must point to one. Without one the block
  renders "Event Signup: could not resolve an event date for this page."
- Ticket types and prices are configured on the event's **Prices** tab. A
  free ticket type produces a plain signup; priced ticket types need Fair
  Payments Connector connected to Mollie.
- Fair Audience (optional) adds participant recognition, prefill, group
  pricing, and signed-up state for returning visitors.
- Fair Form (optional) provides the question blocks.

## Rendering

Renders `.fair-events-get-tickets` containing the signup `form`, nested
questions in `.fair-events-event-signup-questions`, and, after a payment
redirect, a payment-status card. The baseline markup is identical for every
visitor (safe for full-page caches); per-visitor details are loaded by the
frontend script from `GET /wp-json/fair-events/v1/get-tickets/viewer-context`.
