---
"fair-events": minor
"fair-events-experimental": minor
---

Replace the manual `google_maps_link` venue field with a computed `maps_url`: the server now generates the Google Maps URL from latitude/longitude (exact pin) or falls back to the address (approximate). The `google_maps_link` DB column is dropped via migration 3.16.0 and removed from the admin form, REST API, and frontend block.
