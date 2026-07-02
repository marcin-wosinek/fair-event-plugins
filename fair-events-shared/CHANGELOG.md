# fair-events-shared

## 0.2.0

### Minor Changes

-   2cb0fb8: Add a shared payment-integration lifecycle layer in fair-events-shared that standardizes how plugins hook into payment start, completion, and failure. fair-payments-connector's simple-payment block and fair-events' get-tickets block consume the shared layer so payment side-effects are handled consistently across integrations.
