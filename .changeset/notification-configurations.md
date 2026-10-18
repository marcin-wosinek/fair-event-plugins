---
'fair-events': minor
'fair-audience': patch
---

Event notifications can now have several notifications of the same kind —
for example two Telegram summaries for different event feeds, or two weekly
emails to the same address. Each one has its own name, settings, schedule,
history and duplicate protection, and pausing or changing one leaves the
others alone. New notifications start paused. Existing Telegram, bulk email
and individual email settings, including whether they are on, their queued
sends and the weeks already sent, move over automatically on update.

Fair Audience keeps one weekly-summary preference for all bulk emails, and
no longer counts a bulk email that was never set up as configured.
