---
'fair-events': minor
'fair-audience': minor
---

Purchases, admissions, capacity, Statistics and purchase payment history now always use Fair Events records, without waiting for the payment history switches. A Fair Audience relationship or participant-level activity with no Fair Events purchase behind it no longer takes a place or counts in Statistics. Statistics no longer depend on Fair Audience. Purchase payment history is listed on every site: in the ticket list, the Finance tab, Connector's transaction view and the participant detail, which no longer shows the per-event Transaction column. A payment that isn't linked to a purchase is never matched by its latest-attempt pointer: retrying or cancelling it is refused. A free Fair Audience signup takes its place at once, and a paid Fair Audience checkout for several occurrences is recorded for each of them. Fair Audience's purchase routes, add-ons and series upgrades now refuse to start when Fair Events is inactive or out of date. Sites must finish the payment history migration before updating.
