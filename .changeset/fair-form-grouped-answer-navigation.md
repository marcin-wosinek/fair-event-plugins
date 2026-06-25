---
"fair-form": minor
---

Add grouped answer navigation: a new Answers Overview admin page with a grouping selector (by page / event / form) backed by a `GET /fair-form/v1/questionnaire-responses/grouped` endpoint. Each row links to the filtered responses list. The Fair Form top-level menu now lands on the overview; the flat "All Answers" list moves to a submenu. Event picking in Form Answers and Submission Detail now uses grouped-by-event data instead of the fair-audience soft-dependency.
