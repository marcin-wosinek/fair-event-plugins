---
'fair-calendar-button': patch
---

Fix "Keep in sync with event data" for buttons on Fair Events event posts. Synchronized buttons now read the event's current dates, all-day setting, and location from Fair Events (venue name and address, or the event's own address) in the editor and on every page view, so event changes show without saving the post again. When the event has no usable dates or Fair Events is inactive, the editor explains why and the button offers no calendar entry instead of stale values; turning off syncing unlocks the fields with the latest values. Manually configured and standalone buttons are unchanged.
