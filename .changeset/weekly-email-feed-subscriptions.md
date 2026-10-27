---
'fair-audience': minor
'fair-events': minor
---

Subscribers can choose which event feeds' weekly emails they receive. The subscription-management page now offers "All weekly emails" (the default, which also covers feeds added later) or "Only the event feeds I choose" with a checkbox per feed, and each feed's weekly email goes only to the subscribers it is meant for. Existing subscribers keep receiving every weekly email until they choose. The mailing signup endpoint accepts optional `weekly_summary` and `weekly_feed_ids` fields: a new subscriber's choice applies when they confirm their email address, and a signup with an already-subscribed address only emails it a link to the management page. Update Fair Audience and Fair Events together: Fair Events pauses the weekly email until Fair Audience supports feed subscriptions.
