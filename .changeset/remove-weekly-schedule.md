---
"fair-audience-experimental": minor
"fair-events-experimental": minor
---

Remove the Weekly Schedule admin page from Fair Audience Experimental, with its menu entry and its "Weekly schedule" feature toggle. A bookmark to the old page now gets WordPress's standard answer for a page that does not exist, and a stored `weekly-schedule` setting is ignored and dropped the next time the experimental settings are saved. The two REST routes only that page used are gone as well: `POST fair-audience/v1/instagram/upload-blob` and `GET fair-events/v1/weekly-events`. Instagram Posts, Image Templates, the weekly digest and weekly notifications work as before, and no events, participants, settings, media or Instagram records are changed.
