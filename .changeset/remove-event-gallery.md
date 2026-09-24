---
'fair-events': minor
'fair-events-experimental': minor
'fair-audience': minor
'fair-audience-experimental': minor
'fair-form': patch
---

Remove the event photo gallery. The Photos tab of Manage Event, the public gallery page, photo likes and downloads, gallery access links, the "Send Gallery Link" action, the gallery count on Event Participants and the Images/Likes columns of By Event are gone, together with their REST routes. Old `?gallery_key=`, `?event_gallery_id=` and `/event-gallery/{id}` links now answer 410 Gone without checking the token. On upgrade, the gallery relationship, likes and access key tables are dropped; the cleanup can safely repeat and is retried until it succeeds. Media files, photo authors and tags, participant and questionnaire photo uploads, and event promotional images are kept. In fair-audience-experimental the retained photo upload and attribution features move from the `galleries` bundle to a new `photos` bundle, which inherits the stored choice. See DEPLOYMENT.md for backup and rollback steps.
