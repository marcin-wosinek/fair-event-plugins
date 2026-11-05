---
'fair-events': patch
'fair-audience': patch
'fair-payments-connector': patch
'fair-events-experimental': patch
'fair-audience-experimental': patch
---

Background tasks now start reliably and stop cleanly. Fair Audience's five-minute expired-signup cleanup could fail to start, because it was scheduled before its interval existed. Each plugin now restores any missing recurring task on the next page load, retries one that could not be scheduled instead of reporting it as scheduled, removes all of its own tasks when it is deactivated (including each Payments digest frequency), and stops a feature's tasks while that feature is turned off. Settings, history, queued messages and digests are kept, and missed weekly notifications are still never sent late.
