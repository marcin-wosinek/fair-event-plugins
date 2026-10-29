---
'fair-events-experimental': minor
---

See whether WhatsApp test sends were delivered.

- Fair Events → WhatsApp has a **Delivery updates** section with the webhook's callback URL and setup steps. Save Meta's App Secret and a verify token there (or set `FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_APP_SECRET` / `FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_VERIFY_TOKEN`); neither is ever shown again. The page says separately when Meta verified the callback URL and when the last authenticated update arrived.
- Only callbacks signed with the App Secret and addressed to the saved WhatsApp Business Account and Phone Number ID are used.
- **Recent messages** lists the last 30 days of test sends with their outcome: accepted, sent, delivered, read, not delivered (with a translated reason and WhatsApp's error code), not accepted, or unknown. Statuses refresh on their own while a message is waiting, and the list survives a page reload. Only the last three digits of each recipient number are kept.
- Repeated, late or simultaneous updates never move a message backwards; a confirmed delivery outranks an earlier failure, which stays visible.
- Incoming messages are handed to a developer hook for the upcoming opt-out feature. Nothing replies to them and they are not stored.
