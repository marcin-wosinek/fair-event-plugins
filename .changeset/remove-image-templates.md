---
'fair-audience-experimental': minor
---

Remove the Image Templates admin page from Fair Audience Experimental, with its menu entry and its "Image templates" feature toggle. A bookmark to the old page now gets WordPress's standard answer for a page that does not exist, and a stored `image-templates` setting is ignored and dropped the next time the experimental settings are saved. Its REST routes are gone as well: `GET` and `POST fair-audience/v1/image-templates`, `DELETE fair-audience/v1/image-templates/{id}` and `POST fair-audience/v1/image-templates/{id}/render`. Uploaded SVG templates, generated images and their template details stay in the Media Library untouched, and the other experimental features work as before.
