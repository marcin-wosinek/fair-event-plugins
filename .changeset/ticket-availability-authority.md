---
"fair-events": patch
"fair-audience": patch
---

Consolidate ticket sale-period and ticket-type availability into a single `TicketAvailability` service in fair-events, always evaluated in the WordPress site timezone. Fixes two boundary inconsistencies found while consolidating: event JSON-LD offers now respect a ticket type's scheduled end date (previously only manual disabling was checked), and the fair-audience signup form's purchase validation now also rejects a manually disabled ticket type (previously only its scheduled end date), matching what the signup form already hides.
