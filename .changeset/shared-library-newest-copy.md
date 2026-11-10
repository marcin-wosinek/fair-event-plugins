---
'fair-events': patch
'fair-audience': patch
'fair-form': patch
'fair-payments-connector': patch
'fair-platform': patch
'fair-timetable': patch
'fair-audience-experimental': patch
'fair-payments-connector-experimental': patch
'fair-finance': patch
'fair-events-experimental': patch
---

Fair plugins now always use the newest copy of the Fair Event Plugins shared library that any active Fair plugin bundles, whatever order the plugins load in. Before, one outdated Fair plugin could quietly break features of the others. An example is Meetup "From URL" imports in Fair Events that filled in no date or time.

Administrators who can update plugins now see a warning on the Plugins screen and on Fair plugin screens. It names every active Fair plugin that bundles an outdated copy, and it clears once those plugins are updated or deactivated. Fair Timetable 0.8.0 and earlier load their copy early on admin screens, before the newest copy can be chosen. While such a release is active, the updated Fair plugins pause on admin screens instead of running with mismatched code, and an error notice names the plugin to update.
