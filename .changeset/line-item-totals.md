---
"fair-payments-connector": minor
"fair-events": patch
"fair-audience": patch
---

Calculate signup and payment totals in one way. The amount saved with a signup, whether it is free or paid, the amount charged and the line items recorded in the finance ledger now all come from the same calculation: amounts have two decimals and are rounded half up — each unit price first, then each line, then the total. Purchases at ordinary two-decimal prices are unchanged.

A price with a fraction of a cent (for example after a discount) can now differ by a cent from what one of these places showed before, and a total that rounds to zero is confirmed as free instead of being sent to payment. In a purchase for several dates, each date's signup now holds its own rounded amount.

For developers: a transaction's amount is always the total of its line items. `fair_payment_before_validate_line_items` may still change the line items, which are validated again; a total changed through `fair_payment_calculated_total` or `fair_payment_before_create_transaction` without matching line items is refused. Line items may now be negative (discounts) or zero as long as the total is positive, and a quantity must be a positive whole number. `fair_payment_create_transaction()` accepts `expected_amount` to refuse a transaction whose total differs from the amount the caller decided on.
