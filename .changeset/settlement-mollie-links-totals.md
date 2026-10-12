---
'fair-finance': patch
---

A saved settlement now links to the Mollie dashboard of the organization it
was saved under: its Mollie settlement ID opens the settlements report, and
the payment IDs of its movements open their payments. Refunds, captures and
chargebacks link the payment they belong to. The Movements table ends with a Totals row that adds up the Settled
column per currency, keeps deductions negative, and says when rows with an
unknown amount were left out.
