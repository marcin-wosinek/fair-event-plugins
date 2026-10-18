---
'fair-events': patch
---

When the first sale period has no start date, ticket sales now count from the day the event was created instead of today, so the assumed start no longer moves forward day by day. The Prices tab, the Event Prices block and the event's structured data show the same date, and an ended period keeps its date range without becoming purchasable again. Every ticket offer in the structured data now includes its sale start (`validFrom`), also while sales are open.
