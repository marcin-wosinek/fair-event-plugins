---
'fair-events-experimental': minor
---

Connect WhatsApp manually and send a test template.

- Settings → Connectors has a WhatsApp connector for the Cloud API access token, separate from the Meta Conversions API token. An environment variable or PHP constant named `FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_ACCESS_TOKEN` overrides the saved token.
- The new Fair Events → WhatsApp page saves the WhatsApp Business Account ID and the Phone Number ID, and explains that neither is the telephone number. **Validate connection** checks them with Meta and shows the sender's name, number and quality rating; changing the IDs or the token clears that result.
- **Send test template** sends an approved template without parameters to a number you enter, once, after you confirm the recipient agreed to receive it. It reports whether WhatsApp accepted the message, which is not proof of delivery; a send that times out is reported as uncertain and is not retried.
- Errors explain what to fix (an expired token, a missing permission, IDs from different accounts, a recipient a test sender can't reach) and show Meta's error code and trace ID. The token and recipient numbers are never shown or stored.
- WhatsApp messages are not sent automatically yet.
