---
"fair-audience-experimental": patch
---

Fix the Groups tab on Manage Event opening onto a "No route was found" error. The tab is now offered only when everything it reads is available: Fair Events Experimental with its ticketing feature on, and this plugin's groups and manage-event extensions features on. A bookmarked link to the tab opens Event Details when it is not. When loading the rules does fail, the tab shows the error with a Retry button instead of "No group rules yet", and no longer reports a change as saved if the list could not be refreshed afterwards. Existing rules are untouched by turning these features off and on.
