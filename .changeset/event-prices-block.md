---
"fair-events": minor
"fair-audience": patch
"fair-events-experimental": patch
---

Add an Event Prices block that displays an event's public ticket prices — enabled ticket types, sale periods, and their formatted prices — directly from the linked event's Prices tab, automatically following the visitor's selected recurring-event occurrence. Free, unavailable, and disabled tickets are shown without implying they can be purchased.

Ticket pricing across the signup and purchase flows now treats only an explicitly stored zero price as free. A ticket type with no price row at all is unavailable rather than free by convention, matching what the new block (and the Prices tab) shows — closing a gap where a ticket that looked unavailable could previously still be purchased for free at checkout.
