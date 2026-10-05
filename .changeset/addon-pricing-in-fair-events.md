---
"fair-events": minor
"fair-audience": minor
"fair-events-experimental": minor
---

Sell priced add-ons with Fair Events alone. Add-ons (activities) configured on an event's Tickets tab — with one flat price or a price per sale period — now appear on the signup form and are charged at checkout without Fair Audience or Fair Events Experimental. Each add-on is charged once for every ticket that selects it, and the total shown on the form is the amount charged.

An add-on that has no price for the sale period currently on sale is no longer offered, and a purchase that still selects it is refused with a message naming it instead of the add-on being given away. An add-on priced at zero stays free, and can now be combined with a paid ticket. Add-ons that are full are marked as full for every visitor.

Existing add-ons, their prices, past selections and pending payments are kept as they are. With Fair Audience active, its signup and add-activities flows use the same prices and rules, and group discounts keep applying on top.

For developers: `TicketOption`, `TicketOptionPrice`, `ActivityOptionPriceResolver` and `ActivityOptionTranslation` moved from `FairEventsExperimental` to the matching `FairEvents` namespaces (the old names remain as aliases while Fair Events Experimental is active). Fair Events builds add-on line items itself; the `fair_events_signup_option_line_items` filter is replaced by `fair_events_signup_option_prices`, which only adjusts prices.
