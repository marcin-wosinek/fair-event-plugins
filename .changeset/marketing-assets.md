---
'fair-events-experimental': minor
---

Add marketing assets: with the new opt-in Marketing assets feature, a Marketing tab on Manage Event keeps text and PNG/JPEG images for promoting each event date. Each asset has a use case such as "Instagram post", plain text kept exactly as typed, an optional Media Library image, links to members of the event's team and an optional schedule item. Every date, including each date of a series, has its own assets. An authenticated API (`/fair-events/v1/event-dates/{id}/marketing-assets`) lets tools such as Event Content Studio manage them (see docs/marketing-assets.md). Images are ordinary Media Library files: anyone with an image's link can open it, and removing an image, deleting an asset or turning the feature off keeps the file and its link. Nothing is published yet.
