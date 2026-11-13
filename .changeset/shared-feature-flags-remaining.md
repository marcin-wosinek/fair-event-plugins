---
'fair-audience': patch
'fair-audience-experimental': patch
'fair-events-experimental': patch
'fair-finance': patch
'fair-platform': patch
'fair-timetable': patch
---

Feature flags now resolve through the shared Fair Event Plugins library, with no change to existing settings, defaults, wp-config constants or filters. Fair Finance and Fair Events Experimental now bundle the shared library, so Fair Finance shows the shared settings screen even when it is the only active Fair plugin.
