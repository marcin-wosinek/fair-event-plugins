---
'fair-payments-connector': minor
---

The payment log now keeps entries for 90 days and stores less personal data.

- Entries older than 90 days, including existing ones, are deleted by a daily WordPress cron job. Sites can change the window with the `fair_payment_log_retention_days` filter, for example `add_filter( 'fair_payment_log_retention_days', fn() => 30 );`. The job runs when WordPress cron runs, so sites that need it on time should trigger cron from a system scheduler.
- New entries no longer record the visitor's IP address. Their details keep only diagnostic fields such as transaction, post and Mollie payment IDs, amount, currency, status and error codes; payment descriptions, checkout URLs and raw error text are left out.
