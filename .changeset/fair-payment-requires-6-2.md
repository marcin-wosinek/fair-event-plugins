---
'fair-payment': patch
---

Bump minimum WordPress version to 6.2 so the `%i` identifier placeholder used in `$wpdb->prepare()` is supported on the declared floor, clearing Plugin Check `UnsupportedIdentifierPlaceholder` errors before publishing.
