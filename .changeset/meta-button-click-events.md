---
'fair-events-experimental': minor
---

Optional Meta conversions now also report clicks on event-page buttons as two
custom events: `FairEventCalendarClick` when a visitor activates "Add to
calendar", and `FairEventTicketClick` when they activate a button or link
marked with the `fair-events-ticket-button` CSS class, whether it jumps to a
ticket section or leads to another purchase page. Events carry the event and
the occurrence shown, need marketing consent and a Meta browser identifier,
never include the link's destination or text, and never delay or block the
button. Checkout and purchase reporting is unchanged.
