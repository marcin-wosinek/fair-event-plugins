---
'fair-events-experimental': minor
'fair-events': minor
---

Administrators can choose an organizer for each event. With Fair Events Experimental's Organizers bundle on, Manage Event has an Organizer tab offering the sitewide organizer or any additional organizer, saved with its own button. A series has one organizer, chosen on the series, which all its dates use. Copying an event keeps its organizer. The event's public structured data names the chosen organizer with its own identity, never its private notification addresses. Existing events keep the sitewide organizer with no change needed. Turning the bundle off, or deactivating Fair Events Experimental, brings back the sitewide organizer everywhere and keeps every choice for when it is turned on again. Fair Events stores the choice in a new event date column (database version 3.57.0) and gives other plugins a filter for the event's structured-data organizer.
