---
"fair-events-experimental": minor
---

The Telegram bot token for weekly notifications is now managed in Settings → Connectors, and the plugin requires WordPress 7.0 or newer. A token saved earlier keeps working without being entered again. Weekly notifications shows whether a token is configured and links to Connectors; the chats, schedule, preview and test send stay where they were. The token can also come from an environment variable or PHP constant named `FAIR_EVENTS_EXPERIMENTAL_TELEGRAM_BOT_TOKEN`, which take precedence over the saved one. A missing or malformed token stops test and scheduled sends before anything reaches Telegram and says why. Send a test summary to confirm Telegram accepts the token.
