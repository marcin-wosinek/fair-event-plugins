---
'fair-events': minor
'fair-audience': minor
'fair-events-shared': patch
---

Changing a ticket's holder from the Audience tab is now a reviewed, recorded step. "Change ticket holder" (formerly "Assign ticket") lets you pick an existing participant or add a new one. A new participant needs a name and an email address. When the email already belongs to someone, that person's stored details are shown for you to select, and their profile is left unchanged. Before saving, a review step names the ticket, its current and new holder and its purchaser, and explains that the payment stays with the purchaser. If another administrator changed the holder in the meantime, the change is refused and the review shows the ticket's current holder.

Each change is recorded with the previous and new holder, the time and the administrator, and is listed under "Holder changes" in the ticket details. The details now also show "Ticket holder" and "Purchased by". Repeated changes keep the original purchaser. Anonymizing a participant removes them from this history, and deleting a purchase deletes its history. Changes made before this update aren't in the history. Fair Events adds the history table (database version 3.53.0) on the first request after the update. Update Fair Events before Fair Audience: until then, Fair Audience refuses holder changes and asks for the update.
