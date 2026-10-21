---
'fair-payments-connector': patch
---

Generating an API token now keeps its dialog open until the token is created. While it is generated, the dialog cannot be dismissed with Escape, the close button or a click outside, and a repeated submission cannot create a second token, so the token is never lost before you can copy it.
