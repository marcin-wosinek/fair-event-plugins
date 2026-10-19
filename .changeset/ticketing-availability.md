---
'fair-events-experimental': patch
'fair-audience-experimental': patch
'fair-audience': patch
---

Ticketing availability no longer depends on which plugin's setting wins. The
Fair Events Ticketing feature alone decides whether ticket types, sale periods
and prices can be configured; the Experimental setting, now labelled
"Ticketing extensions", only turns group pricing and group permission rules on
or off. Before, turning Ticketing off in Experimental hid the Prices and List
tabs although Fair Events still served them, and turning it off in Fair Events
left the tabs visible while their routes were gone. Group rules now also need
Fair Events Ticketing to be on, and the Audience tab no longer requests invited
groups while those rules are unavailable. Existing settings, tickets, prices
and rules are kept.
