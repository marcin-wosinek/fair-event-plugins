---
'fair-payments-connector': patch
---

Payment notifications in Telegram and email now show event titles and other details as readable text: entities such as `&nbsp;`, `&amp;` and typographic quotes no longer appear literally (for example `La&nbsp;Mutable` now reads "La Mutable"). Text from events and participants is still shown as plain text and cannot add formatting or links. Notifications already queued for a digest are sent as they were rendered.
