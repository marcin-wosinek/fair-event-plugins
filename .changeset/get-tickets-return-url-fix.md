---
"fair-events": patch
---

Fix paid get-tickets purchases dumping the buyer on the homepage after checkout. The redirect URL was built with `get_permalink()` inside the REST request, where there is no post context, so it always fell back to `home_url()` — a page without the block, so the buyer never saw a confirmation. The controller now resolves the return URL from the same-site referer (preserving `?event_date=` on standalone pages), falling back to the event's own page, then the homepage.
