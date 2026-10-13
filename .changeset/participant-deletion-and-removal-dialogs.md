---
'fair-audience': minor
---

Deleting participants and removing them from an event now ask in the same
kind of popup everywhere, instead of in browser dialogs.

- **Deleting a profile** — from All Participants or a participant's own page —
  names the person, or counts and lists everyone selected, and says what
  deletion does: the profile is gone for good, while tickets, event
  registrations and payments are not cancelled, deleted or refunded. When
  some profiles cannot be deleted, the others are, and only the failed ones
  stay selected for another try.
- **Removing from an event** on the Event Participants page uses the popup of
  the Manage Event Audience tab, for one participant or several. It names the
  event and its date, lists who is removed, and says that profiles, other
  dates and payments are kept. Participants who still hold tickets or
  registrations are listed with what to resolve first and stay in the
  audience; the rest are removed. Inherited series passes are no longer
  offered for removal there, and the bulk action is reachable on phones.
- **Feedback** for adding or editing a participant, adding people to an
  event, changing a role and sending invitations appears next to the form
  that caused it. A failure keeps what you typed or selected, a save cannot
  be sent twice, and a profile that was created before a group change failed
  is updated — not created again — when you retry.

Also fixed: the Event Participants page showed the event time shifted by the
browser's timezone, and the participant page linked back to — and returned
after deletion to — a page that does not exist.

The batch removal route (`DELETE
fair-audience/v1/event-dates/{id}/participants/batch`) additionally returns
`failures`: the participant ID, error code, message and blockers of each
participant it kept.
