---
"fair-events-experimental": patch
---

Meta Conversions now delivers routine checkout and purchase events as production Meta events — no `test_event_code` is attached — for both test-mode and live-mode payments, so real sales are correctly measured instead of being reported only to Meta Test Events. `custom_data.payment_mode` still distinguishes test-mode transactions from live sales. The configured Test Events code is now used exclusively by the explicit "Send test event" diagnostic action; routine delivery no longer requires it to be configured.
