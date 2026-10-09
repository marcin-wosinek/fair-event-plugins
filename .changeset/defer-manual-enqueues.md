---
"fair-events": patch
"fair-audience": patch
"fair-payments-connector": patch
"fair-finance": patch
"fair-platform": patch
---

Load the plugins' own scripts with WordPress's `defer` strategy. The Add to Calendar button script, the payment return notification script, and the admin and editor scripts of these plugins no longer pause page parsing while they download; they stay in the footer and behave as before. WordPress still loads a script the usual way where deferring would break ordering — Manage Event while a plugin adds tabs to it (Fair Audience does), and Fair Events → Settings while an extension adds a settings tab.
