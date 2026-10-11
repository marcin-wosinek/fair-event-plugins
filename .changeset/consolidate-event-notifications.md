---
"fair-events": minor
"fair-audience": minor
"fair-events-experimental": minor
---

Manage weekly event notifications on one page, Fair Events → Event notifications. Telegram summaries (formerly in Fair Events Experimental) and the weekly email to subscribers (formerly Fair Audience → Weekly Digest) each keep their own schedule, event source, save button, preview, test send and delivery status. Telegram now needs only Fair Events; the weekly email needs Fair Audience, which still decides who receives it, adds the unsubscribe link and sends it.

Existing settings, schedules, chats, email wording, the Telegram bot token (still in Settings → Connectors, same environment variable and constant) and the delivery history are taken over automatically. Nothing is sent and no channel is turned on by the takeover; missed sends are not replayed, and a channel that was not being sent arrives turned off. The former settings screens lead to the new page, and their REST routes (`fair-events-experimental/v1/weekly-notifications`, `fair-audience/v1/weekly-digest`) and the `fair_audience_weekly_digest` setting are retired.

Update the three plugins together. An older Fair Events Experimental or Fair Audience keeps running its own channel until it is updated, and an updated companion next to an older Fair Events pauses that channel until Fair Events is updated. Deactivating Fair Audience pauses the weekly email only; deactivating Fair Events pauses every channel.
