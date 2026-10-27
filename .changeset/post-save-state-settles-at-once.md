---
'fair-events': patch
'fair-payments-connector': patch
'fair-finance': patch
'fair-audience-experimental': patch
---

Admin screens no longer briefly show old state after an action has finished.

- Event notifications: the "settings saved" notice, removing the old preview and clearing the "Unsaved changes" marker now happen together. The preview is also removed when a save changed nothing. The message shown after adding a notification goes away as soon as you open another view.
- Payments settings: after a mode change, disconnect or reconnect, the Mollie profile and payment methods of the previous mode or connection are no longer shown.
- Finance settlement import: a matched settlement report now shows with its suggested entry already selected.
- Manage event Groups tab: switching events clears the previous event's rules, messages and selections at once, and a change still saving for the previous event no longer shows its result on the new one.
