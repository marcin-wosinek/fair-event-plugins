---
'fair-events': minor
'fair-form': patch
'fair-events-shared': patch
---

Prefill Oona events in “From URL”: the page's own event, published as the main entity of its schema.org WebPage, now supplies the title, start and end times (converted to the site timezone) and venue name. Lookups prefer the event that matches the page URL over related events listed on the same page. When a page lists several sessions, the title and venue are still filled but the date and times are left for you to enter, rather than merging the sessions into one long event. Times published without a timezone are no longer guessed.
