---
'fair-payments-connector': minor
'fair-events-shared': minor
---

The Mollie access and refresh tokens are now stored encrypted (Sodium authenticated encryption, with a key derived from the site's WordPress security keys). Existing tokens are converted automatically on upgrade; no reconnection is needed, and checkout, automatic token refresh and test payments work as before. The shared package gains `FairEventsShared\Security\ProtectedOptions`, an opt-in way for any plugin to store a string option encrypted.

- **Without Sodium support:** a site whose tokens are still stored as plaintext keeps working and keeps storing plaintext; the conversion runs once support is available.
- **Losing Sodium support after conversion:** the encrypted tokens are kept unchanged, payments pause with a notice on the connection settings (visitors see "Online payment is temporarily unavailable"), and the connection resumes without reconnecting once support is restored.
- **Changing the security keys or moving the database to another site:** the stored tokens can no longer be decrypted. The connection is shown as needing a reconnect instead of failing during checkout, and the unreadable values are left in place until you reconnect. If you rotate your WordPress keys routinely, reconnect Mollie afterwards.
- **Limits:** this protects against partial leaks such as a table export, a settings export or a value copied into a log. When the WordPress security keys are not defined in `wp-config.php`, WordPress keeps them in the database, so a full database dump still contains what is needed to decrypt the tokens.
