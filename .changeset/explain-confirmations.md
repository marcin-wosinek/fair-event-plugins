---
"fair-events": minor
---

Confirmations for deleting a venue, importing ticket settings, ending a series, merging sale periods and removing the organizer logo now name what they act on and say what changes: which event dates lose their venue, what an import replaces, which date of a series stays and which are deleted, which prices a merge keeps, and whether a further save is needed. Deleting a venue and importing ticket settings no longer use the browser's own confirmation box. Actions that save immediately show progress, cannot be submitted twice, and keep the dialog open with the error when they fail.

Fixed: **End series** on a repeating series reported success without ending it. It now keeps the first date as a single event and deletes the others, as the confirmation says.
