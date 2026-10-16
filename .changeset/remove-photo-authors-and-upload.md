---
'fair-audience': minor
'fair-audience-experimental': minor
'fair-form': patch
---

Remove photo authors, photo tags and the participant photo upload page. The media library no longer shows the Photo Author and tag fields, the Photo Author column and filters, the bulk upload author and tag selectors, or the "Set Photo Author" bulk action, and new uploads are no longer attributed or tagged. The Collaborators page drops its photo count column, and the Photos bundle is gone from the experimental settings; a `FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_PHOTOS` constant no longer has any effect. The custom mail and event mailing editors no longer offer "Insert photo upload link". Old "Upload photos" links answer 410 Gone without checking the token or accepting files, and a photo upload link in a saved message is left out when the message is sent. File questions in Fair Form and in event signup still store the upload as a media attachment, without recording the uploader as its author. On upgrade, the photo author/tag records, the bulk upload preferences and the stored Photos choice are deleted; media files, participants and events are kept, and the cleanup can safely repeat and is retried until it succeeds. Update fair-audience-experimental first. See DEPLOYMENT.md for backup and rollback steps.
