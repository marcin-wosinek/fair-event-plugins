---
"fair-payments-connector": minor
---

**Create test payment** in live mode now asks for confirmation in a dialog instead of the browser's own confirmation box. The dialog shows the actual amount and currency, the Mollie profile name, profile ID and organization ID, and the warning about real money and gateway fees. Cancelling creates no payment. If the mode, currency or connected account changes after the dialog opens, no payment is created and the dialog shows the current details for a new confirmation. Test-mode payments are still created right away.

**Disconnect Mollie** now names the connected profile and account, or says "the connected Mollie account" when they are not known. It explains that the site cannot create Mollie payments or receive status updates for existing ones until it reconnects, and that payments already in Mollie are not cancelled or refunded. If the disconnect succeeds but its audit entry cannot be recorded, the page now shows the site as disconnected instead of inviting a retry.

**Delete local transaction** now names the transaction by ID, amount and currency, and by its description when it has one. The dialog still explains that only the local record is removed.

In all three dialogs, the dialog stays open while the action runs, a failure is shown inside the dialog, and repeated clicks cannot send the action twice.
