---
'fair-events': minor
'fair-audience': patch
---

Simplify the Manage Event List tab into a registration roster. It now shows only confirmed registrations (paid or free), numbers them from 1, and adds one column per configured extra showing whether each person holds it. Email addresses and amounts paid are no longer shown in the table or its delete dialog, but remain available in exports, which cover the displayed registrations. Fair Audience's event participants endpoint now also reports `confirmed_ticket_option_ids`, excluding extras still waiting for payment; without Fair Audience the extra columns show that selections are unavailable.
