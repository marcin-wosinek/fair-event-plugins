---
'fair-audience': minor
'fair-audience-experimental': minor
---

Remove the Collaborators page. The Fair Audience menu no longer lists it, a bookmarked link gets WordPress's standard "not allowed" page, and its import/export and event assignment controls and the `/fair-audience/v1/collaborators` route are gone. The public collaborator registration form is retired too: old `?collaborator_profile=1` links answer 410 Gone, accept no submissions and send no confirmation email, whether or not Fair Audience Experimental is active. The Collaborators bundle is gone from the experimental settings, and a `FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_COLLABORATORS` constant no longer has any effect. On upgrade, only the stored Collaborators choice is deleted; participants, their collaborator roles on events, and collaborator recipients in event mailings are kept. See DEPLOYMENT.md for the upgrade notes.
