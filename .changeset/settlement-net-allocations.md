---
'fair-finance': minor
---

Keep net payment allocations when a Mollie settlement includes adjustments such as invoice compensation. When the fees recorded on each payment match the payment fees in the settlement evidence, every payment is allocated at its net amount, and each separately listed adjustment gets its own allocation. Fees are not deducted twice. Missing or disagreeing fees, and unexplained differences, are explained instead of balanced. Fully reconciled settlements that were already split can be fixed with a new **Preview recalculation** action. It shows current and proposed amounts, the tag (including "Untagged"), event and budget each allocation keeps, and any manual edits that are affected. It changes allocations in place only after confirmation, records the change in the confirmation history, and makes no changes when repeated.
