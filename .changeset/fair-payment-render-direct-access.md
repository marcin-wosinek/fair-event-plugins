---
'fair-payment': patch
---

Add `defined( 'ABSPATH' ) || exit;` guard to the simple-payment block's `render.php` so Plugin Check's `missing_direct_file_access_protection` error is cleared.
