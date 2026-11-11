---
'fair-audience': minor
---

Administrators can export the whole audience as a CSV file and import it on another Fair Audience site, from the new menu next to "Add Participant" on the All Participants page. Contact details, the mailing choice and the weekly summary opt-out move with each member; feed subscriptions, confirmation, accounts and history do not. Imported members start pending confirmation with no feed subscriptions, and the import sends no email. Existing members are never changed: identical rows are skipped as already present, and rows that differ are reported as conflicts, with opt-outs that did not transfer highlighted. See AUDIENCE_MIGRATION.md in the plugin for the file format and conflict handling.
