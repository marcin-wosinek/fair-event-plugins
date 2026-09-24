---
'fair-events': minor
'fair-audience': patch
---

Record every purchased admission as its own ticket unit. A signup for three tickets now owns three individually identifiable tickets, each with a permanent ID, an unguessable public reference, its event date, ticket type, status, purchaser, and current holder. Ticket status follows the signup through payment, expiry, retry, failure, and checkout cancellation, and deleting a signup removes its tickets. Existing signups, including pending, expired, and failed ones, receive their tickets through a background migration that runs in small batches, can resume after an interruption, never creates duplicates, and finishes only after every signup's tickets match its quantity. When fair-audience matches existing signups to participants by email, their tickets are linked to that participant too, and deleting a participant's data removes the participant from their tickets while keeping the purchase history. Signup data and event participation records are unchanged.
