---
'fair-payments-connector': minor
---

Reworked the notice shown after returning from checkout.

- It appears only when no payment or ticket block on the page already shows the result, so buyers see one result per payment.
- It checks the payment with the browser's saved payment credential and never reads or sends a token in the URL. When the status can't be checked, it says so instead of reporting a failed payment.
- Messages are translatable, amounts follow the site language's money format, and the notice follows the theme's fonts and colors on every screen size. It stays until dismissed and can be closed with the keyboard.
