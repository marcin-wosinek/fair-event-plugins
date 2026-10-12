---
'fair-payments-connector': patch
'fair-finance': minor
---

Settlements loaded from Mollie keep the report amounts exactly as Mollie
states them, including fees, VAT and rounding differences with fractions of a
cent, which used to be saved as unknown. A saved settlement now opens with a
settlement summary: reported revenue, refunds, costs and adjustments, the
report net, the payout and the exact difference between them. The Mollie
report breakdown lists every line by period with its count, rates, net, VAT
and gross amounts and invoice reference. Settlements saved before this
update show "Refresh to load report details"; refreshing them from Mollie
loads the details.
