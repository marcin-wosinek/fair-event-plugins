---
'fair-audience': patch
'fair-audience-experimental': patch
'fair-payments-connector': patch
---

The Instagram access token and the Telegram bot token are now stored encrypted, the same way as the Mollie credentials (Sodium authenticated encryption, with a key derived from the site's WordPress security keys). Existing tokens are converted automatically on upgrade, whether or not the Instagram bundle or any Telegram route is enabled; nothing needs to be entered again. Instagram posting, connection tests and the daily token refresh, and Telegram notifications, work as before. The Instagram access token is no longer returned by the settings REST API (it was never shown on the settings screen); the Telegram bot token is still shown to administrators on the Notifications screen.

- **Without Sodium support:** a site whose tokens are still stored as plaintext keeps working and keeps storing plaintext; the conversion runs once support is available.
- **Losing Sodium support after conversion:** the encrypted tokens are kept unchanged. Instagram and Telegram notifications pause, the settings screens explain why, a new token cannot be saved until support returns, and both resume without re-entering anything once it does.
- **Changing the security keys or moving the database to another site:** the stored tokens can no longer be decrypted. Instagram is shown as needing a reconnection (connect again or enter a new access token), and the Notifications screen asks for the bot token to be entered again; until then nothing is sent. The unreadable values are left in place until they are replaced, or until Instagram is disconnected. If you rotate your WordPress keys routinely, reconnect Instagram and re-enter the Telegram bot token afterwards.
- **Limits:** this protects against partial leaks such as a table export, a settings export or a value copied into a log. When the WordPress security keys are not defined in `wp-config.php`, WordPress keeps them in the database, so a full database dump still contains what is needed to decrypt the tokens.
