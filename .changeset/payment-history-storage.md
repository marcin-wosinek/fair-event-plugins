---
'fair-events': minor
'fair-audience': patch
---

Fair Events now has storage for each ticket purchase's payment history, and records which Fair Audience participant a purchase was carried over from. This prepares a later update that copies older payment records into Fair Events. Nothing visible changes yet: ticket counts, capacity, revenue and payments work as before, and the new storage stays empty for now. Fair Audience no longer counts a participant a second time once a carried-over purchase exists for them. Update Fair Payments Connector first, then Fair Events, then Fair Audience.
