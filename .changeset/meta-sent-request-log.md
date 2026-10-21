---
'fair-events-experimental': minor
---

The Fair Events → Meta page now logs every request sent to Meta, including administrator tests, immediate button clicks and each queued retry, together with Meta's answer. Open **Sent requests** to see a request's destination dataset, Graph API version, whether a Test Events code was included, and every field with its type and safe value. Pick two requests to compare their fields side by side and find what differs between a test event Meta accepts and a production event it rejects. The log never stores the access token, the Test Events code, matching identifiers, event or order IDs, or full page URLs. For those fields it records only whether they were present, their type and whether they passed validation. Entries are kept for 30 days, up to 1,000 requests. A test result now shows the request that was sent, and older entries say when no request details are available.
