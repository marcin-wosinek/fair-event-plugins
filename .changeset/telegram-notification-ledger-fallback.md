---
"fair-audience": patch
---

Fix paid-transaction Telegram/email notifications missing event, ticket, activities, discounts, and even the participant name when a transaction's `participant_id` never resolved at creation time — enrichment now uses the payment ledger to fill in event/ticket data and falls back to the ledger's participant for the name, instead of silently skipping everything.
