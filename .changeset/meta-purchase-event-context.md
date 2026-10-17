---
'fair-events-experimental': minor
---

Identify the purchased event in Meta checkout and purchase events: `InitiateCheckout` and `Purchase` now carry the event title (`content_name`), its stable identifier (`content_ids`), and the purchased occurrence's `event_date_id` and `event_start_date`. Events queued before the update are still delivered, without these details.
