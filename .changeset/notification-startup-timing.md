---
'fair-events': patch
---

Event notifications now start once WordPress has finished setting up, which stops the early-loading notices WP-CLI commands, page loads and scheduled tasks reported on sites with Hostinger's tools, Ultimate Addons for Gutenberg, Fair Payments Connector or Fair Audience.

- Taking notifications over from Fair Events Experimental and Fair Audience, upgrading their data and scheduling the daily history cleanup now wait for WordPress's `init` step, after other plugins' background-task storage and translations are ready.
- Settings, history and delivery records are kept. A takeover still sends nothing, an interrupted one resumes safely, and the Telegram connector, scheduled sends and the history cleanup keep working.
