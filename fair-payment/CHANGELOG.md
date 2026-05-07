# fair-payment

## 1.2.0

### Minor Changes

-   d04f565: Transaction reconciliation improvements. Import Mollie transaction reports, display links from transactions to budget entries, link payments to participants via typeahead with an option to update missing participants, and limit reconciliation to live (production) mode.
-   41a295c: Add payment error logging. New `PaymentLog` model with database schema, REST endpoint, and admin log viewer on the transaction page. Mollie webhook and payment endpoints record errors for troubleshooting.

## 1.1.1

### Patch Changes

-   c8a6a54: Improve the mobile UI for transactions.

## 1.1.0

## 0.2.0

### Minor Changes

-   3abfc47: Add application fee to transactions.
-   457cd90: Show transation result when open call payment callback.
-   e61b58c: Add advanced settings view, to simplify troubleshooting

### Patch Changes

-   a25d6c7: Move Mollie payment integration to OAuth & Mollie Connect.
