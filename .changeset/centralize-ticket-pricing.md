---
"fair-events": patch
"fair-events-experimental": patch
"fair-audience": patch
"fair-events-shared": patch
---

Centralize ticket price resolution in a new `FairEvents\Services\TicketPricing` service and a shared `ticket-pricing.js` module, so the fair-events get-tickets purchase paths and the fair-audience event-signup pricing agree on price. Previously get-tickets used a closed `[sale_start, sale_end]` sale-period interval while fair-audience used a half-open `[sale_start, sale_end)` interval with a `continues_pricing_period` fallback — the two could charge different prices for the same ticket type on a sale period's end day. get-tickets now uses the half-open convention too.
